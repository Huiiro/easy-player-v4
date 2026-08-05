#pragma once

#include "audio_backend.h"
#include <aaudio/AAudio.h>
#include <atomic>
#include <memory>

// Android output backend using the NDK AAudio API (API 26+). It only accepts
// float PCM; AudioEngine performs decoding, channel conversion and DSP before
// invoking the callback.
class AndroidAAudioBackend final : public AudioBackend {
public:
    AndroidAAudioBackend();
    ~AndroidAAudioBackend() override;

    std::vector<DeviceInfo> enumerate_devices() override;
    AudioFormat open(const std::wstring& device_id, const AudioFormat& requested_format,
                     AudioCallback callback) override;
    bool start() override;
    bool stop() override;
    void close() override;

    BackendType type() const override { return BackendType::DIRECTSOUND; }
    AudioFormat current_format() const override;
    bool is_active() const override { return active_.load(std::memory_order_acquire); }
    int buffer_size_frames() const override;
    double latency_ms() const override;
    void flush() override;

private:
    struct Impl;
    static aaudio_data_callback_result_t data_callback(AAudioStream* stream, void* user_data,
                                                       void* audio_data, int32_t num_frames);
    static void error_callback(AAudioStream* stream, void* user_data, aaudio_result_t error);

    std::unique_ptr<Impl> impl_;
    std::atomic<bool> active_{false};
};
