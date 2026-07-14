#pragma once

#include <functional>
#include <memory>
#include <string>
#include <vector>

enum class BackendType {
    WASAPI_SHARED,
    WASAPI_EXCLUSIVE,
    ASIO,
    DIRECTSOUND
};

struct DeviceInfo {
    std::wstring id;
    std::wstring name;
    BackendType backend;
    bool is_default;
    int max_channels;
    std::vector<int> sample_rates;
    std::vector<int> bit_depths;
    bool supports_exclusive;
    bool supports_dsd;
};

struct AudioFormat {
    int sample_rate;
    int bit_depth;
    int channels;
};

// Audio callback invoked from the real-time audio thread.
// Must never allocate, lock, or do I/O.
// Returns the number of frames actually filled (normally equals `frames`).
using AudioCallback = std::function<int(float* output, int frames, int channels)>;

class AudioBackend {
public:
    virtual ~AudioBackend() = default;

    virtual std::vector<DeviceInfo> enumerate_devices() = 0;

    virtual AudioFormat open(
        const std::wstring& device_id,
        const AudioFormat& requested_format,
        AudioCallback callback) = 0;

    virtual bool start() = 0;
    virtual bool stop() = 0;
    virtual void close() = 0;

    virtual BackendType type() const = 0;
    virtual AudioFormat current_format() const = 0;
    virtual bool is_active() const = 0;

    virtual int buffer_size_frames() const = 0;
    virtual double latency_ms() const = 0;
};
