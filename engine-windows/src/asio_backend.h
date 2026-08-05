#pragma once
#include "audio_backend.h"
#include <memory>

// ASIO backend — Phase 2 implementation.
// Loads ASIO drivers dynamically from the registry via LoadLibrary.
// Supports Native DSD when the DAC reports DSD capability.
class AsioBackend : public AudioBackend {
public:
    AsioBackend();
    ~AsioBackend() override;

    std::vector<DeviceInfo> enumerate_devices() override;

    AudioFormat open(
        const std::wstring& device_id,
        const AudioFormat& requested_format,
        AudioCallback callback) override;
    AudioFormat open_dop(
        const std::wstring& device_id,
        const AudioFormat& requested_format,
        RawAudioCallback callback) override;

    bool start() override;
    bool stop() override;
    void close() override;
    void flush() override;  // no-op for ASIO (double-buffered)

    BackendType type() const override { return BackendType::ASIO; }
    AudioFormat current_format() const override { return current_format_; }
    bool is_active() const override { return active_; }
    int buffer_size_frames() const override { return buffer_frames_; }
    double latency_ms() const override { return latency_ms_; }

private:
    AudioFormat current_format_;
    AudioCallback callback_;
    bool preparing_dop_open_ = false;
    bool active_ = false;
    int buffer_frames_ = 0;
    double latency_ms_ = 0.0;

    // Allow the ASIO callbacks to access internal implementation
    friend void asio_buffer_switch(long dbIndex, long directProcess);
    friend void asio_sample_rate_did_change(double sRate);
    friend long asio_message(long selector, long value, void* message, double* opt);

    // Allow file-scope callbacks to access Impl
    friend void buf_switch(long idx, long dp);
    friend void sr_change(double);
    friend long asio_msg(long,long,void*,double*);

    struct Impl;
    std::unique_ptr<Impl> impl_;
};
