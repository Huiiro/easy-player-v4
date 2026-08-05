#include "audio_engine.h"
#include "logger.h"
#include <algorithm>
#include <chrono>
#include <deque>
#include <sstream>
#include <vector>

AudioEngine::AudioEngine(std::shared_ptr<AudioBackendFactory> backend_factory)
    : backend_factory_(std::move(backend_factory)) {
    LOG_INFO(std::string("Easy Player Audio Engine v") + kVersion + " initialized");
}

AudioAnalysisSnapshot AudioEngine::audio_analysis_snapshot() const {
    const int rate = backend_ ? backend_->current_format().sample_rate : 0;
    AudioAnalysisSnapshot snapshot{};
    snapshot.output_time_ms = rate > 0 ? analysis_output_frames_.load(std::memory_order_acquire) * 1000.0 / rate : 0.0;
    snapshot.rms = analysis_rms_.load(std::memory_order_acquire);
    snapshot.low_energy = analysis_low_energy_.load(std::memory_order_acquire);
    snapshot.onset_strength = analysis_onset_strength_.load(std::memory_order_acquire);
    snapshot.dropped_frames = analysis_dropped_frames_.load(std::memory_order_acquire);
    if (rate > 0) {
        snapshot.analysis_time_ms = analysis_processed_frames_.load(std::memory_order_acquire) * 1000.0 / rate;
        snapshot.analysis_latency_ms = std::max(0.0, snapshot.output_time_ms - snapshot.analysis_time_ms);
    }
    snapshot.beat_sequence = analysis_beat_sequence_.load(std::memory_order_acquire);
    snapshot.bpm = analysis_bpm_.load(std::memory_order_acquire);
    snapshot.momentary_lufs = analysis_momentary_lufs_.load(std::memory_order_acquire);
    snapshot.short_term_lufs = analysis_short_term_lufs_.load(std::memory_order_acquire);
    snapshot.integrated_lufs = analysis_integrated_lufs_.load(std::memory_order_acquire);
    for (size_t i = 0; i < snapshot.spectrum.size(); ++i) snapshot.spectrum[i] = analysis_spectrum_[i].load(std::memory_order_acquire);
    return snapshot;
}

AudioChainStatus AudioEngine::audio_chain_status() const {
    if (!dop_transport_active_.load(std::memory_order_acquire)) {
        auto status = dsp_pipeline_.status();
        const auto transition = transition_config();
        if (transition.crossfade_enabled && transition.crossfade_ms > 0) {
            status.active_nodes.push_back("Crossfade");
            status.bit_perfect_blockers.push_back("Crossfade mixes consecutive tracks");
            status.is_bit_perfect_eligible = false;
            status.bit_perfect_verification_state = "blocked";
            status.is_bit_perfect = false;
        }
        return status;
    }
    AudioChainStatus status{};
    status.source_format = {track_info_.dsd_sample_rate, 1, track_info_.channels};
    status.backend_format = backend_ ? backend_->current_format() : AudioFormat{};
    status.active_nodes = {"DoP encoded transport"};
    status.bit_perfect_blockers = {"DoP is an encoded DSD transport, not PCM bit-perfect"};
    status.is_bit_perfect_eligible = false;
    status.bit_perfect_verification_state = "blocked";
    return status;
}

bool AudioEngine::set_transition_config(const TransitionConfig& input) {
    TransitionConfig value{};
    value.gapless_enabled = input.gapless_enabled;
    value.crossfade_enabled = input.crossfade_enabled;
    value.crossfade_ms = std::max(0, std::min(30000, input.crossfade_ms));
    if (!value.gapless_enabled) value.crossfade_enabled = false;
    // DoP is encoded data, so mixing it would corrupt the transport.
    if (dop_transport_active_.load(std::memory_order_acquire) && value.crossfade_enabled) return false;
    gapless_enabled_.store(value.gapless_enabled, std::memory_order_release);
    crossfade_enabled_.store(value.crossfade_enabled, std::memory_order_release);
    crossfade_ms_.store(value.crossfade_ms, std::memory_order_release);
    return true;
}

void AudioEngine::stop_analysis_thread() {
    analysis_running_.store(false, std::memory_order_release);
    if (analysis_thread_ && analysis_thread_->joinable()) analysis_thread_->join();
    analysis_thread_.reset();
}

bool AudioEngine::prepare_next_decoder_locked() {
    next_decoder_.close();
    if (next_track_path_.empty() || !next_decoder_.open(next_track_path_)) return false;
    const auto& next = next_decoder_.track_info();
    const bool compatible = next.sample_rate == track_info_.sample_rate &&
        next.channels == track_info_.channels && !next.is_dsd;
    if (!compatible) next_decoder_.close();
    return compatible;
}

bool AudioEngine::switch_to_next_decoder_locked() {
    // The renderer owns the queue, so an unavailable native "next" decoder
    // is not a request to replay the current file. Seeking back to zero here
    // made queue-loop mode look like single-track repeat and forced the
    // renderer to infer EOF from a position rollover.
    if (next_decoder_.track_info().file_path.empty()) return false;
    decoder_.swap(next_decoder_);
    next_decoder_.close();
    // Preparing a following decoder is optional; the switch itself succeeded.
    prepare_next_decoder_locked();
    return true;
}

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
    // The renderer owns the actual playlist. Reopening the current file as a
    // speculative "next" decoder makes gapless playback loop the same track
    // forever and prevents the renderer from receiving a real EOF event.
    // Keep this empty until the native engine receives a real queue hand-off.
    next_track_path_.clear();
    update_replay_gain_for_track();
    dsp_pipeline_.reset({track_info_.sample_rate, track_info_.bit_depth, track_info_.channels});
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
        if (!backend_factory_) {
            if (error_cb_) error_cb_(-2, "No audio backend factory configured");
            return false;
        }
        backend_ = backend_factory_->create(current_backend_type_);
        if (!backend_) {
            if (error_cb_) error_cb_(-2, "Selected audio backend is unavailable");
            return false;
        }

        AudioFormat requested;
        requested.sample_rate = force_output_rate_ ? target_sample_rate_ : track_info_.sample_rate;
        requested.bit_depth = 16;
        requested.channels = track_info_.channels;

        auto cb = [this](float* output, int frames, int channels) -> int {
            return this->audio_callback(output, frames, channels);
        };

        std::vector<int> candidate_rates = {requested.sample_rate};
        if (track_info_.is_dsd && !force_output_rate_) {
            // DSD has already been converted to high-rate PCM by FFmpeg. A
            // PCM device may not accept that intermediate rate in exclusive
            // mode, so retain the DSD 44.1 kHz family while stepping down.
            for (int rate = requested.sample_rate / 2; rate >= 88200; rate /= 2) {
                if (std::find(candidate_rates.begin(), candidate_rates.end(), rate) == candidate_rates.end()) candidate_rates.push_back(rate);
            }
            for (int rate : {44100, 48000}) {
                if (std::find(candidate_rates.begin(), candidate_rates.end(), rate) == candidate_rates.end()) candidate_rates.push_back(rate);
            }
            LOG_INFO("DSD transport decision: Native DSD unavailable; PCM conversion remains the fallback path");
        }

        AudioFormat actual{};
        const bool dop_backend = current_backend_type_ == BackendType::WASAPI_EXCLUSIVE ||
            current_backend_type_ == BackendType::ASIO;
        const bool request_dop = track_info_.is_dsd && dop_enabled_ &&
            !force_output_rate_ && dop_backend &&
            track_info_.dsd_sample_rate > 0 && track_info_.channels >= 1 && track_info_.channels <= 8;
        if (request_dop) {
            const int carrier_rate = track_info_.dsd_sample_rate / 16;
            AudioFormat dop_requested{carrier_rate, 24, track_info_.channels};
            if (decoder_.begin_dop()) {
                dop_ring_buffer_ = std::make_unique<ByteRingBuffer>(track_info_.channels * 3,
                    std::max(4096, static_cast<int>(carrier_rate * 0.75)));
                dop_work_buffer_.assign(static_cast<size_t>(4096) * track_info_.channels * 3, 0);
                dop_output_marker_ = 0x05;
                dop_transport_active_.store(true, std::memory_order_release);
                actual = backend_->open_dop(current_device_id_, dop_requested,
                    [this](uint8_t* output, int frames, int channels) -> int {
                        return this->dop_audio_callback(output, frames, channels);
                    });
                if (actual.sample_rate == carrier_rate && actual.bit_depth == 24 &&
                    actual.channels == track_info_.channels) {
                    const int prime_frames = std::min(4096, dop_ring_buffer_->writable_frames());
                    const int primed = decoder_.read_dop(dop_work_buffer_.data(), prime_frames);
                    if (primed <= 0 || dop_ring_buffer_->write(dop_work_buffer_.data(), primed) != primed) {
                        LOG_WARN("DSD DoP could not prime encoded transport; falling back to PCM conversion");
                        backend_->close();
                        backend_ = backend_factory_->create(current_backend_type_);
                        dop_transport_active_.store(false, std::memory_order_release);
                        dop_ring_buffer_.reset();
                        dop_work_buffer_.clear();
                        decoder_.seek(0);
                        actual = {};
                    } else {
                        track_info_.dsd_transport = "dop";
                        LOG_INFO("DSD DoP active: " + std::to_string(track_info_.dsd_sample_rate) +
                                 "Hz -> PCM24 carrier " + std::to_string(carrier_rate) + "Hz; DSP, volume and analysis bypassed");
                    }
                } else {
                    LOG_WARN("DSD DoP unavailable on this device; falling back to PCM conversion");
                    backend_->close();
                    backend_ = backend_factory_->create(current_backend_type_);
                    dop_transport_active_.store(false, std::memory_order_release);
                    dop_ring_buffer_.reset();
                    dop_work_buffer_.clear();
                    decoder_.seek(0);
                    actual = {};
                }
            } else {
                LOG_WARN("DSD DoP preparation failed; falling back to PCM conversion");
            }
        } else if (track_info_.is_dsd && dop_enabled_) {
            LOG_WARN("DSD DoP requires WASAPI Exclusive or ASIO, source-rate output, and 1-8 channels; using PCM conversion");
        }
        if (actual.sample_rate == 0) {
            LOG_INFO(track_info_.is_dsd
                ? "DSD transport decision: Native DSD unavailable; using FFmpeg PCM conversion"
                : "PCM transport selected");
        for (int rate : candidate_rates) {
            // For Exclusive output, ask for the source precision first. The
            // previous fixed {32, 24, ...} order unnecessarily negotiated a
            // 32-bit float endpoint for 16/24-bit sources and permanently
            // disqualified an otherwise format-matched bypass chain.
            std::vector<int> candidate_bits;
            if (current_backend_type_ == BackendType::WASAPI_EXCLUSIVE) {
                const int source_bits = track_info_.bit_depth == 16 || track_info_.bit_depth == 24 ||
                    track_info_.bit_depth == 32 ? track_info_.bit_depth : 16;
                candidate_bits.push_back(source_bits);
                // 25 denotes 24 valid PCM bits in a 32-bit container.
                if (source_bits == 24) candidate_bits.push_back(25);
                for (const int fallback : {32, 24, 25, 16}) {
                    if (std::find(candidate_bits.begin(), candidate_bits.end(), fallback) == candidate_bits.end()) {
                        candidate_bits.push_back(fallback);
                    }
                }
            } else {
                candidate_bits = {16};
            }
            for (int bits : candidate_bits) {
                requested.sample_rate = rate;
                requested.bit_depth = bits;
                actual = backend_->open(current_device_id_, requested, cb);
                if (actual.sample_rate != 0) break;
            }
            if (actual.sample_rate != 0) break;
            if (track_info_.is_dsd) LOG_WARN("DSD PCM fallback rate rejected: " + std::to_string(rate) + "Hz");
        }
        }
        if (actual.sample_rate == 0) {
            if (error_cb_) error_cb_(-2, "Failed to open audio device");
            return false;
        }
        if (track_info_.is_dsd && actual.sample_rate != track_info_.sample_rate) {
            LOG_INFO("DSD PCM fallback selected: " + std::to_string(track_info_.sample_rate) + "Hz -> " +
                     std::to_string(actual.sample_rate) + "Hz (libsamplerate SRC)");
        }

        if (!dop_transport_active_.load(std::memory_order_acquire)) {
        dsp_pipeline_.configure(
            {track_info_.sample_rate, track_info_.bit_depth, track_info_.channels},
            actual,
            backend_->type(),
            backend_->buffer_size_frames());
        // Two seconds of final output PCM. The future analysis thread is the
        // sole consumer; callback writes use timeout 0 and may drop frames.
        analysis_ring_buffer_ = std::make_unique<RingBuffer>(actual.channels, actual.sample_rate * 2);
        analysis_dropped_frames_.store(0, std::memory_order_release);
        analysis_output_frames_.store(0, std::memory_order_release);
        analysis_processed_frames_.store(0, std::memory_order_release);
        analysis_rms_.store(0.0f, std::memory_order_release);
        analysis_low_energy_.store(0.0f, std::memory_order_release);
        analysis_onset_strength_.store(0.0f, std::memory_order_release);
        analysis_beat_sequence_.store(0, std::memory_order_release);
        analysis_bpm_.store(0.0f, std::memory_order_release);
        analysis_momentary_lufs_.store(-70.0f, std::memory_order_release);
        analysis_short_term_lufs_.store(-70.0f, std::memory_order_release);
        analysis_integrated_lufs_.store(-70.0f, std::memory_order_release);
        analysis_reset_generation_.fetch_add(1, std::memory_order_release);
        for (auto& level : analysis_spectrum_) level.store(0.0f, std::memory_order_release);
        analysis_work_buffer_.assign(static_cast<size_t>(1024) * actual.channels, 0.0f);
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
        // ASIO drivers may request their first buffer synchronously from
        // start(). Prepare PCM before that call so the callback never starts
        // with an empty source queue (ASIO4ALL is particularly sensitive to
        // this startup ordering).
        const int prime_frames = std::min(
            std::max(1, backend_->buffer_size_frames() * 2),
            ring_buffer_->write_available() / track_info_.channels);
        if (prime_frames > 0) {
            std::vector<float> prime_buffer(static_cast<size_t>(prime_frames) * track_info_.channels);
            std::lock_guard<std::mutex> lock(decoder_mutex_);
            const int primed = decoder_.decode(prime_buffer.data(), prime_frames);
            if (primed > 0) {
                ring_buffer_->write(prime_buffer.data(), primed, 0);
                LOG_INFO("PCM transport primed: " + std::to_string(primed) + " frame(s)");
            } else {
                LOG_WARN("PCM transport could not be primed before device start");
            }
        }
        } else {
            // Encoded DoP is not PCM: never route it through DSP, volume,
            // SRC, meters, or the PCM analysis ring.
            ring_buffer_.reset();
            analysis_ring_buffer_.reset();
            source_work_buffer_.clear();
            source_work_frames_ = 0;
        }

        if (!backend_->start()) {
            if (error_cb_) error_cb_(-3, "Failed to start audio device");
            backend_->close();
            backend_.reset();
            return false;
        }
    } else if (resuming && dop_transport_active_.load(std::memory_order_acquire)) {
        // DoP cannot be paused by feeding zero-valued PCM frames: that would
        // invalidate the marker sequence. pause() stops the device instead.
        if (!backend_->start()) {
            if (error_cb_) error_cb_(-3, "Failed to resume DoP audio device");
            backend_->close();
            backend_.reset();
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
    if (!dop_transport_active_.load(std::memory_order_acquire) && !analysis_running_) {
        analysis_running_ = true;
        analysis_thread_ = std::make_unique<std::thread>(&AudioEngine::analysis_thread_func, this);
    }

    set_state(EngineState::Playing);
    LOG_INFO(resuming ? "Playback resumed" : "Playback started: " + track_info_.file_path);
    return true;
}

bool AudioEngine::pause() {
    if (state_ != EngineState::Playing) return false;
    if (dop_transport_active_.load(std::memory_order_acquire) && backend_) backend_->stop();
    set_state(EngineState::Paused);
    return true;
}

bool AudioEngine::stop() {
    if (state_ == EngineState::Idle || state_ == EngineState::Loading) return false;

    // Stop threads
    decoder_running_ = false;
    timer_running_ = false;
    analysis_running_ = false;

    if (decoder_thread_ && decoder_thread_->joinable()) {
        decoder_thread_->join();
    }
    decoder_thread_.reset();

    if (position_timer_ && position_timer_->joinable()) {
        position_timer_->join();
    }
    position_timer_.reset();
    stop_analysis_thread();

    // Stop backend
    if (backend_) {
        backend_->stop();
        backend_->close();
        backend_.reset();
    }

    analysis_ring_buffer_.reset();
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
    transition_active_.store(false, std::memory_order_release);
    dsp_pipeline_.reset({track_info_.sample_rate, track_info_.bit_depth, track_info_.channels});
    played_frames_.store(0, std::memory_order_release);
    dop_carrier_frames_.store(0, std::memory_order_release);
    track_ended_fired_.store(false, std::memory_order_release);
    decoder_failed_.store(false, std::memory_order_release);
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

    if (dop_transport_active_.load(std::memory_order_acquire)) {
        LOG_WARN("DSD DoP seek is not available yet; stop and restart playback instead");
        return false;
    }
    int64_t sample_pos = (int64_t)(position_ms / 1000.0 * track_info_.sample_rate);

    double pos_before = this->position_ms();
    int buf_before = ring_buffer_ ? ring_buffer_->frames_available() : -1;
    LOG_INFO("Seek requested: " + std::to_string(position_ms) + "ms -> " +
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

        played_frames_.store(sample_pos, std::memory_order_release);
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
    analysis_momentary_lufs_.store(-70.0f, std::memory_order_release);
    analysis_short_term_lufs_.store(-70.0f, std::memory_order_release);
    analysis_integrated_lufs_.store(-70.0f, std::memory_order_release);
    analysis_reset_generation_.fetch_add(1, std::memory_order_release);
    LOG_INFO("Seek: ring buffer after reset: " + std::to_string(buf_after) + "f, decoder at " +
             std::to_string(decoder_.position()) + " samples, prefetched " +
             std::to_string(prefetched) + "f");

    // Flush hardware buffer to clear stale audio from before the seek
    if (backend_) {
        backend_->flush();
        LOG_INFO("Seek: backend flushed");
    }
    pcm_io_resetting_.store(false, std::memory_order_release);

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
        stop_analysis_thread();
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
    return backend_factory_ ? backend_factory_->enumerate_devices() : std::vector<DeviceInfo>{};
}

bool AudioEngine::set_device(const std::wstring& device_id) {
    return select_output_device(current_backend_type_, device_id);
}

bool AudioEngine::set_backend(BackendType type) {
    return select_output_device(type, L"default");
}

bool AudioEngine::select_output_device(BackendType type, const std::wstring& device_id) {
    if (!backend_factory_ || !backend_factory_->supports(type)) {
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
        stop_analysis_thread();
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
    if (dop_transport_active_.load(std::memory_order_acquire) && backend_ &&
        backend_->current_format().sample_rate > 0) {
        return static_cast<double>(dop_carrier_frames_.load(std::memory_order_acquire)) /
               backend_->current_format().sample_rate * 1000.0;
    }
    if (track_info_.sample_rate <= 0) return 0.0;
    const int64_t total = static_cast<int64_t>(track_info_.duration_ms / 1000.0 * track_info_.sample_rate);
    const int64_t played = played_frames_.load(std::memory_order_acquire);
    // In the temporary single-track queue, the playback clock is cyclic.
    // Keep the UI position inside the opened track even though the decoder
    // thread may already have prepared another loop instance.
    const int64_t loop_position = total > 0 ? played % total : played;
    return static_cast<double>(loop_position) / track_info_.sample_rate * 1000.0;
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
        if (dop_transport_active_.load(std::memory_order_acquire)) {
            if (!dop_ring_buffer_) break;
            const int target = dop_ring_buffer_->writable_frames();
            if (target < 1024) {
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
                continue;
            }
            const int decode_chunk = std::min(target, 4096);
            int decoded = 0;
            {
                std::lock_guard<std::mutex> lock(decoder_mutex_);
                decoded = decoder_.read_dop(dop_work_buffer_.data(), decode_chunk);
                if (decoded > 0) dop_ring_buffer_->write(dop_work_buffer_.data(), decoded);
            }
            if (decoded <= 0) {
                LOG_INFO("DSD DoP reader reached EOF");
                decoder_running_ = false;
                break;
            }
            continue;
        }
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
            const auto transition = transition_config();
            const int64_t total = decoder_.total_samples();
            const int64_t position = decoder_.position();
            const int fade_frames = transition.crossfade_enabled && !track_info_.is_dsd
                ? std::min<int64_t>(total, static_cast<int64_t>(track_info_.sample_rate) * transition.crossfade_ms / 1000)
                : 0;
            const int64_t remaining = std::max<int64_t>(0, total - position);
            const bool in_fade = fade_frames > 0 && remaining <= fade_frames;
            if (in_fade) decode_chunk = static_cast<int>(std::min<int64_t>(decode_chunk, remaining));
            decoded = decoder_.decode(buffer.data(), decode_chunk);

            if (decoded > 0 && in_fade) {
                if (next_decoder_.track_info().file_path.empty() && !prepare_next_decoder_locked()) {
                    LOG_WARN("Crossfade target unavailable; continuing gaplessly without a mix");
                } else {
                    transition_work_buffer_.resize(static_cast<size_t>(decoded) * channels);
                    const int next_frames = next_decoder_.decode(transition_work_buffer_.data(), decoded);
                    if (next_frames == decoded) {
                        const int64_t fade_offset = fade_frames - remaining;
                        for (int frame = 0; frame < decoded; ++frame) {
                            const float t = std::min(1.0f, static_cast<float>(fade_offset + frame) /
                                static_cast<float>(std::max(1, fade_frames - 1)));
                            const float outgoing = std::cos(1.57079632679f * t);
                            const float incoming = std::sin(1.57079632679f * t);
                            for (int channel = 0; channel < channels; ++channel) {
                                const size_t index = static_cast<size_t>(frame) * channels + channel;
                                buffer[index] = buffer[index] * outgoing + transition_work_buffer_[index] * incoming;
                            }
                        }
                        transition_active_.store(true, std::memory_order_release);
                    }
                }
            }

            if (decoded <= 0) {
                if (decoded < 0) {
                    decoder_failed_.store(true, std::memory_order_release);
                    std::lock_guard<std::mutex> end_lock(track_end_mutex_);
                    decoder_error_message_ = decoder_.last_error();
                    LOG_ERROR("Decoder stopped after an unrecoverable error: " + decoder_error_message_);
                    decoder_running_ = false;
                    break;
                }
                if (transition.gapless_enabled && !track_info_.is_dsd && switch_to_next_decoder_locked()) {
                    transition_active_.store(false, std::memory_order_release);
                    continue;
                }
                LOG_INFO("Decoder reached EOF");
                decoder_running_ = false;
                break;
            }

            ring_buffer_->write(buffer.data(), decoded, 0); // timeout=0: non-blocking
            // Switch immediately after the tail is queued. The already-open
            // decoder has advanced by fade_frames, so the overlap is not
            // replayed after a crossfade.
            if (decoder_.position() >= decoder_.total_samples() && transition.gapless_enabled && !track_info_.is_dsd) {
                if (switch_to_next_decoder_locked()) transition_active_.store(false, std::memory_order_release);
            }
        }
    }
    LOG_INFO("Decoder thread stopped");
}

// ──────────────────────────────────────────────────────────
// Position timer thread
// ──────────────────────────────────────────────────────────

void AudioEngine::mark_track_ended_pending() {
    // This path runs only once at EOF; capturing the source prevents a late
    // notification from being attributed to a track selected in the meantime.
    {
        std::lock_guard<std::mutex> lock(track_end_mutex_);
        ended_track_path_ = track_info_.file_path;
        ended_track_reason_ = decoder_failed_.load(std::memory_order_acquire) ? "decode_error" : "eof";
    }
    track_end_pending_.store(true, std::memory_order_release);
}

void AudioEngine::position_timer_func() {
    while (timer_running_) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));

        if (track_end_pending_.exchange(false, std::memory_order_acq_rel)) {
            // ThreadSafeFunction and logging may lock or allocate, so this
            // transition is deliberately deferred out of audio_callback().
            set_state(EngineState::Stopped);
            std::string ended_track_reason;
            std::string decoder_error;
            std::string ended_track_path;
            {
                std::lock_guard<std::mutex> lock(track_end_mutex_);
                ended_track_path = ended_track_path_;
                ended_track_reason = ended_track_reason_;
                decoder_error = decoder_error_message_;
            }
            if (ended_track_reason == "decode_error") {
                LOG_ERROR("Track ended because decoding could not continue: " + decoder_error);
                if (error_cb_) error_cb_(-1, decoder_error.empty() ? "Audio decoding failed" : decoder_error);
            } else {
                LOG_INFO("Track ended (EOF reached)");
            }
            if (track_ended_cb_) track_ended_cb_(ended_track_reason, ended_track_path);
            // Do not leave an inactive callback pumping silence forever.
            // This thread never joins itself; stop() will join the finished
            // timer later when the user opens another track or stops.
            if (backend_) backend_->stop();
            stop_analysis_thread();
            timer_running_.store(false, std::memory_order_release);
            return;
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

int AudioEngine::dop_audio_callback(uint8_t* output, int frames, int channels) {
    if ((state_ != EngineState::Playing && state_ != EngineState::Ready) ||
        !dop_transport_active_.load(std::memory_order_acquire) || !dop_ring_buffer_ ||
        channels != track_info_.channels) {
        return 0;
    }
    const int read = dop_ring_buffer_->read(output, frames);
    if (read < frames) glitch_count_.fetch_add(1, std::memory_order_relaxed);
    // The producer may run ahead of the audio clock, so the consumer owns
    // marker phase. This keeps 0x05/0xFA continuous across an underrun. A
    // DSD byte value of 0x69 is the conventional sigma-delta silence pattern.
    for (int frame = 0; frame < frames; ++frame) {
        const uint8_t marker = dop_output_marker_;
        for (int channel = 0; channel < channels; ++channel) {
            uint8_t* sample = output + (static_cast<size_t>(frame) * channels + channel) * 3;
            if (frame >= read) { sample[0] = 0x69; sample[1] = 0x69; }
            sample[2] = marker;
        }
        dop_output_marker_ = marker == 0x05 ? 0xFA : 0x05;
    }
    dop_carrier_frames_.fetch_add(read, std::memory_order_relaxed);
    if (!decoder_running_ && dop_ring_buffer_->readable_frames() == 0 &&
        !track_ended_fired_.exchange(true, std::memory_order_acq_rel)) {
        mark_track_ended_pending();
    }
    return frames;
}

int AudioEngine::audio_callback(float* output, int frames, int channels) {
    if (pcm_io_resetting_.load(std::memory_order_acquire)) {
        std::memset(output, 0, frames * channels * sizeof(float));
        return frames;
    }
    pcm_callbacks_in_flight_.fetch_add(1, std::memory_order_acq_rel);
    struct CallbackGuard {
        std::atomic<int>& count;
        ~CallbackGuard() { count.fetch_sub(1, std::memory_order_release); }
    } guard{pcm_callbacks_in_flight_};
    if (pcm_io_resetting_.load(std::memory_order_acquire) ||
        (state_ != EngineState::Playing && state_ != EngineState::Ready) || !ring_buffer_ ||
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
    // During device startup the backend can call us while state is Ready,
    // before decoder_thread_ has been created. That temporary empty queue is
    // not EOF (notably for synchronous ASIO start callbacks).
    const bool input_ended = state_ != EngineState::Ready && !decoder_running_ &&
                             ring_buffer_->frames_available() == 0;
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
        mark_track_ended_pending();
    }

    if (analysis_ring_buffer_) {
        const int written = analysis_ring_buffer_->write(output, frames, 0);
        if (written < frames) analysis_dropped_frames_.fetch_add(frames - written, std::memory_order_relaxed);
    }
    analysis_output_frames_.fetch_add(frames, std::memory_order_relaxed);

    return frames;
}

void AudioEngine::analysis_thread_func() {
    struct Biquad {
        float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f, a1 = 0.0f, a2 = 0.0f, z1 = 0.0f, z2 = 0.0f;
        float process(float input) { const float output = b0 * input + z1; z1 = b1 * input - a1 * output + z2; z2 = b2 * input - a2 * output; return output; }
    };
    float previous_rms = 0.0f;
    float lowpass = 0.0f;
    float onset_average = 0.002f;
    uint64_t consumed_frames = 0, last_beat_frame = 0;
    uint64_t reset_generation = analysis_reset_generation_.load(std::memory_order_acquire);
    int loudness_channels = 0;
    float loudness_rate = 0.0f;
    std::vector<Biquad> shelf_filters, highpass_filters;
    std::deque<std::pair<int, double>> momentary_window, short_term_window;
    std::vector<double> integrated_blocks;
    double momentary_energy = 0.0, short_term_energy = 0.0, integrated_energy = 0.0;
    int momentary_frames = 0, short_term_frames = 0, integrated_frames = 0;
    uint64_t loudness_log_frames = 0;
    auto configure_loudness = [&](int channels, float rate) {
        loudness_channels = channels; loudness_rate = rate;
        shelf_filters.assign(channels, {}); highpass_filters.assign(channels, {});
        const float shelf_a = std::pow(10.0f, 4.0f / 40.0f), shelf_w = 6.28318530718f * 1681.97445f / rate;
        const float shelf_alpha = std::sin(shelf_w) / (2.0f * 0.707175f), shelf_beta = 2.0f * std::sqrt(shelf_a) * shelf_alpha;
        const float shelf_cos = std::cos(shelf_w), shelf_a0 = (shelf_a + 1.0f) - (shelf_a - 1.0f) * shelf_cos + shelf_beta;
        const float hp_w = 6.28318530718f * 38.13547f / rate, hp_cos = std::cos(hp_w), hp_alpha = std::sin(hp_w) / (2.0f * 0.500327f);
        const float hp_a0 = 1.0f + hp_alpha;
        for (int channel = 0; channel < channels; ++channel) {
            auto& shelf = shelf_filters[channel];
            shelf.b0 = shelf_a * ((shelf_a + 1.0f) + (shelf_a - 1.0f) * shelf_cos + shelf_beta) / shelf_a0;
            shelf.b1 = -2.0f * shelf_a * ((shelf_a - 1.0f) + (shelf_a + 1.0f) * shelf_cos) / shelf_a0;
            shelf.b2 = shelf_a * ((shelf_a + 1.0f) + (shelf_a - 1.0f) * shelf_cos - shelf_beta) / shelf_a0;
            // RBJ high-shelf denominator: the sign between these terms is
            // essential. A '+' makes one pole leave the unit circle and the
            // energy accumulator reaches infinity within milliseconds.
            shelf.a1 = 2.0f * ((shelf_a - 1.0f) - (shelf_a + 1.0f) * shelf_cos) / shelf_a0;
            shelf.a2 = ((shelf_a + 1.0f) - (shelf_a - 1.0f) * shelf_cos - shelf_beta) / shelf_a0;
            auto& highpass = highpass_filters[channel];
            highpass.b0 = (1.0f + hp_cos) * 0.5f / hp_a0; highpass.b1 = -(1.0f + hp_cos) / hp_a0; highpass.b2 = highpass.b0;
            highpass.a1 = -2.0f * hp_cos / hp_a0; highpass.a2 = (1.0f - hp_alpha) / hp_a0;
        }
    };
    auto reset_loudness = [&] {
        momentary_window.clear(); short_term_window.clear(); integrated_blocks.clear();
        momentary_energy = short_term_energy = integrated_energy = 0.0;
        momentary_frames = short_term_frames = integrated_frames = 0;
        loudness_channels = 0; loudness_rate = 0.0f;
    };
    auto lufs_from_energy = [](double energy) { return static_cast<float>(std::max(-70.0, -0.691 + 10.0 * std::log10(std::max(energy, 1.0e-12)))); };
    while (analysis_running_.load(std::memory_order_acquire)) {
        if (!analysis_ring_buffer_ || analysis_work_buffer_.empty()) { std::this_thread::sleep_for(std::chrono::milliseconds(10)); continue; }
        const int frames = analysis_ring_buffer_->read(analysis_work_buffer_.data(), 1024);
        if (frames == 0) { std::this_thread::sleep_for(std::chrono::milliseconds(10)); continue; }
        // The tap carries final output PCM in FIFO order. Remaining queued
        // frames let us tag the processed analysis frame on the output clock.
        const uint64_t produced = analysis_output_frames_.load(std::memory_order_acquire);
        const uint64_t queued = static_cast<uint64_t>(std::max(0, analysis_ring_buffer_->frames_available()));
        analysis_processed_frames_.store(produced > queued ? produced - queued : 0, std::memory_order_release);
        const uint64_t requested_reset = analysis_reset_generation_.load(std::memory_order_acquire);
        if (requested_reset != reset_generation) {
            previous_rms = 0.0f;
            lowpass = 0.0f;
            onset_average = 0.002f;
            consumed_frames = 0;
            last_beat_frame = 0;
            reset_loudness();
            reset_generation = requested_reset;
            continue;
        }
        const int channels = std::max(1, static_cast<int>(analysis_work_buffer_.size() / 1024));
        const float sample_rate = backend_ ? static_cast<float>(backend_->current_format().sample_rate) : 48000.0f;
        if (channels != loudness_channels || std::abs(sample_rate - loudness_rate) > 0.5f) configure_loudness(channels, sample_rate);
        double square_sum = 0.0, low_square_sum = 0.0, weighted_square_sum = 0.0;
        for (int frame = 0; frame < frames; ++frame) {
            float mono = 0.0f; for (int channel = 0; channel < channels; ++channel) mono += analysis_work_buffer_[frame * channels + channel];
            mono /= channels; lowpass = 0.94f * lowpass + 0.06f * mono;
            square_sum += mono * mono; low_square_sum += lowpass * lowpass;
            for (int channel = 0; channel < channels; ++channel) {
                const float input = analysis_work_buffer_[frame * channels + channel];
                float filtered = highpass_filters[channel].process(shelf_filters[channel].process(input));
                // A malformed source sample must not poison a persistent IIR
                // state and make the public loudness meter permanently NaN.
                if (!std::isfinite(filtered)) {
                    shelf_filters[channel].z1 = shelf_filters[channel].z2 = 0.0f;
                    highpass_filters[channel].z1 = highpass_filters[channel].z2 = 0.0f;
                    filtered = std::isfinite(input) ? input : 0.0f;
                }
                const float channel_weight = channels > 3 && channel == 3 ? 0.0f : (channels > 3 && channel >= 4 ? 1.41421356f : 1.0f);
                weighted_square_sum += channel_weight * filtered * filtered;
            }
        }
        // Preserve a usable output meter if a non-standard multichannel layout
        // exposes only an LFE lane. Normal stereo/multichannel input uses the
        // K-weighted value above.
        if (!(weighted_square_sum > 0.0) && square_sum > 0.0) weighted_square_sum = square_sum;
        const float rms = std::sqrt(static_cast<float>(square_sum / frames));
        analysis_rms_.store(rms, std::memory_order_release);
        analysis_low_energy_.store(std::sqrt(static_cast<float>(low_square_sum / frames)), std::memory_order_release);
        const float onset = std::max(0.0f, rms - previous_rms);
        analysis_onset_strength_.store(onset, std::memory_order_release);
        momentary_window.emplace_back(frames, weighted_square_sum); momentary_energy += weighted_square_sum; momentary_frames += frames;
        short_term_window.emplace_back(frames, weighted_square_sum); short_term_energy += weighted_square_sum; short_term_frames += frames;
        const int momentary_limit = std::max(1, static_cast<int>(sample_rate * 0.4f)), short_term_limit = std::max(1, static_cast<int>(sample_rate * 3.0f));
        while (momentary_frames > momentary_limit && !momentary_window.empty()) { momentary_frames -= momentary_window.front().first; momentary_energy -= momentary_window.front().second; momentary_window.pop_front(); }
        while (short_term_frames > short_term_limit && !short_term_window.empty()) { short_term_frames -= short_term_window.front().first; short_term_energy -= short_term_window.front().second; short_term_window.pop_front(); }
        analysis_momentary_lufs_.store(lufs_from_energy(momentary_energy / std::max(1, momentary_frames)), std::memory_order_release);
        analysis_short_term_lufs_.store(lufs_from_energy(short_term_energy / std::max(1, short_term_frames)), std::memory_order_release);
        loudness_log_frames += frames;
        if (loudness_log_frames >= static_cast<uint64_t>(sample_rate * 2.0f)) {
            loudness_log_frames = 0;
            LOG_INFO("Loudness analysis: energy=" + std::to_string(weighted_square_sum / std::max(1, frames)) +
                     ", M=" + std::to_string(analysis_momentary_lufs_.load(std::memory_order_relaxed)) +
                     ", S=" + std::to_string(analysis_short_term_lufs_.load(std::memory_order_relaxed)));
        }
        integrated_energy += weighted_square_sum; integrated_frames += frames;
        if (integrated_frames >= momentary_limit) {
            const double block_energy = integrated_energy / integrated_frames;
            if (lufs_from_energy(block_energy) > -70.0f) integrated_blocks.push_back(block_energy);
            if (!integrated_blocks.empty()) {
                double absolute_sum = 0.0; for (double energy : integrated_blocks) absolute_sum += energy;
                const float ungated = lufs_from_energy(absolute_sum / integrated_blocks.size());
                double gated_sum = 0.0; int gated_count = 0;
                for (double energy : integrated_blocks) if (lufs_from_energy(energy) > ungated - 10.0f) { gated_sum += energy; ++gated_count; }
                analysis_integrated_lufs_.store(lufs_from_energy(gated_sum / std::max(1, gated_count)), std::memory_order_release);
            }
            integrated_energy = 0.0; integrated_frames = 0;
        }
        const uint64_t minimum_interval = static_cast<uint64_t>(sample_rate * 0.18f);
        if (onset > std::max(0.003f, onset_average * 1.8f) && (last_beat_frame == 0 || consumed_frames - last_beat_frame >= minimum_interval)) {
            if (last_beat_frame != 0) {
                const float instant_bpm = 60.0f * sample_rate / static_cast<float>(consumed_frames - last_beat_frame);
                if (instant_bpm >= 55.0f && instant_bpm <= 220.0f) {
                    const float prior = analysis_bpm_.load(std::memory_order_relaxed);
                    analysis_bpm_.store(prior > 0.0f ? prior * 0.8f + instant_bpm * 0.2f : instant_bpm, std::memory_order_release);
                }
            }
            last_beat_frame = consumed_frames;
            analysis_beat_sequence_.fetch_add(1, std::memory_order_release);
        }
        onset_average = onset_average * 0.94f + onset * 0.06f;
        for (int band = 0; band < 64; ++band) {
            const float frequency = std::min(sample_rate * 0.45f, 45.0f * std::pow(2.0f, band / 10.0f));
            float real = 0.0f, imaginary = 0.0f;
            for (int frame = 0; frame < frames; ++frame) {
                float mono = 0.0f; for (int channel = 0; channel < channels; ++channel) mono += analysis_work_buffer_[frame * channels + channel];
                const float window = 0.5f - 0.5f * std::cos(6.28318530718f * frame / std::max(1, frames - 1));
                const float phase = 6.28318530718f * frequency * frame / sample_rate;
                real += mono * window * std::cos(phase); imaginary -= mono * window * std::sin(phase);
            }
            analysis_spectrum_[band].store(std::min(1.0f, 4.0f * std::sqrt(real * real + imaginary * imaginary) / frames), std::memory_order_release);
        }
        previous_rms = 0.85f * previous_rms + 0.15f * rms;
        consumed_frames += frames;
    }
}
