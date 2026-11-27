// Output device selection, format negotiation, startup and recovery.
// Worker threads are joined before teardown replaces the backend.

#include "audio_engine.h"
#include "audio_engine_logging.h"
#include "logger.h"
#include <algorithm>
#include <vector>

using audio_engine_detail::backend_name;
using audio_engine_detail::format_audio;

bool AudioEngine::start_output(bool resuming) {
    // Ensure we have a backend
    if (!backend_) {
        if (!backend_factory_) {
            LOG_ERROR("Play failed: no backend factory, path=" + track_info_.file_path);
            if (error_cb_) error_cb_(-2, "No audio backend factory configured");
            return false;
        }
        backend_ = backend_factory_->create(current_backend_type_);
        if (!backend_) {
            LOG_ERROR("Play failed: backend=" + std::string(backend_name(current_backend_type_)) +
                      " unavailable, path=" + track_info_.file_path);
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
            LOG_DEBUG("DSD transport decision: Native DSD unavailable; PCM conversion remains the fallback path");
        }

        AudioFormat actual{};
        dop_fallback_reason_ = "";
        const bool dop_backend = current_backend_type_ == BackendType::WASAPI_EXCLUSIVE ||
            current_backend_type_ == BackendType::ASIO;
        const bool request_dop = track_info_.is_dsd && dop_enabled_ &&
            !force_output_rate_ && dop_backend &&
            track_info_.dsd_sample_rate > 0 && track_info_.channels >= 1 && track_info_.channels <= 8;
        if (request_dop) {
            const int carrier_rate = track_info_.dsd_sample_rate / 16;
            const int64_t resume_carrier_frame = reopen_position_ms_ > 0
                ? static_cast<int64_t>(reopen_position_ms_ * carrier_rate / 1000.0) : 0;
            AudioFormat dop_requested{carrier_rate, 24, track_info_.channels};
            if (decoder_.begin_dop(resume_carrier_frame)) {
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
                        dop_fallback_reason_ = "primingFailed";
                        LOG_WARN("DSD DoP priming failed: requested_frames=" + std::to_string(prime_frames) +
                                 ", decoded_frames=" + std::to_string(primed) + ", path=" + track_info_.file_path + "; using PCM");
                        backend_->close();
                        backend_ = backend_factory_->create(current_backend_type_);
                        dop_transport_active_.store(false, std::memory_order_release);
                        dop_ring_buffer_.reset();
                        dop_work_buffer_.clear();
                        decoder_.seek(0);
                        actual = {};
                    } else {
                        track_info_.dsd_transport = "dop";
                        dop_carrier_frames_.store(resume_carrier_frame, std::memory_order_release);
                        LOG_DEBUG("DSD DoP active: " + std::to_string(track_info_.dsd_sample_rate) +
                                 "Hz -> PCM24 carrier " + std::to_string(carrier_rate) + "Hz; DSP, volume and analysis bypassed");
                    }
                } else {
                    dop_fallback_reason_ = "carrierRejected";
                    LOG_WARN("DSD DoP format rejected: backend=" + std::string(backend_name(current_backend_type_)) +
                             ", requested=" + format_audio(dop_requested) + ", actual=" + format_audio(actual) + "; using PCM");
                    backend_->close();
                    backend_ = backend_factory_->create(current_backend_type_);
                    dop_transport_active_.store(false, std::memory_order_release);
                    dop_ring_buffer_.reset();
                    dop_work_buffer_.clear();
                    decoder_.seek(0);
                    actual = {};
                }
            } else {
                dop_fallback_reason_ = "decoderPreparationFailed";
                LOG_WARN("DSD DoP preparation failed; falling back to PCM conversion");
            }
        } else if (track_info_.is_dsd && dop_enabled_) {
            if (!dop_backend) dop_fallback_reason_ = "backendUnsupported";
            else if (force_output_rate_) dop_fallback_reason_ = "forcedOutputRate";
            else dop_fallback_reason_ = "unsupportedSource";
            LOG_WARN("DSD DoP requires WASAPI Exclusive or ASIO, source-rate output, and 1-8 channels; using PCM conversion");
        }
        if (actual.sample_rate == 0) {
            LOG_DEBUG(track_info_.is_dsd
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
                LOG_DEBUG("Output format attempt: backend=" + std::string(backend_name(current_backend_type_)) +
                          ", requested=" + format_audio(requested) + ", path=" + track_info_.file_path);
                actual = backend_->open(current_device_id_, requested, cb);
                LOG_DEBUG("Output format result: requested=" + format_audio(requested) + ", actual=" + format_audio(actual));
                if (actual.sample_rate != 0) break;
            }
            if (actual.sample_rate != 0) break;
            if (track_info_.is_dsd) LOG_DEBUG("DSD PCM candidate rate rejected: " + std::to_string(rate) + "Hz");
        }
        }
        if (actual.sample_rate == 0) {
            LOG_ERROR("Play failed after output format negotiation: backend=" + std::string(backend_name(current_backend_type_)) +
                      ", last_requested=" + format_audio(requested) + ", candidate_rates=" +
                      std::to_string(candidate_rates.size()) + ", path=" + track_info_.file_path);
            // Leave no half-open output behind: a subsequent play() must retry
            // negotiation instead of skipping initialization with backend_ set.
            backend_->close();
            backend_.reset();
            if (error_cb_) error_cb_(-2, "Failed to open audio device");
            return false;
        }
        if (force_output_rate_ && actual.sample_rate != target_sample_rate_) {
            LOG_WARN("Resampler target unavailable: requested " +
                     std::to_string(target_sample_rate_) + "Hz, backend opened at " +
                     std::to_string(actual.sample_rate) + "Hz" +
                     (current_backend_type_ == BackendType::WASAPI_SHARED
                         ? " (WASAPI Shared uses the Windows mix format)"
                         : " (device or driver selected another rate)") +
                     "; SRC will use the actual backend rate");
        }
        if (!dop_transport_active_.load(std::memory_order_acquire)) {
            track_info_.dsd_transport = track_info_.is_dsd ? "pcm_conversion" : "";
            if (track_info_.is_dsd && actual.sample_rate != track_info_.sample_rate) {
                LOG_WARN("DSD PCM fallback selected: " + std::to_string(track_info_.sample_rate) + "Hz -> " +
                         std::to_string(actual.sample_rate) + "Hz (libsamplerate SRC)");
            }
            if (!ring_buffer_) {
                ring_buffer_ = std::make_unique<RingBuffer>(track_info_.channels,
                    static_cast<int>(track_info_.sample_rate * 0.75));
            }
            if (reopen_position_ms_ >= 0) {
                const int64_t sample = static_cast<int64_t>(reopen_position_ms_ * track_info_.sample_rate / 1000.0);
                if (!decoder_.seek(sample)) {
                    LOG_ERROR("Cannot restore PCM position after output reconfiguration");
                    return false;
                }
                ring_buffer_->reset();
                played_frames_.store(track_start_frame_.load(std::memory_order_acquire) + sample,
                                     std::memory_order_release);
            }
            dsp_pipeline_.configure(
                {track_info_.sample_rate, track_info_.bit_depth, track_info_.channels},
                actual,
                backend_->type(),
                backend_->buffer_size_frames());
            // 250 ms of final output PCM. The analysis thread is the
            // sole consumer; callback writes use timeout 0 and may drop frames.
            analysis_ring_buffer_ = std::make_unique<RingBuffer>(actual.channels, actual.sample_rate / 4);
            eq_monitor_ring_buffer_ = std::make_unique<RingBuffer>(actual.channels, actual.sample_rate / 8);
            analysis_dropped_frames_.store(0, std::memory_order_release);
            analysis_output_frames_.store(0, std::memory_order_release);
            analysis_processed_frames_.store(0, std::memory_order_release);
            analysis_rms_.store(0.0f, std::memory_order_release);
            analysis_low_energy_.store(0.0f, std::memory_order_release);
            analysis_onset_strength_.store(0.0f, std::memory_order_release);
            analysis_beat_sequence_.store(0, std::memory_order_release);
            analysis_bpm_.store(0.0f, std::memory_order_release);
            analysis_momentary_energy_.store(0.0, std::memory_order_release);
            analysis_short_term_energy_.store(0.0, std::memory_order_release);
            analysis_integrated_lufs_.store(-70.0f, std::memory_order_release);
            analysis_reset_generation_.fetch_add(1, std::memory_order_release);
            for (auto& level : analysis_spectrum_) level.store(0.0f, std::memory_order_release);
            analysis_work_buffer_.assign(static_cast<size_t>(1024) * actual.channels, 0.0f);
            LOG_DEBUG("Audio pipeline configured: backend=" + std::string(backend_name(current_backend_type_)) +
                  ", source=" + format_audio({track_info_.sample_rate, track_info_.bit_depth, track_info_.channels}) +
                  ", output=" + format_audio(actual) + ", buffer_frames=" + std::to_string(backend_->buffer_size_frames()) +
                  ", latency_ms=" + std::to_string(backend_->latency_ms()) +
                  (track_info_.sample_rate != actual.sample_rate ? "; SRC active" : "; SRC bypassed"));

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
                    LOG_DEBUG("PCM transport primed: " + std::to_string(primed) + " frame(s)");
                } else {
                    LOG_WARN("PCM priming failed: requested_frames=" + std::to_string(prime_frames) +
                             ", decoded_frames=" + std::to_string(primed) + ", path=" + track_info_.file_path);
                }
            }
        } else {
            // Encoded DoP is not PCM: never route it through DSP, volume,
            // SRC, meters, or the PCM analysis ring.
            ring_buffer_.reset();
            analysis_ring_buffer_.reset();
            eq_monitor_ring_buffer_.reset();
            source_work_buffer_.clear();
            source_work_frames_ = 0;
        }

        if (!backend_->start()) {
            LOG_ERROR("Play failed at backend start: backend=" + std::string(backend_name(current_backend_type_)) +
                      ", output=" + format_audio(actual) + ", path=" + track_info_.file_path);
            if (error_cb_) error_cb_(-3, "Failed to start audio device");
            backend_->close();
            backend_.reset();
            return false;
        }
        pcm_output_sample_rate_.store(
            dop_transport_active_.load(std::memory_order_acquire) ? 0 : actual.sample_rate,
            std::memory_order_release);
    } else if (resuming && dop_transport_active_.load(std::memory_order_acquire)) {
        // DoP cannot be paused by feeding zero-valued PCM frames: that would
        // invalidate the marker sequence. pause() stops the device instead.
        if (!backend_->start()) {
            LOG_ERROR("DoP resume failed: backend=" + std::string(backend_name(current_backend_type_)) + ", path=" + track_info_.file_path);
            if (error_cb_) error_cb_(-3, "Failed to resume DoP audio device");
            backend_->close();
            backend_.reset();
            return false;
        }
    }
    return true;
}

void AudioEngine::close_output() {
    // Join every reader of backend_ before stopping or destroying the device.
    if (state_ == EngineState::Playing) state_.store(EngineState::Paused, std::memory_order_release);
    timer_running_ = false;
    decoder_running_ = false;
    if (position_timer_ && position_timer_->joinable()) position_timer_->join();
    position_timer_.reset();
    if (decoder_thread_ && decoder_thread_->joinable()) decoder_thread_->join();
    decoder_thread_.reset();
    stop_analysis_thread();
    pcm_output_sample_rate_.store(0, std::memory_order_release);
    if (backend_) {
        backend_->stop();
        backend_->close();
        backend_.reset();
    }
}

bool AudioEngine::reopen_output(bool resume) {
    reopen_position_ms_ = position_ms();
    if (state_ == EngineState::Playing) state_.store(EngineState::Paused, std::memory_order_release);
    close_output();
    dop_transport_active_.store(false, std::memory_order_release);
    dop_ring_buffer_.reset();
    dop_work_buffer_.clear();
    if (ring_buffer_) ring_buffer_->reset();
    source_work_buffer_.clear();
    source_work_frames_ = 0;
    return !resume || play();
}

void AudioEngine::service_backend_events() {
    if (!backend_) return;
    const unsigned events = backend_->take_events();
    if (events & BackendEventFailure) {
        // Render-thread failures must not leave a silent device marked Playing.
        stop();
        set_state(EngineState::Stopped);
        if (error_cb_) error_cb_(-3, "Audio output failed; restart playback or select another device");
        return;
    }
    if (!(events & (BackendEventReset | BackendEventResync | BackendEventRateChanged))) return;
    LOG_WARN("Audio device requested recovery: events=" + std::to_string(events));
    const bool resume = state_ == EngineState::Playing;
    if (!reopen_output(resume)) {
        stop();
        set_state(EngineState::Stopped);
        if (error_cb_) error_cb_(-3, "Audio device recovery failed; restart playback or select another output");
    }
}

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
        LOG_WARN("Output selection rejected: backend=" + std::string(backend_name(type)) + ", factory_available=" + std::to_string(bool(backend_factory_)));
        return false;
    }
    if (current_backend_type_ == type && current_device_id_ == device_id) return true;

    bool was_playing = (state_ == EngineState::Playing);
    LOG_DEBUG("Output selection: backend=" + std::string(backend_name(current_backend_type_)) + "->" +
              backend_name(type) + ", device_changed=" + std::to_string(current_device_id_ != device_id) +
              ", resume=" + std::to_string(was_playing));

    // Need to transition state so that play() will actually reconstruct
    // the backend instead of short-circuiting on `state_ == Playing`.
    if (was_playing) {
        state_.store(EngineState::Paused, std::memory_order_release);
    }

    // Quiesce readers before releasing the device and preserve playback position.
    reopen_output(false);

    current_backend_type_ = type;
    current_device_id_ = device_id;

    // If we were playing, recreate backend and resume
    if (was_playing) {
        return play();
    }
    return true;
}
