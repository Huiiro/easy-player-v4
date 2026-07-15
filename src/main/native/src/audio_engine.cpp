#include "audio_engine.h"
#include "asio_backend.h"
#include "dsound_backend.h"
#include "wasapi_backend.h"
#include "logger.h"
#include <algorithm>
#include <chrono>
#include <sstream>
#include <unordered_set>
#include <vector>

AudioEngine::AudioEngine() {}

void AudioEngine::set_replay_gain_mode(int mode, bool prevent_clipping) {
    replay_gain_mode_ = std::max(0, std::min(2, mode));
    replay_gain_prevent_clipping_ = prevent_clipping;
    update_replay_gain_for_track();
}

void AudioEngine::update_replay_gain_for_track() {
    const bool use_track = replay_gain_mode_ == 1 && track_info_.metadata.has_replaygain_track;
    const bool use_album = replay_gain_mode_ == 2 && track_info_.metadata.has_replaygain_album;
    const float gain = use_track ? track_info_.metadata.replaygain_track_db : use_album ? track_info_.metadata.replaygain_album_db : 0.0f;
    const float peak = use_track ? track_info_.metadata.replaygain_track_peak : use_album ? track_info_.metadata.replaygain_album_peak : 0.0f;
    dsp_pipeline_.set_replay_gain_config({use_track || use_album, gain, peak, replay_gain_prevent_clipping_});
}

AudioEngine::~AudioEngine() {
    stop();
    if (backend_) backend_->close();
}

// ──────────────────────────────────────────────────────────
// Lifecycle
// ──────────────────────────────────────────────────────────

bool AudioEngine::open(const std::string& file_path) {
    // A decoder, ring buffer and backend are format-specific. Reusing a live
    // backend after switching tracks can feed (for example) 44.1 kHz PCM to a
    // 48 kHz device without SRC, which changes pitch. Fully stop the previous
    // stream before opening the next one so play() recreates the backend and
    // configures the DSP pipeline from the new source format.
    const EngineState previous_state = state_.load(std::memory_order_acquire);
    if (previous_state != EngineState::Idle && previous_state != EngineState::Loading) {
        LOG_INFO("Opening next track: tearing down previous format-specific output path");
        stop();
    }

    set_state(EngineState::Loading);

    if (!decoder_.open(file_path)) {
        set_state(EngineState::Idle);
        if (error_cb_) error_cb_(-1, "Failed to open file: " + file_path);
        return false;
    }

    track_info_ = decoder_.track_info();
    update_replay_gain_for_track();
    dsp_pipeline_.reset({track_info_.sample_rate, track_info_.bit_depth, track_info_.channels});
    played_frames_.store(0, std::memory_order_release);
    track_ended_fired_.store(false, std::memory_order_release);
    track_end_pending_.store(false, std::memory_order_release);

    // Create ring buffer: ~750ms capacity
    int buffer_frames = (int)(track_info_.sample_rate * 0.75);
    ring_buffer_ = std::make_unique<RingBuffer>(track_info_.channels, buffer_frames);

    set_state(EngineState::Ready);
    LOG_INFO("Track opened: " + std::to_string(track_info_.sample_rate) + "Hz/" +
             std::to_string(track_info_.channels) + "ch; output will be reopened on play");
    return true;
}

bool AudioEngine::play() {
    if (state_ == EngineState::Playing) return true;
    if (state_ != EngineState::Ready && state_ != EngineState::Paused) return false;

    bool resuming = (state_ == EngineState::Paused);

    // Ensure we have a backend
    if (!backend_) {
        // Create the backend based on user-selected type
        switch (current_backend_type_) {
            case BackendType::WASAPI_SHARED:
                backend_ = std::make_unique<WasapiBackend>(false);
                break;
            case BackendType::WASAPI_EXCLUSIVE:
                backend_ = std::make_unique<WasapiBackend>(true);
                break;
            case BackendType::ASIO:
                backend_ = std::make_unique<AsioBackend>();
                break;
            case BackendType::DIRECTSOUND:
            default:
                backend_ = std::make_unique<DSoundBackend>();
                break;
        }

        AudioFormat requested;
        requested.sample_rate = force_output_rate_ ? target_sample_rate_ : track_info_.sample_rate;
        requested.bit_depth = 16;
        requested.channels = track_info_.channels;

        auto cb = [this](float* output, int frames, int channels) -> int {
            return this->audio_callback(output, frames, channels);
        };

        AudioFormat actual = backend_->open(current_device_id_, requested, cb);
        if (actual.sample_rate == 0) {
            if (error_cb_) error_cb_(-2, "Failed to open audio device");
            return false;
        }

        dsp_pipeline_.configure(
            {track_info_.sample_rate, track_info_.bit_depth, track_info_.channels},
            actual,
            backend_->type(),
            backend_->buffer_size_frames());
        LOG_INFO("Audio pipeline configured: " + std::to_string(track_info_.sample_rate) +
                 "Hz/" + std::to_string(track_info_.channels) + "ch -> " +
                 std::to_string(actual.sample_rate) + "Hz/" + std::to_string(actual.channels) +
                 "ch" + (track_info_.sample_rate != actual.sample_rate
                     ? " (libsamplerate SRC active)" : " (SRC bypassed)"));

        // Ring Buffer capacity is larger than a backend callback. Allocate
        // once on the control thread for source-format reads.
        source_work_buffer_.assign(
            static_cast<size_t>(ring_buffer_->frames_available() + ring_buffer_->write_available() / track_info_.channels) *
                track_info_.channels,
            0.0f);
        source_work_frames_ = 0;

        if (!backend_->start()) {
            if (error_cb_) error_cb_(-3, "Failed to start audio device");
            return false;
        }
    }

    // Start decoder thread (only if not already running)
    if (!decoder_running_) {
        decoder_running_ = true;
        decoder_thread_ = std::make_unique<std::thread>(&AudioEngine::decoder_thread_func, this);
    }

    // Start position timer (only if not already running)
    if (!timer_running_) {
        timer_running_ = true;
        position_timer_ = std::make_unique<std::thread>(&AudioEngine::position_timer_func, this);
    }

    set_state(EngineState::Playing);
    LOG_INFO(resuming ? "Playback resumed" : "Playback started: " + track_info_.file_path);
    return true;
}

bool AudioEngine::pause() {
    if (state_ != EngineState::Playing) return false;
    set_state(EngineState::Paused);
    return true;
}

bool AudioEngine::stop() {
    if (state_ == EngineState::Idle || state_ == EngineState::Loading) return false;

    // Stop threads
    decoder_running_ = false;
    timer_running_ = false;

    if (decoder_thread_ && decoder_thread_->joinable()) {
        decoder_thread_->join();
    }
    decoder_thread_.reset();

    if (position_timer_ && position_timer_->joinable()) {
        position_timer_->join();
    }
    position_timer_.reset();

    // Stop backend
    if (backend_) {
        backend_->stop();
        backend_->close();
        backend_.reset();
    }

    ring_buffer_.reset();
    source_work_buffer_.clear();
    source_work_frames_ = 0;
    dsp_pipeline_.reset({track_info_.sample_rate, track_info_.bit_depth, track_info_.channels});
    played_frames_.store(0, std::memory_order_release);
    track_ended_fired_.store(false, std::memory_order_release);
    track_end_pending_.store(false, std::memory_order_release);
    set_state(EngineState::Stopped);
    LOG_INFO("Playback stopped");

    set_state(EngineState::Idle);
    return true;
}

// ──────────────────────────────────────────────────────────
// Seek
// ──────────────────────────────────────────────────────────

bool AudioEngine::seek(double position_ms) {
    if (state_ != EngineState::Playing && state_ != EngineState::Paused &&
        state_ != EngineState::Ready) {
        return false;
    }

    int64_t sample_pos = (int64_t)(position_ms / 1000.0 * track_info_.sample_rate);

    double pos_before = this->position_ms();
    int buf_before = ring_buffer_ ? ring_buffer_->frames_available() : -1;
    LOG_INFO("Seek requested: " + std::to_string(position_ms) + "ms -> " +
             std::to_string(sample_pos) + " samples (buf=" + std::to_string(buf_before) + "f)");

    int prefetched = 0;

    // Lock decoder mutex to prevent concurrent decode() while we seek and prefill
    // the ring buffer with fresh audio for the backend flush below.
    {
        std::lock_guard<std::mutex> lock(decoder_mutex_);
        seek_generation_.fetch_add(1, std::memory_order_release);
        if (!decoder_.seek(sample_pos)) return false;

        played_frames_.store(sample_pos, std::memory_order_release);
        track_ended_fired_.store(false, std::memory_order_release);
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
    LOG_INFO("Seek: ring buffer after reset: " + std::to_string(buf_after) + "f, decoder at " +
             std::to_string(decoder_.position()) + " samples, prefetched " +
             std::to_string(prefetched) + "f");

    // Flush hardware buffer to clear stale audio from before the seek
    if (backend_) {
        backend_->flush();
        LOG_INFO("Seek: backend flushed");
    }

    if (pos_cb_) {
        pos_cb_(position_ms, duration_ms());
    }

    return true;
}

// ──────────────────────────────────────────────────────────
// Control
// ──────────────────────────────────────────────────────────

void AudioEngine::set_volume(float volume) {
    dsp_pipeline_.set_master_volume(volume);
}

bool AudioEngine::set_eq_bands(const std::array<EqBand, kEqBandCount>& bands) {
    const bool ok = dsp_pipeline_.set_eq_bands(bands);
    if (ok) {
        std::ostringstream message;
        message << "EQ configuration published: "
                << dsp_pipeline_.active_eq_band_count() << " active band(s)";
        for (const auto& band : bands) {
            if (band.enabled && std::abs(band.gain_db) >= 0.0001f) {
                message << " [" << band.frequency_hz << "Hz "
                        << (band.gain_db >= 0.0f ? "+" : "") << band.gain_db
                        << "dB Q=" << band.q << "]";
            }
        }
        LOG_INFO(message.str());
    }
    return ok;
}

bool AudioEngine::set_resampler_config(bool force_output_rate, int target_sample_rate, int quality) {
    if (target_sample_rate < 8000 || target_sample_rate > 384000 || quality < 0 || quality > 2) return false;
    if (force_output_rate_ == force_output_rate && target_sample_rate_ == target_sample_rate &&
        resampler_quality_ == quality) return true;

    force_output_rate_ = force_output_rate;
    target_sample_rate_ = target_sample_rate;
    resampler_quality_ = quality;
    dsp_pipeline_.set_resampler_quality(static_cast<DspPipeline::ResamplerQuality>(quality));
    LOG_INFO("Resampler configuration: " + std::string(force_output_rate ? "force " : "automatic ") +
             std::to_string(target_sample_rate) + "Hz, quality=" +
             (quality == 0 ? "best" : quality == 1 ? "medium" : "fast"));

    // An opened backend owns its output clock. Recreate it before playback
    // resumes so a target-rate change never reaches the audio callback half-applied.
    const bool resume = state_ == EngineState::Playing;
    if (backend_) {
        if (resume) state_.store(EngineState::Paused, std::memory_order_release);
        backend_->stop();
        backend_->close();
        backend_.reset();
        if (decoder_thread_ && decoder_thread_->joinable()) {
            decoder_running_ = false;
            decoder_thread_->join();
            decoder_thread_.reset();
        }
        if (position_timer_ && position_timer_->joinable()) {
            timer_running_ = false;
            position_timer_->join();
            position_timer_.reset();
        }
        source_work_buffer_.clear();
        source_work_frames_ = 0;
    }
    return !resume || play();
}

// ──────────────────────────────────────────────────────────
// Device / Backend
// ──────────────────────────────────────────────────────────

std::vector<DeviceInfo> AudioEngine::enumerate_devices() {
    std::vector<DeviceInfo> devices;
    std::unordered_set<std::wstring> seen_names;

    auto add_unique = [&](std::vector<DeviceInfo>& list) {
        for (auto& d : list) {
            if (seen_names.find(d.name) == seen_names.end()) {
                seen_names.insert(d.name);
                devices.push_back(std::move(d));
            }
        }
    };

    // ASIO devices first (lowest latency)
    {
        AsioBackend asio;
        auto d = asio.enumerate_devices();
        for (auto& di : d) {
            devices.push_back(std::move(di));
        }
    }

    // WASAPI devices (preferred over DSound)
    {
        WasapiBackend wasapi_shared(false);
        auto d = wasapi_shared.enumerate_devices();
        add_unique(d);
    }
    {
        WasapiBackend wasapi_exclusive(true);
        auto d = wasapi_exclusive.enumerate_devices();
        // Exclusive devices share names with shared — but the backend field
        // differs. Skip name dedup and add them all (user can pick exclusive).
        for (auto& di : d) {
            devices.push_back(std::move(di));
        }
    }

    // DSound devices last (fallback — on Win10+ these are WASAPI Shared under the hood)
    {
        DSoundBackend ds;
        auto d = ds.enumerate_devices();
        add_unique(d);
    }

    return devices;
}

bool AudioEngine::set_device(const std::wstring& device_id) {
    return select_output_device(current_backend_type_, device_id);
}

bool AudioEngine::set_backend(BackendType type) {
    return select_output_device(type, L"default");
}

bool AudioEngine::select_output_device(BackendType type, const std::wstring& device_id) {
    if (type != BackendType::DIRECTSOUND &&
        type != BackendType::WASAPI_SHARED &&
        type != BackendType::WASAPI_EXCLUSIVE &&
        type != BackendType::ASIO) {
        return false;
    }
    if (current_backend_type_ == type && current_device_id_ == device_id) return true;

    bool was_playing = (state_ == EngineState::Playing);

    // Need to transition state so that play() will actually reconstruct
    // the backend instead of short-circuiting on `state_ == Playing`.
    if (was_playing) {
        state_.store(EngineState::Paused, std::memory_order_release);
    }

    // Stop backend and threads, then restart with new device
    if (backend_) {
        backend_->stop();
        backend_->close();
        backend_.reset();
    }

    // Also stop decoder/timer so play() can recreate them cleanly
    if (decoder_thread_ && decoder_thread_->joinable()) {
        decoder_running_ = false;
        decoder_thread_->join();
        decoder_thread_.reset();
    }
    if (position_timer_ && position_timer_->joinable()) {
        timer_running_ = false;
        position_timer_->join();
        position_timer_.reset();
    }

    current_backend_type_ = type;
    current_device_id_ = device_id;

    // If we were playing, recreate backend and resume
    if (was_playing) {
        return play();
    }
    return true;
}

// ──────────────────────────────────────────────────────────
// Query
// ──────────────────────────────────────────────────────────

double AudioEngine::position_ms() const {
    if (track_info_.sample_rate <= 0) return 0.0;
    return static_cast<double>(played_frames_.load(std::memory_order_acquire)) /
           track_info_.sample_rate * 1000.0;
}

// ──────────────────────────────────────────────────────────
// State machine
// ──────────────────────────────────────────────────────────

void AudioEngine::set_state(EngineState new_state) {
    state_.store(new_state, std::memory_order_release);
    if (state_cb_) {
        state_cb_(new_state);
    }
}

// ──────────────────────────────────────────────────────────
// Decoder thread
// ──────────────────────────────────────────────────────────

void AudioEngine::decoder_thread_func() {
    LOG_INFO("Decoder thread started");
    int channels = track_info_.channels;

    while (decoder_running_) {
        // Keep ring buffer around 75% full
        int target = ring_buffer_->write_available() / channels;
        if (target < 1024) {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
            continue;
        }

        int decode_chunk = std::min(target, 4096);
        std::vector<float> buffer(decode_chunk * channels);
        int decoded = 0;

        {
            // Hold mutex for entire decode+write cycle.
            // seek() also holds this mutex during reset+seek, ensuring:
            // - No concurrent FFmpeg access (thread safety)
            // - Ring buffer reset can't happen between decode and write
            std::lock_guard<std::mutex> lock(decoder_mutex_);
            decoded = decoder_.decode(buffer.data(), decode_chunk);

            if (decoded <= 0) {
                LOG_INFO("Decoder reached EOF");
                decoder_running_ = false;
                break;
            }

            ring_buffer_->write(buffer.data(), decoded, 0); // timeout=0: non-blocking
        }
    }
    LOG_INFO("Decoder thread stopped");
}

// ──────────────────────────────────────────────────────────
// Position timer thread
// ──────────────────────────────────────────────────────────

void AudioEngine::position_timer_func() {
    while (timer_running_) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));

        if (track_end_pending_.exchange(false, std::memory_order_acq_rel)) {
            // ThreadSafeFunction and logging may lock or allocate, so this
            // transition is deliberately deferred out of audio_callback().
            set_state(EngineState::Stopped);
            LOG_INFO("Track ended (EOF reached)");
        }

        const uint64_t processed_eq = dsp_pipeline_.processed_eq_generation();
        if (processed_eq != 0 && processed_eq != last_logged_eq_generation_) {
            last_logged_eq_generation_ = processed_eq;
            LOG_INFO("EQ configuration reached audio callback: generation=" +
                     std::to_string(processed_eq) + ", active bands=" +
                     std::to_string(dsp_pipeline_.active_eq_band_count()));
        }

        if (pos_cb_ && state_ == EngineState::Playing) {
            pos_cb_(position_ms(), duration_ms());
        }
    }
}

// ──────────────────────────────────────────────────────────
// Audio callback (runs in real-time audio thread)
// ──────────────────────────────────────────────────────────

int AudioEngine::audio_callback(float* output, int frames, int channels) {
    if (state_ != EngineState::Playing || !ring_buffer_ ||
        source_work_buffer_.empty()) {
        // Paused or stopped: output silence
        std::memset(output, 0, frames * channels * sizeof(float));
        return frames;
    }

    const int source_channels = track_info_.channels;
    const int capacity_frames = static_cast<int>(source_work_buffer_.size() / source_channels);
    // Keep a small SRC look-ahead. libsamplerate may consume fewer input
    // frames than it receives, so tail frames remain in this FIFO.
    const int desired_frames = std::min(capacity_frames,
                                        dsp_pipeline_.required_input_frames(frames));
    const int to_read = std::max(0, desired_frames - source_work_frames_);
    int read = 0;
    if (to_read > 0) {
        read = ring_buffer_->read(source_work_buffer_.data() +
                                  static_cast<size_t>(source_work_frames_) * source_channels,
                                  to_read);
        source_work_frames_ += read;
    }

    if (read < to_read) {
        glitch_count_.fetch_add(1, std::memory_order_relaxed);
    }

    // Check for end-of-stream: decoder stopped AND ring buffer is (nearly) empty
    const bool input_ended = !decoder_running_ && ring_buffer_->frames_available() == 0;
    const auto result = dsp_pipeline_.process(source_work_buffer_.data(), source_work_frames_,
                                              source_channels, input_ended, output, frames, channels);
    played_frames_.fetch_add(result.input_frames_used, std::memory_order_relaxed);
    const int consumed = std::min(result.input_frames_used, source_work_frames_);
    const int remaining = source_work_frames_ - consumed;
    if (remaining > 0 && consumed > 0) {
        std::memmove(source_work_buffer_.data(),
                     source_work_buffer_.data() + static_cast<size_t>(consumed) * source_channels,
                     static_cast<size_t>(remaining) * source_channels * sizeof(float));
    }
    source_work_frames_ = remaining;

    // Wait until the SRC FIFO has been consumed as well; otherwise the last
    // resampler tail would be cut off when the decoder reaches EOF.
    if (input_ended && source_work_frames_ == 0 && result.stream_drained &&
        !track_ended_fired_.exchange(true, std::memory_order_acq_rel)) {
        track_end_pending_.store(true, std::memory_order_release);
    }

    return frames;
}
