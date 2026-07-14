#include "audio_engine.h"
#include "dsound_backend.h"
#include "logger.h"
#include <algorithm>
#include <chrono>

AudioEngine::AudioEngine() : current_backend_type_(BackendType::DIRECTSOUND) {}

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
        backend_ = std::make_unique<DSoundBackend>();

        AudioFormat requested;
        requested.sample_rate = track_info_.sample_rate;
        requested.bit_depth = 16;
        requested.channels = track_info_.channels;

        auto cb = [this](float* output, int frames, int channels) -> int {
            return this->audio_callback(output, frames, channels);
        };

        AudioFormat actual = backend_->open(L"default", requested, cb);
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

    // Invalidate any in-flight decoder data, then reset the ring buffer
    seek_generation_.fetch_add(1, std::memory_order_release);
    if (ring_buffer_) ring_buffer_->reset();
    track_ended_fired_ = false;
    if (!decoder_.seek(sample_pos)) return false;

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

    // Enumerate DSound devices (always available)
    DSoundBackend ds;
    auto ds_devices = ds.enumerate_devices();
    devices.insert(devices.end(), ds_devices.begin(), ds_devices.end());

    // TODO: enumerate WASAPI, ASIO in later phases
    return devices;
}

bool AudioEngine::set_device(const std::wstring& device_id) {
    // Phase 0: DSound only — all devices use the same path
    return true;
}

bool AudioEngine::set_backend(BackendType type) {
    // Phase 0: only DIRECTSOUND is implemented
    if (type != BackendType::DIRECTSOUND) return false;
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

        // Snapshot generation before decode so we can detect a concurrent seek
        int gen = seek_generation_.load(std::memory_order_acquire);
        int decode_chunk = std::min(target, 4096);
        std::vector<float> buffer(decode_chunk * channels);

        int decoded = decoder_.decode(buffer.data(), decode_chunk);
        if (decoded <= 0) {
            // EOF or error — stop
            LOG_INFO("Decoder reached EOF");
            decoder_running_ = false;
            break;
        }

        // If a seek happened while we were decoding, discard this stale data
        if (seek_generation_.load(std::memory_order_acquire) != gen) {
            continue; // skip write, will retry with new position
        }

        ring_buffer_->write(buffer.data(), decoded, 100);
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
