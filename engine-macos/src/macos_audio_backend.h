#pragma once

#include "audio_backend.h"
#include <atomic>
#include <memory>

// Shared-mode CoreAudio output for the system default device. The engine
// supplies float PCM through AudioCallback; AudioQueue owns the real-time
// callback thread and device timing.
class MacOSAudioBackend final : public AudioBackend {
public:
    MacOSAudioBackend();
    ~MacOSAudioBackend() override;

    std::vector<DeviceInfo> enumerate_devices() override;
    AudioFormat open(const std::wstring& device_id, const AudioFormat& requested_format,
                     AudioCallback callback) override;
    bool start() override;
    bool stop() override;
    void close() override;

    // DIRECTSOUND remains the cross-platform "system default shared output"
    // enum until the backend type contract gets a platform-neutral name.
    BackendType type() const override { return BackendType::DIRECTSOUND; }
    AudioFormat current_format() const override;
    bool is_active() const override { return active_.load(std::memory_order_acquire); }
    int buffer_size_frames() const override;
    double latency_ms() const override;
    void flush() override;

private:
    struct Impl;
    static void output_callback(void* user_data, void* queue, void* buffer);

    std::unique_ptr<Impl> impl_;
    std::atomic<bool> active_{false};
};
