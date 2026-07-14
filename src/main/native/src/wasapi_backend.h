#pragma once
#include "audio_backend.h"
#include <memory>

// WASAPI backend — Phase 1 implementation.
// Supports Shared (AUDCLNT_SHAREMODE_SHARED) and Exclusive
// (AUDCLNT_SHAREMODE_EXCLUSIVE) modes via IAudioClient.
class WasapiBackend : public AudioBackend {
public:
    WasapiBackend(bool exclusive);
    ~WasapiBackend() override;

    std::vector<DeviceInfo> enumerate_devices() override;

    AudioFormat open(
        const std::wstring& device_id,
        const AudioFormat& requested_format,
        AudioCallback callback) override;

    bool start() override;
    bool stop() override;
    void close() override;
    void flush() override {}

    BackendType type() const override {
        return exclusive_ ? BackendType::WASAPI_EXCLUSIVE : BackendType::WASAPI_SHARED;
    }
    AudioFormat current_format() const override { return current_format_; }
    bool is_active() const override { return active_; }
    int buffer_size_frames() const override { return buffer_frames_; }
    double latency_ms() const override { return latency_ms_; }

private:
    bool exclusive_;
    AudioFormat current_format_;
    AudioCallback callback_;
    bool active_ = false;
    int buffer_frames_ = 0;
    double latency_ms_ = 0.0;

    struct Impl;
    std::unique_ptr<Impl> impl_;
};
