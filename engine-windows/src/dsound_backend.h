#pragma once
#include "audio_backend.h"
#include <memory>

// DirectSound backend — fallback for systems without WASAPI.
// On modern Windows, DirectSound is internally emulated via WASAPI Shared.
class DSoundBackend : public AudioBackend {
public:
    DSoundBackend();
    ~DSoundBackend() override;

    std::vector<DeviceInfo> enumerate_devices() override;

    AudioFormat open(
        const std::wstring& device_id,
        const AudioFormat& requested_format,
        AudioCallback callback) override;

    bool start() override;
    bool stop() override;
    void close() override;
    void flush() override;

    BackendType type() const override { return BackendType::DIRECTSOUND; }
    AudioFormat current_format() const override { return current_format_; }
    bool is_active() const override { return active_; }
    int buffer_size_frames() const override { return buffer_frames_; }
    double latency_ms() const override { return latency_ms_; }

    // Allow the audio thread proc to access internal implementation
    friend unsigned __stdcall dsound_thread_proc(void* param);

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;

    AudioFormat current_format_;
    bool active_ = false;
    int buffer_frames_ = 0;
    double latency_ms_ = 0.0;
};
