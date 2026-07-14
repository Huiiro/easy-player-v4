#include "audio_engine.h"
#include "dsound_backend.h"
#include "wasapi_backend.h"
#include "logger.h"
#include <algorithm>
#include <chrono>
#include <unordered_set>
#include <vector>

AudioEngine::AudioEngine() {}

AudioEngine::~AudioEngine() {
    stop();
    if (backend_) backend_->close();
}

// ──────────────────────────────────────────────────────────
// Lifecycle
// ──────────────────────────────────────────────────────────

bool AudioEngine::open(const std::string& file_path) {
    set_state(EngineState::Loading);

    if (!decoder_.open(file_path)) {
        set_state(EngineState::Idle);
        if (error_cb_) error_cb_(-1, "Failed to open file: " + file_path);
        return false;
    }

    track_info_ = decoder_.track_info();
    track_ended_fired_ = false;

    // Create ring buffer: ~750ms capacity
    int buffer_frames = (int)(track_info_.sample_rate * 0.75);
    ring_buffer_ = std::make_unique<RingBuffer>(track_info_.channels, buffer_frames);

    set_state(EngineState::Ready);
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
            case BackendType::DIRECTSOUND:
            default:
                backend_ = std::make_unique<DSoundBackend>();
                break;
        }

        AudioFormat requested;
        requested.sample_rate = track_info_.sample_rate;
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
        track_ended_fired_ = false;
        if (!decoder_.seek(sample_pos)) return false;

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
    volume_.store(std::max(0.0f, std::min(1.0f, volume)), std::memory_order_relaxed);
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

    // WASAPI devices first (preferred)
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
    if (current_device_id_ == device_id) return true;

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

    current_device_id_ = device_id;

    // If we were playing, recreate backend and resume
    if (was_playing) {
        return play();
    }
    return true;
}

bool AudioEngine::set_backend(BackendType type) {
    if (current_backend_type_ == type) return true;
    // Phase 0: only DIRECTSOUND, WASAPI_SHARED, WASAPI_EXCLUSIVE are implemented
    if (type != BackendType::DIRECTSOUND &&
        type != BackendType::WASAPI_SHARED &&
        type != BackendType::WASAPI_EXCLUSIVE) {
        return false;
    }

    bool was_playing = (state_ == EngineState::Playing);

    // Need to transition state so that play() will actually reconstruct
    // the backend instead of short-circuiting on `state_ == Playing`.
    if (was_playing) {
        state_.store(EngineState::Paused, std::memory_order_release);
    }

    // Stop backend and threads
    if (backend_) {
        backend_->stop();
        backend_->close();
        backend_.reset();
    }
    // If there are threads running (decoder/timer), reset them too
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
    return (double)decoder_.position() / track_info_.sample_rate * 1000.0;
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

        if (pos_cb_ && state_ == EngineState::Playing) {
            pos_cb_(position_ms(), duration_ms());
        }
    }
}

// ──────────────────────────────────────────────────────────
// Audio callback (runs in real-time audio thread)
// ──────────────────────────────────────────────────────────

int AudioEngine::audio_callback(float* output, int frames, int channels) {
    if (state_ != EngineState::Playing) {
        // Paused or stopped: output silence
        std::memset(output, 0, frames * channels * sizeof(float));
        return frames;
    }

    // Read from ring buffer
    int read = ring_buffer_->read(output, frames);

    if (read < frames) {
        glitch_count_.fetch_add(1, std::memory_order_relaxed);
    }

    // Check for end-of-stream: decoder stopped AND ring buffer is (nearly) empty
    if (!track_ended_fired_ && !decoder_running_ && ring_buffer_->frames_available() == 0) {
        track_ended_fired_ = true;
        LOG_INFO("Track ended (EOF reached)");
        // Notify via state callback
        if (state_cb_) {
            state_cb_(EngineState::Stopped);
        }
    }

    // Apply volume (atomic load)
    float vol = volume_.load(std::memory_order_relaxed);
    if (vol != 1.0f) {
        for (int i = 0; i < frames * channels; ++i) {
            output[i] *= vol;
        }
    }

    return frames;
}
