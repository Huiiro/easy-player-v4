#pragma once
#include "audio_backend.h"
#include "byte_ring_buffer.h"
#include "decoder.h"
#include "dsp_pipeline.h"
#include "ring_buffer.h"
#include <atomic>
#include <algorithm>
#include <cstdint>
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

// With no library yet, the next queue entry is another instance of the
// opened file. A future queue can replace next_track_path_ before the window.
struct TransitionConfig {
    bool gapless_enabled = true;
    bool crossfade_enabled = false;
    int crossfade_ms = 5000;
};

struct AudioAnalysisSnapshot {
    double output_time_ms = 0.0;
    double analysis_time_ms = 0.0;
    double analysis_latency_ms = 0.0;
    float rms = 0.0f;
    float low_energy = 0.0f;
    float onset_strength = 0.0f;
    uint64_t dropped_frames = 0;
    // Monotonically increasing event counter; not a sticky beat flag.
    uint64_t beat_sequence = 0;
    float bpm = 0.0f;
    float momentary_lufs = -70.0f;
    float short_term_lufs = -70.0f;
    float integrated_lufs = -70.0f;
    std::array<float, 64> spectrum{};
};

class AudioEngine {
public:
    static constexpr const char* kVersion = "1.0.0";
    AudioEngine();
    ~AudioEngine();
    const char* version() const { return kVersion; }

    // ── Lifecycle ──
    bool open(const std::string& file_path);
    bool play();
    bool pause();
    bool stop();

    // ── Seek ──
    bool seek(double position_ms);

    // ── Control ──
    void set_volume(float volume); // 0.0 - 1.0
    float volume() const { return dsp_pipeline_.master_volume(); }
    void set_preamp_db(float db, bool enabled) {
        dsp_pipeline_.set_preamp_db(db, enabled);
    }
    void set_replay_gain_mode(int mode, bool prevent_clipping);
    int replay_gain_mode() const { return replay_gain_mode_; }
    bool replay_gain_prevent_clipping() const { return replay_gain_prevent_clipping_; }
    ReplayGainConfig replay_gain_config() const { return dsp_pipeline_.replay_gain_config(); }
    bool set_playback_speed_config(const PlaybackSpeedConfig& config) { return dsp_pipeline_.set_playback_speed_config(config); }
    PlaybackSpeedConfig playback_speed_config() const { return dsp_pipeline_.playback_speed_config(); }
    bool set_eq_bands(const std::array<EqBand, kEqBandCount>& bands);
    std::array<EqBand, kEqBandCount> eq_bands() const { return dsp_pipeline_.eq_bands(); }
    bool set_resampler_config(bool force_output_rate, int target_sample_rate, int quality);
    bool force_output_rate() const { return force_output_rate_; }
    int target_sample_rate() const { return target_sample_rate_; }
    int resampler_quality() const { return resampler_quality_; }
    void set_dop_enabled(bool enabled) { dop_enabled_ = enabled; }
    bool dop_enabled() const { return dop_enabled_; }
    bool set_dsp_nodes(const std::vector<DspNodeConfig>& nodes) { return dsp_pipeline_.set_dsp_nodes(nodes); }
    std::vector<DspNodeConfig> dsp_nodes() const { return dsp_pipeline_.dsp_nodes(); }
    bool set_compressor_config(const CompressorConfig& config) { return dsp_pipeline_.set_compressor_config(config); }
    CompressorConfig compressor_config() const { return dsp_pipeline_.compressor_config(); }
    bool set_delay_config(const DelayConfig& config) { return dsp_pipeline_.set_delay_config(config); }
    DelayConfig delay_config() const { return dsp_pipeline_.delay_config(); }
    bool set_reverb_config(const ReverbConfig& config) { return dsp_pipeline_.set_reverb_config(config); }
    ReverbConfig reverb_config() const { return dsp_pipeline_.reverb_config(); }
    bool set_chorus_config(const ChorusConfig& config) { return dsp_pipeline_.set_chorus_config(config); }
    ChorusConfig chorus_config() const { return dsp_pipeline_.chorus_config(); }
    bool set_noise_gate_config(const NoiseGateConfig& config) { return dsp_pipeline_.set_noise_gate_config(config); }
    NoiseGateConfig noise_gate_config() const { return dsp_pipeline_.noise_gate_config(); }
    bool set_phaser_config(const PhaserConfig& config) { return dsp_pipeline_.set_phaser_config(config); }
    PhaserConfig phaser_config() const { return dsp_pipeline_.phaser_config(); }
    bool set_channel_matrix_config(const ChannelMatrixConfig& config) { return dsp_pipeline_.set_channel_matrix_config(config); }
    ChannelMatrixConfig channel_matrix_config() const { return dsp_pipeline_.channel_matrix_config(); }
    void set_limiter_enabled(bool enabled) { dsp_pipeline_.set_limiter_enabled(enabled); }
    bool limiter_enabled() const { return dsp_pipeline_.limiter_enabled(); }
    bool set_limiter_config(const LimiterConfig& config) { return dsp_pipeline_.set_limiter_config(config); }
    LimiterConfig limiter_config() const { return dsp_pipeline_.limiter_config(); }
    bool set_transition_config(const TransitionConfig& config);
    TransitionConfig transition_config() const {
        return {gapless_enabled_.load(std::memory_order_acquire),
                crossfade_enabled_.load(std::memory_order_acquire),
                crossfade_ms_.load(std::memory_order_acquire)};
    }

    // ── Device / Backend ──
    std::vector<DeviceInfo> enumerate_devices();
    bool set_device(const std::wstring& device_id);
    bool set_backend(BackendType type);
    bool select_output_device(BackendType type, const std::wstring& device_id);

    // ── Query ──
    EngineState state() const { return state_; }
    double position_ms() const;
    double duration_ms() const { return track_info_.duration_ms; }
    const TrackInfo& track_info() const { return track_info_; }
    bool is_playing() const { return state_ == EngineState::Playing; }
    int glitch_count() const { return glitch_count_.load(); }
    AudioChainStatus audio_chain_status() const;
    AudioAnalysisSnapshot audio_analysis_snapshot() const;

    // ── Callbacks (called from native) ──
    using StateChangedCallback = std::function<void(EngineState)>;
    using PositionCallback = std::function<void(double ms, double duration_ms)>;
    using ErrorCallback = std::function<void(int code, const std::string& msg)>;
    using LogCallback = std::function<void(int level, const std::string& msg)>;
    using TrackEndedCallback = std::function<void(const std::string& reason)>;

    void set_state_callback(StateChangedCallback cb) { state_cb_ = std::move(cb); }
    void set_position_callback(PositionCallback cb) { pos_cb_ = std::move(cb); }
    void set_error_callback(ErrorCallback cb) { error_cb_ = std::move(cb); }
    void set_track_ended_callback(TrackEndedCallback cb) { track_ended_cb_ = std::move(cb); }

private:
    void set_state(EngineState new_state);
    void decoder_thread_func();
    void position_timer_func();
    int audio_callback(float* output, int frames, int channels);
    int dop_audio_callback(uint8_t* output, int frames, int channels);
    void update_replay_gain_for_track();
    void analysis_thread_func();
    void stop_analysis_thread();
    bool prepare_next_decoder_locked();
    bool switch_to_next_decoder_locked();

    // ── State ──
    std::atomic<EngineState> state_{EngineState::Idle};

    // ── Backend ──
    std::unique_ptr<AudioBackend> backend_;
    BackendType current_backend_type_{BackendType::DIRECTSOUND};
    std::wstring current_device_id_{L"default"};
    bool force_output_rate_ = false;
    int target_sample_rate_ = 48000;
    int resampler_quality_ = 0; // 0 Best, 1 Medium, 2 Fast
    // DoP must be explicitly enabled because a PCM device cannot report
    // whether the downstream DAC will interpret its PCM24 carrier as DoP.
    bool dop_enabled_ = false;
    int replay_gain_mode_ = 0; // 0 Off, 1 Track, 2 Album
    bool replay_gain_prevent_clipping_ = true;

    // ── Decoder ──
    Decoder decoder_;
    Decoder next_decoder_;
    TrackInfo track_info_;
    std::string next_track_path_;
    std::atomic<bool> gapless_enabled_{true};
    std::atomic<bool> crossfade_enabled_{false};
    std::atomic<int> crossfade_ms_{5000};
    std::atomic<bool> transition_active_{false};
    std::vector<float> transition_work_buffer_;
    std::unique_ptr<RingBuffer> ring_buffer_;
    // Encoded transport path. Never share this queue with PCM/DSP buffers.
    std::unique_ptr<ByteRingBuffer> dop_ring_buffer_;
    std::vector<uint8_t> dop_work_buffer_;
    std::atomic<bool> dop_transport_active_{false};
    std::atomic<int64_t> dop_carrier_frames_{0};
    // Accessed only by the real-time DoP callback after control-thread reset.
    uint8_t dop_output_marker_ = 0x05;
    // Final PCM analysis tap: audio callback is sole producer and never waits.
    std::unique_ptr<RingBuffer> analysis_ring_buffer_;
    std::atomic<uint64_t> analysis_dropped_frames_{0};
    std::vector<float> analysis_work_buffer_;
    std::unique_ptr<std::thread> analysis_thread_;
    std::atomic<bool> analysis_running_{false};
    std::atomic<uint64_t> analysis_output_frames_{0};
    std::atomic<uint64_t> analysis_processed_frames_{0};
    std::atomic<float> analysis_rms_{0.0f};
    std::atomic<float> analysis_low_energy_{0.0f};
    std::atomic<float> analysis_onset_strength_{0.0f};
    std::atomic<uint64_t> analysis_beat_sequence_{0};
    std::atomic<float> analysis_bpm_{0.0f};
    std::atomic<float> analysis_momentary_lufs_{-70.0f};
    std::atomic<float> analysis_short_term_lufs_{-70.0f};
    std::atomic<float> analysis_integrated_lufs_{-70.0f};
    std::atomic<uint64_t> analysis_reset_generation_{0};
    std::array<std::atomic<float>, 64> analysis_spectrum_{};
    // Preallocated source-format buffer. The audio callback never allocates;
    // it reads here before channel conversion/DSP writes backend-format PCM.
    std::vector<float> source_work_buffer_;
    // Number of valid source frames currently retained for stateful SRC.
    // Accessed exclusively by audio_callback after its control-thread setup.
    int source_work_frames_ = 0;
    // seek() is the only third-party writer of RingBuffer cursors.  Quiesce
    // the PCM callback first so reset() remains SPSC in practice.
    std::atomic<bool> pcm_io_resetting_{false};
    std::atomic<int> pcm_callbacks_in_flight_{0};
    std::unique_ptr<std::thread> decoder_thread_;
    std::atomic<bool> decoder_running_{false};
    std::atomic<int> seek_generation_{0};  // incremented on each seek to invalidate stale decoder output
    std::mutex decoder_mutex_;             // protects decoder from concurrent seek/decode

    // ── Position timer ──
    std::unique_ptr<std::thread> position_timer_;
    std::atomic<bool> timer_running_{false};
    uint64_t last_logged_eq_generation_ = 0;

    // ── Control params (atomic for lock-free audio thread access) ──
    std::atomic<int> glitch_count_{0};
    DspPipeline dsp_pipeline_;
    // Source frames actually removed from Ring Buffer #1 and handed to the
    // output backend.  Decoder position includes pre-read data and must not
    // be exposed as the playback position.
    std::atomic<int64_t> played_frames_{0};

    // ── Callbacks ──
    StateChangedCallback state_cb_;
    PositionCallback pos_cb_;
    ErrorCallback error_cb_;
    TrackEndedCallback track_ended_cb_;

    // The audio callback only sets these atomics.  State changes and logging
    // are dispatched by the position timer, never from the real-time thread.
    std::atomic<bool> track_ended_fired_{false};
    std::atomic<bool> track_end_pending_{false};
};
