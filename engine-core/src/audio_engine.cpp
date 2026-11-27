// Playback lifecycle, seek, position and state notifications on the control path.

#include "audio_engine.h"
#include "audio_engine_logging.h"
#include "logger.h"
#include <algorithm>
#include <chrono>
#include <utility>

using audio_engine_detail::format_audio;

AudioEngine::AudioEngine(std::shared_ptr<AudioBackendFactory> backend_factory)
    : backend_factory_(std::move(backend_factory)) {
    LOG_INFO(std::string("Easy Player Audio Engine v") + kVersion + " initialized");
}

AudioEngine::~AudioEngine() {
    stop_auto_mix_thread();
    stop();
    if (backend_) backend_->close();
}

bool AudioEngine::open(const std::string& file_path) {
    // A decoder, ring buffer and backend are format-specific. Reusing a live
    // backend after switching tracks can feed (for example) 44.1 kHz PCM to a
    // 48 kHz device without SRC, which changes pitch. Fully stop the previous
    // stream before opening the next one so play() recreates the backend and
    // configures the DSP pipeline from the new source format.
    const EngineState previous_state = state_.load(std::memory_order_acquire);
    LOG_DEBUG("Open requested: path=" + file_path + ", previous_state=" + std::to_string(static_cast<int>(previous_state)));
    if (previous_state != EngineState::Idle && previous_state != EngineState::Loading) {
        LOG_DEBUG("Opening next track: tearing down previous format-specific output path");
        stop();
    }

    set_state(EngineState::Loading);
    // A new source must not inherit a device-reopen position captured before
    // it was opened (for example during startup output-settings restoration).
    reopen_position_ms_ = -1.0;

    if (!decoder_.open(file_path)) {
        LOG_ERROR("Open failed at decoder initialization: path=" + file_path);
        set_state(EngineState::Idle);
        if (error_cb_) error_cb_(-1, "Failed to open file: " + file_path);
        return false;
    }

    track_info_ = decoder_.track_info();
    source_channels_ = track_info_.channels;
    // The renderer owns the actual playlist. Reopening the current file as a
    // speculative "next" decoder makes gapless playback loop the same track
    // forever and prevents the renderer from receiving a real EOF event.
    // Keep this empty until the native engine receives a real queue hand-off.
    next_track_path_.clear();
    crossfade_target_warned_ = false;
    crossfade_started_logged_ = false;
    auto_fade_end_frame_ = 0;
    auto_fade_frames_ = 0;
    auto_fade_vocal_end_frame_ = 0;
    auto_mix_out_vocals_.clear();
    auto_mix_in_vocals_.clear();
    ++auto_fade_revision_;
    auto_fade_intro_.clear();
    auto_fade_source_frames_ = 0;
    auto_fade_incoming_start_frame_ = 0;
    pending_transition_frame_.store(-1, std::memory_order_release);
    track_start_frame_.store(0, std::memory_order_release);
    update_replay_gain_for_track();
    dsp_pipeline_.reset({track_info_.sample_rate, track_info_.bit_depth, track_info_.channels});
    pause_fade_live_ = 1.0f;
    pause_fade_pending_.store(false, std::memory_order_release);
    played_frames_.store(0, std::memory_order_release);
    dop_carrier_frames_.store(0, std::memory_order_release);
    track_ended_fired_.store(false, std::memory_order_release);
    decoder_failed_.store(false, std::memory_order_release);
    track_end_pending_.store(false, std::memory_order_release);
    {
        std::lock_guard<std::mutex> lock(track_end_mutex_);
        ended_track_reason_.clear();
        decoder_error_message_.clear();
    }
    dop_transport_active_.store(false, std::memory_order_release);
    dop_ring_buffer_.reset();
    dop_output_marker_ = 0x05;
    transition_active_.store(false, std::memory_order_release);
    transition_work_buffer_.clear();

    // Create ring buffer: ~750ms capacity
    int buffer_frames = (int)(track_info_.sample_rate * 0.75);
    ring_buffer_ = std::make_unique<RingBuffer>(track_info_.channels, buffer_frames);

    set_state(EngineState::Ready);
    LOG_DEBUG("Track opened: path=" + file_path + ", source=" +
              format_audio({track_info_.sample_rate, track_info_.bit_depth, track_info_.channels}) +
              ", duration_ms=" + std::to_string(track_info_.duration_ms) +
              ", buffer_frames=" + std::to_string(buffer_frames) + "; output will be reopened on play");
    return true;
}

bool AudioEngine::play() {
    if (state_ == EngineState::Playing) return true;
    if (state_ != EngineState::Ready && state_ != EngineState::Paused) return false;

    const bool resuming = (state_ == EngineState::Paused);
    if (!start_output(resuming)) return false;

    // Start decoder thread (only if not already running)
    if (!decoder_running_) {
        // EOF can finish decoding while its buffered tail is still audible.
        // A paused resume must reap that worker before replacing its joinable
        // std::thread, otherwise destruction calls std::terminate(). Join before
        // setting the running flag so the outgoing worker cannot observe a restart.
        if (decoder_thread_ && decoder_thread_->joinable()) decoder_thread_->join();
        decoder_running_ = true;
        decoder_thread_ = std::make_unique<std::thread>(&AudioEngine::decoder_thread_func, this);
    }

    // Start position timer (only if not already running)
    if (!timer_running_) {
        timer_running_ = true;
        position_timer_ = std::make_unique<std::thread>(&AudioEngine::position_timer_func, this);
    }
    if (!dop_transport_active_.load(std::memory_order_acquire) && !analysis_running_) {
        analysis_running_ = true;
        analysis_thread_ = std::make_unique<std::thread>(&AudioEngine::analysis_thread_func, this);
    }

    pause_fade_pending_.store(false, std::memory_order_release);
    reopen_position_ms_ = -1.0;
    set_state(EngineState::Playing);
    LOG_DEBUG(resuming ? "Playback resumed" : "Playback started: " + track_info_.file_path);
    return true;
}

bool AudioEngine::pause() {
    if (state_ != EngineState::Playing) return false;
    const bool dop = dop_transport_active_.load(std::memory_order_acquire);
    pause_fade_pending_.store(!dop && pause_fade_enabled_.load(std::memory_order_acquire) &&
        pause_fade_ms_.load(std::memory_order_acquire) > 0, std::memory_order_release);
    if (dop && backend_ && !backend_->stop()) {
        stop();
        set_state(EngineState::Stopped);
        if (error_cb_) error_cb_(-3, "Audio device failed to pause");
        return false;
    }
    set_state(EngineState::Paused);
    LOG_DEBUG("Playback paused: path=" + track_info_.file_path + ", position_ms=" + std::to_string(position_ms()));
    return true;
}

bool AudioEngine::stop() {
    cancel_auto_mix();
    if (state_ == EngineState::Idle || state_ == EngineState::Loading) return false;

    close_output();
    pause_fade_pending_.store(false, std::memory_order_release);
    pause_fade_live_ = 1.0f;
    pcm_output_sample_rate_.store(0, std::memory_order_release);

    analysis_ring_buffer_.reset();
    eq_monitor_ring_buffer_.reset();
    analysis_work_buffer_.clear();

    ring_buffer_.reset();
    dop_transport_active_.store(false, std::memory_order_release);
    dop_ring_buffer_.reset();
    dop_work_buffer_.clear();
    dop_output_marker_ = 0x05;
    source_work_buffer_.clear();
    source_work_frames_ = 0;
    transition_work_buffer_.clear();
    next_decoder_.close();
    next_track_path_.clear();
    crossfade_target_warned_ = false;
    crossfade_started_logged_ = false;
    auto_fade_end_frame_ = 0;
    auto_fade_frames_ = 0;
    auto_fade_vocal_end_frame_ = 0;
    auto_mix_out_vocals_.clear();
    auto_mix_in_vocals_.clear();
    ++auto_fade_revision_;
    auto_fade_intro_.clear();
    auto_fade_source_frames_ = 0;
    auto_fade_incoming_start_frame_ = 0;
    pending_transition_frame_.store(-1, std::memory_order_release);
    track_start_frame_.store(0, std::memory_order_release);
    transition_active_.store(false, std::memory_order_release);
    dsp_pipeline_.reset({track_info_.sample_rate, track_info_.bit_depth, track_info_.channels});
    played_frames_.store(0, std::memory_order_release);
    dop_carrier_frames_.store(0, std::memory_order_release);
    reopen_position_ms_ = -1.0;
    track_ended_fired_.store(false, std::memory_order_release);
    decoder_failed_.store(false, std::memory_order_release);
    track_end_pending_.store(false, std::memory_order_release);
    set_state(EngineState::Stopped);
    LOG_DEBUG("Playback stopped");

    set_state(EngineState::Idle);
    return true;
}

bool AudioEngine::seek(double position_ms) {
    const bool replan = auto_mix_preparing();
    if (state_ != EngineState::Playing && state_ != EngineState::Paused &&
        state_ != EngineState::Ready) {
        return false;
    }

    if (dop_transport_active_.load(std::memory_order_acquire)) {
        LOG_WARN("DSD DoP seek is not available yet; stop and restart playback instead");
        return false;
    }
    int64_t sample_pos = (int64_t)(position_ms / 1000.0 * track_info_.sample_rate);

    double pos_before = this->position_ms();
    int buf_before = ring_buffer_ ? ring_buffer_->frames_available() : -1;
    LOG_DEBUG("Seek requested: " + std::to_string(position_ms) + "ms -> " +
             std::to_string(sample_pos) + " samples (buf=" + std::to_string(buf_before) + "f)");

    int prefetched = 0;
    pcm_io_resetting_.store(true, std::memory_order_release);
    while (pcm_callbacks_in_flight_.load(std::memory_order_acquire) != 0) {
        std::this_thread::yield();
    }

    // Lock decoder mutex to prevent concurrent decode() while we seek and prefill
    // the ring buffer with fresh audio for the backend flush below.
    {
        std::lock_guard<std::mutex> lock(decoder_mutex_);
        seek_generation_.fetch_add(1, std::memory_order_release);
        if (!decoder_.seek(sample_pos)) {
            pcm_io_resetting_.store(false, std::memory_order_release);
            return false;
        }

        if (!next_track_path_.empty() && prepare_next_decoder_locked() && auto_fade_incoming_start_frame_ > 0)
            next_decoder_.seek(auto_fade_incoming_start_frame_);
        transition_active_.store(false, std::memory_order_release);
        crossfade_started_logged_ = false;
        auto_mix_mixer_.reset(track_info_.sample_rate, track_info_.channels);
        auto_mix_vocal_mixer_.reset(track_info_.sample_rate);

        played_frames_.store(track_start_frame_.load(std::memory_order_acquire) + sample_pos,
                             std::memory_order_release);
        track_ended_fired_.store(false, std::memory_order_release);
        decoder_failed_.store(false, std::memory_order_release);
        track_end_pending_.store(false, std::memory_order_release);

        if (ring_buffer_) {
            ring_buffer_->reset();

            int channels = track_info_.channels;
            int desired_frames = backend_
                ? backend_->buffer_size_frames() * 2
                : track_info_.sample_rate / 10;
            int max_frames = ring_buffer_->write_available() / channels;
            desired_frames = std::max(0, std::min(desired_frames, max_frames));

            while (prefetched < desired_frames) {
                int chunk = std::min(4096, desired_frames - prefetched);
                std::vector<float> buffer(chunk * channels);
                int decoded = decoder_.decode(buffer.data(), chunk);
                if (decoded <= 0) break;
                ring_buffer_->write(buffer.data(), decoded, 0);
                prefetched += decoded;
                if (decoded < chunk) break;
            }
        }
    }

    int buf_after = ring_buffer_ ? ring_buffer_->frames_available() : -1;
    // Drop the detector's short-term history after a discontinuity. The tap is
    // intentionally not reset here because its producer is the audio callback.
    analysis_rms_.store(0.0f, std::memory_order_release);
    analysis_low_energy_.store(0.0f, std::memory_order_release);
    analysis_onset_strength_.store(0.0f, std::memory_order_release);
    analysis_beat_sequence_.store(0, std::memory_order_release);
    analysis_bpm_.store(0.0f, std::memory_order_release);
    analysis_momentary_energy_.store(0.0, std::memory_order_release);
    analysis_short_term_energy_.store(0.0, std::memory_order_release);
    analysis_integrated_lufs_.store(-70.0f, std::memory_order_release);
    analysis_reset_generation_.fetch_add(1, std::memory_order_release);
    LOG_DEBUG("Seek: ring buffer after reset: " + std::to_string(buf_after) + "f, decoder at " +
             std::to_string(decoder_.position()) + " samples, prefetched " +
             std::to_string(prefetched) + "f");

    // Flush hardware buffer to clear stale audio from before the seek
    if (backend_) {
        if (!backend_->flush_checked()) {
            pcm_io_resetting_.store(false, std::memory_order_release);
            LOG_ERROR("Seek failed: audio device could not restart");
            stop();
            set_state(EngineState::Stopped);
            if (error_cb_) error_cb_(-3, "Audio device failed to restart after seek");
            return false;
        }
        LOG_DEBUG("Seek: backend flushed");
    }
    // An explicit seek supersedes any earlier device-reopen snapshot. With no
    // backend yet, play() must reopen both PCM and DoP at this latest position.
    if (!backend_) reopen_position_ms_ = position_ms;
    pcm_io_resetting_.store(false, std::memory_order_release);

    if (pos_cb_) {
        pos_cb_(position_ms, duration_ms());
    }

    if (replan) refresh_auto_fade_plan();
    return true;
}

double AudioEngine::position_ms() const {
    if (dop_transport_active_.load(std::memory_order_acquire) && backend_ &&
        backend_->current_format().sample_rate > 0) {
        return static_cast<double>(dop_carrier_frames_.load(std::memory_order_acquire)) /
               backend_->current_format().sample_rate * 1000.0;
    }
    std::lock_guard<std::mutex> lock(decoder_mutex_);
    if (track_info_.sample_rate <= 0) return 0.0;
    const int64_t played = played_frames_.load(std::memory_order_acquire);
    // The playback clock is cumulative; the current track begins before the
    // outgoing track ends when their tails overlap.
    const int64_t track_position = std::max<int64_t>(0,
        played - track_start_frame_.load(std::memory_order_acquire));
    return static_cast<double>(track_position) / track_info_.sample_rate * 1000.0;
}

void AudioEngine::set_state(EngineState new_state) {
    state_.store(new_state, std::memory_order_release);
    if (state_cb_) {
        state_cb_(new_state);
    }
}
