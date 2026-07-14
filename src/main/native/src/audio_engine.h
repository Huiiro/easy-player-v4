#pragma once
#include "audio_backend.h"
#include "decoder.h"
#include "ring_buffer.h"
#include <atomic>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

enum class EngineState {
    Idle,
    Loading,
    Ready,
    Playing,
    Paused,
    Stopped
};

class AudioEngine {
public:
    AudioEngine();
    ~AudioEngine();

    // ── Lifecycle ──
    bool open(const std::string& file_path);
    bool play();
    bool pause();
    bool stop();

    // ── Seek ──
    bool seek(double position_ms);

    // ── Control ──
    void set_volume(float volume); // 0.0 - 1.0
    float volume() const { return volume_.load(); }

    // ── Device / Backend ──
    std::vector<DeviceInfo> enumerate_devices();
    bool set_device(const std::wstring& device_id);
    bool set_backend(BackendType type);

    // ── Query ──
    EngineState state() const { return state_; }
    double position_ms() const;
    double duration_ms() const { return track_info_.duration_ms; }
    const TrackInfo& track_info() const { return track_info_; }
    bool is_playing() const { return state_ == EngineState::Playing; }
    int glitch_count() const { return glitch_count_.load(); }

    // ── Callbacks (called from native) ──
    using StateChangedCallback = std::function<void(EngineState)>;
    using PositionCallback = std::function<void(double ms, double duration_ms)>;
    using ErrorCallback = std::function<void(int code, const std::string& msg)>;
    using LogCallback = std::function<void(int level, const std::string& msg)>;

    void set_state_callback(StateChangedCallback cb) { state_cb_ = std::move(cb); }
    void set_position_callback(PositionCallback cb) { pos_cb_ = std::move(cb); }
    void set_error_callback(ErrorCallback cb) { error_cb_ = std::move(cb); }

private:
    void set_state(EngineState new_state);
    void decoder_thread_func();
    void position_timer_func();
    int audio_callback(float* output, int frames, int channels);

    // ── State ──
    std::atomic<EngineState> state_{EngineState::Idle};

    // ── Backend ──
    std::unique_ptr<AudioBackend> backend_;
    BackendType current_backend_type_{BackendType::DIRECTSOUND};
    std::wstring current_device_id_{L"default"};

    // ── Decoder ──
    Decoder decoder_;
    TrackInfo track_info_;
    std::unique_ptr<RingBuffer> ring_buffer_;
    std::unique_ptr<std::thread> decoder_thread_;
    std::atomic<bool> decoder_running_{false};
    std::atomic<int> seek_generation_{0};  // incremented on each seek to invalidate stale decoder output
    std::mutex decoder_mutex_;             // protects decoder from concurrent seek/decode

    // ── Position timer ──
    std::unique_ptr<std::thread> position_timer_;
    std::atomic<bool> timer_running_{false};

    // ── Control params (atomic for lock-free audio thread access) ──
    std::atomic<float> volume_{1.0f};
    std::atomic<int> glitch_count_{0};

    // ── Callbacks ──
    StateChangedCallback state_cb_;
    PositionCallback pos_cb_;
    ErrorCallback error_cb_;

    // ── Track ended detection (audio thread only) ──
    bool track_ended_fired_ = false;
};
