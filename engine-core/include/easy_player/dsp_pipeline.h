#pragma once

#include "audio_backend.h"
#include "crossfeed_processor.h"
#include "partitioned_convolver.h"
#include "ring_buffer.h"
#include <samplerate.h>
#include <soundtouch/SoundTouch.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <memory>
#include <string>
#include <vector>

// Snapshot created on a control thread. It is never constructed or modified by
// the audio callback, so the vectors are safe to expose through N-API.
struct AudioChainStatus {
    AudioFormat source_format{};
    AudioFormat backend_format{};
    AudioFormat original_format{};
    AudioFormat decoded_pcm_format{};
    std::string source_codec;
    std::string source_label;
    std::string output_transport;
    std::string dop_fallback_reason;
    int dop_carrier_rate = 0;
    std::wstring output_device_id;
    int output_buffer_frames = 0;
    double output_latency_ms = 0.0;
    std::vector<std::string> active_nodes;
    std::vector<std::string> bypassed_nodes;
    std::vector<std::string> bit_perfect_blockers;
    float eq_peak_db = 0.0f;
    float eq_auto_preamp_db = 0.0f;
    // Eligible means software routing and negotiated format meet the strict
    // prerequisites. It is deliberately not a hardware-verification claim.
    bool is_bit_perfect_eligible = false;
    std::string bit_perfect_verification_state = "blocked"; // blocked | eligible_unverified | verified
    bool is_bit_perfect = false;
};

constexpr int kEqBandCount = 20;
constexpr int kMaxAudioChannels = 8;
constexpr size_t kOrderedDspNodeCount = 14;

struct EqBand {
    bool enabled = false;
    float frequency_hz = 1000.0f;
    float gain_db = 0.0f;
    float q = 1.0f;
};

struct DspNodeConfig {
    std::string id;
    bool enabled = false;
};

struct CompressorConfig {
    float threshold_db = -18.0f;
    float ratio = 4.0f;
    float attack_ms = 10.0f;
    float release_ms = 100.0f;
    float makeup_db = 0.0f;
};
struct DelayConfig { float delay_ms = 250.0f; float feedback = 0.25f; float mix = 0.20f; };
struct ReverbConfig { float room_size = 0.5f; float decay = 0.4f; float mix = 0.15f; };
struct LimiterConfig { float ceiling_db = -1.0f; float release_ms = 80.0f; };
struct ChorusConfig { float rate_hz = 0.8f; float depth_ms = 8.0f; float mix = 0.35f; };
struct NoiseGateConfig { float threshold_db = -50.0f; float attack_ms = 5.0f; float hold_ms = 50.0f; float release_ms = 150.0f; float range_db = -80.0f; };
struct PhaserConfig { float rate_hz = 0.4f; float depth = 0.6f; float center_hz = 800.0f; float feedback = 0.2f; float mix = 0.5f; };
struct ChannelMatrixConfig { bool enabled = false; float balance = 0.0f; bool swap_stereo = false; bool mono_downmix = false; std::array<float, kMaxAudioChannels> output_gains{{1,1,1,1,1,1,1,1}}; };
struct StereoFieldConfig { bool enabled = false; float mid_db = 0.0f; float side_db = 0.0f; float width = 1.0f; };
struct ReplayGainConfig { bool enabled = false; float gain_db = 0.0f; float peak = 0.0f; bool prevent_clipping = true; };
struct PlaybackSpeedConfig { bool enabled = false; float speed = 1.0f; };

// Owns PCM format conversion and DSP state for the output callback.
// Configure and reset while rendering is stopped. Runtime setters publish
// settings for the audio thread, which owns the live processing state.
class DspPipeline {
public:
    void set_playback_only(bool enabled) { playback_only_.store(enabled, std::memory_order_release); }
    enum class ResamplerQuality { Best, Medium, Fast };
    struct ProcessResult {
        int input_frames_used = 0;
        int output_frames_generated = 0;
        bool stream_drained = false;
    };
    DspPipeline();

    void set_preamp_db(float db, bool enabled);
    bool set_replay_gain_config(const ReplayGainConfig& input);
    ReplayGainConfig replay_gain_config() const { return *replay_gain_config_.load(std::memory_order_acquire); }
    bool set_playback_speed_config(const PlaybackSpeedConfig& input);
    PlaybackSpeedConfig playback_speed_config() const { return *playback_speed_config_.load(std::memory_order_acquire); }

    void set_master_volume(float volume);

    float master_volume() const {
        return master_volume_target_.load(std::memory_order_acquire);
    }

    void set_resampler_quality(ResamplerQuality quality) { resampler_quality_ = quality; }

    void configure(const AudioFormat& source_format,
                   const AudioFormat& backend_format,
                   BackendType backend_type,
                   int max_output_frames);

    void reset(const AudioFormat& source_format = {});

    bool set_eq_bands(const std::array<EqBand, kEqBandCount>& bands);

    std::array<EqBand, kEqBandCount> eq_bands() const { return eq_bands_; }
    bool set_dsp_nodes(const std::vector<DspNodeConfig>& nodes);
    std::vector<DspNodeConfig> dsp_nodes() const;
    bool set_compressor_config(const CompressorConfig& config);
    CompressorConfig compressor_config() const {
        return compressor_config_.load(std::memory_order_acquire)->values;
    }
    bool set_delay_config(const DelayConfig& config);
    DelayConfig delay_config() const { return *delay_config_.load(std::memory_order_acquire); }
    bool set_reverb_config(const ReverbConfig& config);
    ReverbConfig reverb_config() const { return *reverb_config_.load(std::memory_order_acquire); }
    void set_limiter_enabled(bool enabled) { limiter_enabled_.store(enabled, std::memory_order_release); }
    bool limiter_enabled() const { return limiter_enabled_.load(std::memory_order_acquire); }
    bool set_limiter_config(const LimiterConfig& input);
    LimiterConfig limiter_config() const { return *limiter_config_.load(std::memory_order_acquire); }
    bool set_chorus_config(const ChorusConfig& input);
    ChorusConfig chorus_config() const { return *chorus_config_.load(std::memory_order_acquire); }
    bool set_noise_gate_config(const NoiseGateConfig& input);
    NoiseGateConfig noise_gate_config() const { return noise_gate_config_.load(std::memory_order_acquire)->values; }
    bool set_phaser_config(const PhaserConfig& input);
    PhaserConfig phaser_config() const { return *phaser_config_.load(std::memory_order_acquire); }
    bool set_channel_matrix_config(const ChannelMatrixConfig& input);
    ChannelMatrixConfig channel_matrix_config() const { return *channel_matrix_config_.load(std::memory_order_acquire); }
    bool set_stereo_field_config(const StereoFieldConfig& input);
    StereoFieldConfig stereo_field_config() const { return *stereo_field_config_.load(std::memory_order_acquire); }
    bool set_crossfeed_config(const CrossfeedConfig& input);
    CrossfeedConfig crossfeed_config() const { return *crossfeed_config_.load(std::memory_order_acquire); }

    bool set_impulse_response(const std::vector<float>& samples, int sample_rate, int channels, bool enabled);
    bool set_ir_gain(bool automatic, float gain_db);
    float ir_auto_preamp_db() const {
        return ir_auto_preamp_db_.load(std::memory_order_acquire);
    }
    bool impulse_response_enabled() const { return ir_enabled_.load(std::memory_order_acquire); }
    int active_eq_band_count() const {
        return eq_config_.load(std::memory_order_acquire)->active_band_count;
    }
    uint64_t processed_eq_generation() const {
        return eq_processed_generation_.load(std::memory_order_acquire);
    }

    int required_input_frames(int output_frames) const noexcept;

    // The source FIFO is owned by AudioEngine. This node only consumes the
    // frames libsamplerate reports, preserving SRC_STATE across callbacks.
    ProcessResult process(const float* input, int input_frames, int input_channels,
                          bool end_of_input, float* output, int frames, int output_channels,
                          RingBuffer* pre_volume_monitor = nullptr) noexcept;

    uint64_t clip_guard_limited_frames() const noexcept {
        return clip_guard_limited_frames_.load(std::memory_order_acquire);
    }
    float clip_guard_reduction_db() const noexcept {
        return clip_guard_reduction_db_.load(std::memory_order_acquire);
    }

    AudioChainStatus status() const;

private:
    struct OrderedNodes {
        std::array<uint8_t, kOrderedDspNodeCount> ids{};
    };
    inline static const std::array<std::string, kOrderedDspNodeCount> allowed = {
        "channel_matrix", "replay_gain", "preamp", "eq", "compressor", "delay", "reverb",
        "chorus", "noise_gate", "phaser", "stereo_field", "crossfeed", "impulse_response", "limiter"
    };
    struct CompressorRuntimeConfig {
        CompressorConfig values{};
        float attack_coefficient = 0.0f;
        float release_coefficient = 0.0f;
    };
    struct NoiseGateRuntimeConfig {
        NoiseGateConfig values{};
        float attack_coefficient = 0.0f;
        float release_coefficient = 0.0f;
        int hold_frames = 0;
        float minimum_gain = 0.0f;
    };
    struct SrcDeleter {
        void operator()(SRC_STATE* state) const { if (state) src_delete(state); }
    };

    void configure_resampler(int max_output_frames);
    void configure_time_stretch(int max_output_frames);
    void reset_time_stretch() noexcept;


    // Impulse response preparation and runtime lifetime.
    bool publish_ir_runtime();
    void reclaim_ir_runtimes();


    // Effects and their control-thread configuration.
    void process_stereo_field(float* samples, int frames, int channels) noexcept;
    void configure_delay(int);
    void configure_chorus();

    void publish_compressor_config(const CompressorConfig& values);
    void publish_noise_gate_config(const NoiseGateConfig& values);

    struct BiquadCoefficients {
        float b0 = 1.0f;
        float b1 = 0.0f;
        float b2 = 0.0f;
        float a1 = 0.0f;
        float a2 = 0.0f;
    };

    struct BiquadState {
        float z1 = 0.0f;
        float z2 = 0.0f;
    };

    struct EqConfig {
        std::array<BiquadCoefficients, kEqBandCount> coefficients{};
        bool has_active_bands = false;
        int active_band_count = 0;
        float peak_db = 0.0f;
        float headroom_gain = 1.0f;
        uint64_t generation = 0;
    };

    static std::array<EqBand, kEqBandCount> default_eq_bands();

    static float eq_peak_db(const EqConfig& config, int sample_rate);

    static BiquadCoefficients make_peaking_filter(const EqBand& band, int sample_rate);

    void publish_eq_config();

    void process_eq(float* samples, int frames, int channels, const EqConfig* config) noexcept;

    void process_ordered_nodes(float* samples, int frames, int channels) noexcept;

    void process_compressor(float* samples, int frames, int channels) noexcept;

    void process_delay(float* samples, int frames, int channels) noexcept;
    void process_reverb(float* samples, int frames, int channels) noexcept;
    void process_limiter(float* samples, int frames, int channels) noexcept;
    void process_chorus(float* samples, int frames, int channels) noexcept;
    void process_noise_gate(float* samples, int frames, int channels) noexcept;
    void process_phaser(float* samples, int frames, int channels) noexcept;

    static void apply_smoothed_gain(float* samples, int count, float target, float& live) noexcept;

    static void apply_channel_matrix(const float* input, int input_channels,
                                     float* output, int output_channels,
                                     int frames) noexcept;
    void apply_channel_controls(float* samples, int frames, int channels) noexcept;

    AudioFormat source_format_{};
    AudioFormat backend_format_{};
    BackendType backend_type_ = BackendType::DIRECTSOUND;
    bool configured_ = false;
    std::atomic<bool> preamp_enabled_{false};
    std::atomic<float> preamp_target_{1.0f};
    std::atomic<bool> playback_only_{false};
    std::atomic<float> master_volume_target_{1.0f};
    // Audio-thread-owned state. Never access from a control thread.
    float preamp_live_ = 1.0f;
    float eq_headroom_live_ = 1.0f;
    float master_volume_live_ = 1.0f;
    std::atomic<uint64_t> clip_guard_limited_frames_{0};
    std::atomic<float> clip_guard_reduction_db_{0.0f};
    float replay_gain_live_ = 1.0f;
    std::array<EqBand, kEqBandCount> eq_bands_{};
    EqConfig eq_default_config_{};
    std::atomic<const EqConfig*> eq_config_{nullptr};
    const EqConfig* eq_live_config_ = nullptr;
    std::array<std::array<BiquadState, kMaxAudioChannels>, kEqBandCount> eq_states_{};
    std::atomic<uint64_t> eq_published_generation_{0};
    std::atomic<uint64_t> eq_processed_generation_{0};
    // Configs are immutable and retained until the engine is destroyed, so the
    // audio thread never observes a freed config or needs a lock.
    std::vector<std::unique_ptr<EqConfig>> eq_retired_configs_;
    std::unique_ptr<SRC_STATE, SrcDeleter> resampler_;
    std::vector<float> resample_buffer_;
    ResamplerQuality resampler_quality_ = ResamplerQuality::Best;
    std::vector<DspNodeConfig> dsp_nodes_ = {
        {"channel_matrix", false}, {"replay_gain", false}, {"preamp", false}, {"eq", false},
        {"compressor", false}, {"delay", false}, {"reverb", false}, {"chorus", false},
        {"noise_gate", false}, {"phaser", false}, {"stereo_field", false}, {"crossfeed", false},
        {"impulse_response", false}, {"limiter", false}
    };
    OrderedNodes default_order_{{0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13}};
    std::atomic<const OrderedNodes*> ordered_nodes_{nullptr};
    // Snapshots stay alive while an audio callback might be reading one.
    std::vector<std::unique_ptr<OrderedNodes>> retired_orders_;
    std::atomic<bool> compressor_enabled_{false};
    std::atomic<bool> delay_enabled_{false};
    std::atomic<bool> reverb_enabled_{false};
    std::atomic<bool> chorus_enabled_{false};
    std::atomic<bool> noise_gate_enabled_{false};
    std::atomic<bool> phaser_enabled_{false};
    CompressorRuntimeConfig compressor_default_config_{};
    std::atomic<const CompressorRuntimeConfig*> compressor_config_{nullptr};
    const CompressorRuntimeConfig* compressor_live_config_ = nullptr;
    std::array<float, kMaxAudioChannels> compressor_gain_db_{};
    std::vector<std::unique_ptr<CompressorRuntimeConfig>> compressor_retired_configs_;
    DelayConfig delay_default_config_{};
    std::atomic<const DelayConfig*> delay_config_{nullptr};
    std::vector<std::unique_ptr<DelayConfig>> delay_retired_configs_;
    std::vector<float> delay_buffer_;
    int delay_capacity_frames_ = 0, delay_channels_ = 0, delay_write_frame_ = 0;
    std::vector<float> reverb_buffer_;
    int reverb_write_frame_ = 0;
    ReverbConfig reverb_default_config_{};
    std::atomic<const ReverbConfig*> reverb_config_{nullptr};
    std::vector<std::unique_ptr<ReverbConfig>> reverb_retired_configs_;
    std::atomic<bool> limiter_enabled_{false}; float limiter_gain_ = 1.0f;
    LimiterConfig limiter_default_config_{}; std::atomic<const LimiterConfig*> limiter_config_{nullptr};
    std::vector<std::unique_ptr<LimiterConfig>> limiter_retired_configs_;
    ChorusConfig chorus_default_config_{}; std::atomic<const ChorusConfig*> chorus_config_{nullptr};
    std::vector<std::unique_ptr<ChorusConfig>> chorus_retired_configs_;
    std::vector<float> chorus_buffer_;
    int chorus_capacity_frames_ = 0, chorus_channels_ = 0, chorus_write_frame_ = 0;
    float chorus_phase_ = 0.0f;
    NoiseGateRuntimeConfig noise_gate_default_config_{};
    std::atomic<const NoiseGateRuntimeConfig*> noise_gate_config_{nullptr};
    std::vector<std::unique_ptr<NoiseGateRuntimeConfig>> noise_gate_retired_configs_;
    float noise_gate_gain_ = 1.0f;
    int noise_gate_hold_frames_ = 0;
    PhaserConfig phaser_default_config_{}; std::atomic<const PhaserConfig*> phaser_config_{nullptr};
    std::vector<std::unique_ptr<PhaserConfig>> phaser_retired_configs_;
    std::array<std::array<float, kMaxAudioChannels>, 4> phaser_states_{};
    std::array<float, kMaxAudioChannels> phaser_feedback_{};
    float phaser_phase_ = 0.0f;
    ChannelMatrixConfig channel_matrix_default_config_{};
    std::atomic<const ChannelMatrixConfig*> channel_matrix_config_{nullptr};
    std::vector<std::unique_ptr<ChannelMatrixConfig>> channel_matrix_retired_configs_;
    StereoFieldConfig stereo_field_default_config_{};
    std::atomic<const StereoFieldConfig*> stereo_field_config_{nullptr};
    std::vector<std::unique_ptr<StereoFieldConfig>> stereo_field_retired_configs_;
    CrossfeedConfig crossfeed_default_config_{};
    std::atomic<const CrossfeedConfig*> crossfeed_config_{nullptr};
    std::vector<std::unique_ptr<CrossfeedConfig>> crossfeed_retired_configs_;
    CrossfeedProcessor crossfeed_processor_;
    std::vector<float> ir_source_;
    int ir_source_rate_ = 0;
    int ir_source_channels_ = 0;
    std::atomic<bool> ir_enabled_{false};
    std::atomic<PartitionedConvolver*> ir_runtime_{nullptr};
    std::atomic<int> ir_readers_{0};
    std::atomic<float> ir_auto_preamp_db_{0.0f};
    std::vector<std::unique_ptr<PartitionedConvolver>> ir_retired_runtimes_;
    std::atomic<bool> ir_auto_gain_{true};
    std::atomic<float> ir_manual_gain_{1.0f};
    float ir_gain_live_ = 1.0f;
    ReplayGainConfig replay_gain_default_config_{};
    std::atomic<const ReplayGainConfig*> replay_gain_config_{nullptr};
    std::vector<std::unique_ptr<ReplayGainConfig>> replay_gain_retired_configs_;
    PlaybackSpeedConfig playback_speed_default_config_{};
    std::atomic<const PlaybackSpeedConfig*> playback_speed_config_{nullptr};
    std::vector<std::unique_ptr<PlaybackSpeedConfig>> playback_speed_retired_configs_;
    soundtouch::SoundTouch time_stretch_;
    bool time_stretch_finishing_ = false;
    bool time_stretch_flushed_ = false;
    double time_stretch_expected_frames_ = 0;
    int64_t time_stretch_delivered_frames_ = 0;
    int time_stretch_tail_blocks_ = 0;
    std::array<float, 128 * kMaxAudioChannels> time_stretch_tail_silence_{};
    std::vector<float> time_stretch_buffer_;
    int time_stretch_capacity_frames_ = 0;
};
