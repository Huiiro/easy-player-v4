#pragma once

#include "audio_backend.h"
#include "crossfeed_processor.h"
#include "output_clip_guard.h"
#include "partitioned_convolver.h"
#include <samplerate.h>
#include <soundtouch/SoundTouch.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <memory>
#include <string>
#include <vector>

// Snapshot created on a control thread. It is never constructed or modified by
// the audio callback, so the vectors are safe to expose through N-API.
struct AudioChainStatus {
    AudioFormat source_format{};
    AudioFormat backend_format{};
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

// Phase 3.0 pipeline. The current implementation is deliberately a no-op
// `memcpy` bypass: all future DSP nodes must be inserted here, never directly
// in AudioEngine's real-time callback.
class DspPipeline {
public:
    enum class ResamplerQuality { Best, Medium, Fast };
    struct ProcessResult {
        int input_frames_used = 0;
        int output_frames_generated = 0;
        bool stream_drained = false;
    };
    DspPipeline() {
        ordered_nodes_.store(&default_order_, std::memory_order_relaxed);
        eq_bands_ = default_eq_bands();
        eq_config_.store(&eq_default_config_, std::memory_order_relaxed);
        compressor_config_.store(&compressor_default_config_, std::memory_order_relaxed);
        delay_config_.store(&delay_default_config_, std::memory_order_relaxed);
        reverb_config_.store(&reverb_default_config_, std::memory_order_relaxed);
        limiter_config_.store(&limiter_default_config_, std::memory_order_relaxed);
        chorus_config_.store(&chorus_default_config_, std::memory_order_relaxed);
        noise_gate_config_.store(&noise_gate_default_config_, std::memory_order_relaxed);
        phaser_config_.store(&phaser_default_config_, std::memory_order_relaxed);
        channel_matrix_config_.store(&channel_matrix_default_config_, std::memory_order_relaxed);
        stereo_field_config_.store(&stereo_field_default_config_, std::memory_order_relaxed);
        crossfeed_config_.store(&crossfeed_default_config_, std::memory_order_relaxed);
        replay_gain_config_.store(&replay_gain_default_config_, std::memory_order_relaxed);
        playback_speed_config_.store(&playback_speed_default_config_, std::memory_order_relaxed);
    }

    void set_preamp_db(float db, bool enabled) {
        const float clamped_db = std::max(-24.0f, std::min(24.0f, db));
        preamp_target_.store(std::pow(10.0f, clamped_db / 20.0f),
                             std::memory_order_release);
        preamp_enabled_.store(enabled, std::memory_order_release);
    }
    bool set_replay_gain_config(const ReplayGainConfig& input) {
        ReplayGainConfig value{input.enabled, std::max(-60.0f, std::min(24.0f, input.gain_db)), std::max(0.0f, std::min(100.0f, input.peak)), input.prevent_clipping};
        if (value.prevent_clipping && value.peak > 0.0f) value.gain_db = std::min(value.gain_db, -20.0f * std::log10(value.peak));
        auto owned = std::make_unique<ReplayGainConfig>(value); const auto* raw = owned.get();
        replay_gain_retired_configs_.push_back(std::move(owned)); replay_gain_config_.store(raw, std::memory_order_release); return true;
    }
    ReplayGainConfig replay_gain_config() const { return *replay_gain_config_.load(std::memory_order_acquire); }
    bool set_playback_speed_config(const PlaybackSpeedConfig& input) {
        PlaybackSpeedConfig value{input.enabled, std::max(0.5f, std::min(2.0f, input.speed))};
        auto owned = std::make_unique<PlaybackSpeedConfig>(value); const auto* raw = owned.get();
        playback_speed_retired_configs_.push_back(std::move(owned)); playback_speed_config_.store(raw, std::memory_order_release); return true;
    }
    PlaybackSpeedConfig playback_speed_config() const { return *playback_speed_config_.load(std::memory_order_acquire); }

    void set_master_volume(float volume) {
        master_volume_target_.store(std::max(0.0f, std::min(1.0f, volume)),
                                    std::memory_order_release);
    }

    float master_volume() const {
        return master_volume_target_.load(std::memory_order_acquire);
    }

    void set_resampler_quality(ResamplerQuality quality) { resampler_quality_ = quality; }

    void configure(const AudioFormat& source_format,
                   const AudioFormat& backend_format,
                   BackendType backend_type,
                   int max_output_frames) {
        source_format_ = source_format;
        backend_format_ = backend_format;
        backend_type_ = backend_type;
        configured_ = backend_format.sample_rate > 0;
        configure_resampler(max_output_frames);
        publish_eq_config();
        publish_ir_runtime();
        publish_compressor_config(compressor_config_.load(std::memory_order_acquire)->values);
        publish_noise_gate_config(noise_gate_config_.load(std::memory_order_acquire)->values);
        configure_delay(max_output_frames);
        configure_chorus();
        configure_time_stretch(max_output_frames);
    }

    void reset(const AudioFormat& source_format = {}) {
        source_format_ = source_format;
        backend_format_ = {};
        configured_ = false;
        resampler_.reset();
        resample_buffer_.clear();
        delay_buffer_.clear(); delay_write_frame_ = 0;
        reverb_buffer_.clear(); reverb_write_frame_ = 0;
        chorus_buffer_.clear(); chorus_write_frame_ = 0; chorus_phase_ = 0.0f;
        noise_gate_gain_ = 1.0f; noise_gate_hold_frames_ = 0;
        phaser_phase_ = 0.0f; phaser_feedback_.fill(0.0f);
        for (auto& stage : phaser_states_) stage.fill(0.0f);
        time_stretch_.clear();
        crossfeed_processor_.reset();
        // Settings are restored before the first track is opened. Keep the
        // audio-thread gain state in sync here so the first callback does not
        // ramp from the default 100% level down to the persisted volume.
        // Runtime setting changes still use apply_smoothed_gain as before.
        const bool preamp_enabled = preamp_enabled_.load(std::memory_order_acquire);
        preamp_live_ = preamp_enabled
            ? preamp_target_.load(std::memory_order_acquire)
            : 1.0f;
        const auto* replay_gain = replay_gain_config_.load(std::memory_order_acquire);
        replay_gain_live_ = replay_gain->enabled
            ? std::pow(10.0f, replay_gain->gain_db / 20.0f)
            : 1.0f;
        master_volume_live_ = master_volume_target_.load(std::memory_order_acquire);
        limiter_gain_ = 1.0f;
        clip_guard_limited_frames_.store(0, std::memory_order_release);
        clip_guard_reduction_db_.store(0.0f, std::memory_order_release);
        publish_eq_config();
        eq_headroom_live_ = eq_config_.load(std::memory_order_acquire)->headroom_gain;
        ir_runtime_.store(nullptr);
        ir_auto_preamp_db_.store(0.0f, std::memory_order_release);
        reclaim_ir_runtimes();
        ir_gain_live_ = 1.0f;
    }

    bool set_eq_bands(const std::array<EqBand, kEqBandCount>& bands) {
        eq_bands_ = bands;
        for (auto& band : eq_bands_) {
            band.frequency_hz = std::max(10.0f, std::min(40000.0f, band.frequency_hz));
            band.gain_db = std::max(-24.0f, std::min(24.0f, band.gain_db));
            band.q = std::max(0.1f, std::min(24.0f, band.q));
        }
        publish_eq_config();
        return true;
    }

    std::array<EqBand, kEqBandCount> eq_bands() const { return eq_bands_; }
    bool set_dsp_nodes(const std::vector<DspNodeConfig>& nodes) {
        if (nodes.size() != kOrderedDspNodeCount) return false;
        std::array<bool, kOrderedDspNodeCount> seen{};
        auto order = std::make_unique<OrderedNodes>();
        for (size_t position = 0; position < nodes.size(); ++position) {
            const auto& node = nodes[position];
            const auto it = std::find(allowed.begin(), allowed.end(), node.id);
            if (it == allowed.end()) return false;
            const size_t index = static_cast<size_t>(std::distance(allowed.begin(), it));
            if (seen[index]) return false;
            seen[index] = true;
            order->ids[position] = static_cast<uint8_t>(index);
        }
        dsp_nodes_ = nodes;
        for (const auto& node : dsp_nodes_) {
            if (node.id == "compressor") {
                compressor_enabled_.store(node.enabled, std::memory_order_release);
            } else if (node.id == "delay") {
                delay_enabled_.store(node.enabled, std::memory_order_release);
            } else if (node.id == "reverb") {
                reverb_enabled_.store(node.enabled, std::memory_order_release);
            } else if (node.id == "chorus") {
                chorus_enabled_.store(node.enabled, std::memory_order_release);
            } else if (node.id == "noise_gate") {
                noise_gate_enabled_.store(node.enabled, std::memory_order_release);
            } else if (node.id == "phaser") {
                phaser_enabled_.store(node.enabled, std::memory_order_release);
            }
        }
        const auto* published = order.get();
        retired_orders_.push_back(std::move(order));
        ordered_nodes_.store(published, std::memory_order_release);
        return true;
    }
    std::vector<DspNodeConfig> dsp_nodes() const {
        auto nodes = dsp_nodes_;
        for (auto& node : nodes) {
            if (node.id == "channel_matrix") node.enabled = channel_matrix_config_.load()->enabled;
            else if (node.id == "replay_gain") node.enabled = replay_gain_config_.load()->enabled;
            else if (node.id == "preamp") node.enabled = preamp_enabled_.load();
            else if (node.id == "eq") node.enabled = eq_config_.load()->has_active_bands;
            else if (node.id == "stereo_field") node.enabled = stereo_field_config_.load()->enabled;
            else if (node.id == "crossfeed") node.enabled = crossfeed_config_.load()->enabled;
            else if (node.id == "impulse_response") node.enabled = ir_enabled_.load();
            else if (node.id == "limiter") node.enabled = limiter_enabled();
        }
        return nodes;
    }
    bool set_compressor_config(const CompressorConfig& config) {
        CompressorConfig clamped = config;
        clamped.threshold_db = std::max(-60.0f, std::min(0.0f, clamped.threshold_db));
        clamped.ratio = std::max(1.0f, std::min(20.0f, clamped.ratio));
        clamped.attack_ms = std::max(0.1f, std::min(500.0f, clamped.attack_ms));
        clamped.release_ms = std::max(5.0f, std::min(2000.0f, clamped.release_ms));
        clamped.makeup_db = std::max(-12.0f, std::min(24.0f, clamped.makeup_db));
        publish_compressor_config(clamped);
        return true;
    }
    CompressorConfig compressor_config() const {
        return compressor_config_.load(std::memory_order_acquire)->values;
    }
    bool set_delay_config(const DelayConfig& config) {
        DelayConfig clamped = config;
        clamped.delay_ms = std::max(1.0f, std::min(2000.0f, clamped.delay_ms));
        clamped.feedback = std::max(0.0f, std::min(0.95f, clamped.feedback));
        clamped.mix = std::max(0.0f, std::min(1.0f, clamped.mix));
        auto owned = std::make_unique<DelayConfig>(clamped);
        const DelayConfig* raw = owned.get(); delay_retired_configs_.push_back(std::move(owned));
        delay_config_.store(raw, std::memory_order_release); return true;
    }
    DelayConfig delay_config() const { return *delay_config_.load(std::memory_order_acquire); }
    bool set_reverb_config(const ReverbConfig& config) {
        ReverbConfig value{std::max(0.0f, std::min(1.0f, config.room_size)),
                           std::max(0.0f, std::min(1.0f, config.decay)),
                           std::max(0.0f, std::min(1.0f, config.mix))};
        auto owned = std::make_unique<ReverbConfig>(value); const auto* raw = owned.get();
        reverb_retired_configs_.push_back(std::move(owned)); reverb_config_.store(raw, std::memory_order_release); return true;
    }
    ReverbConfig reverb_config() const { return *reverb_config_.load(std::memory_order_acquire); }
    void set_limiter_enabled(bool enabled) { limiter_enabled_.store(enabled, std::memory_order_release); }
    bool limiter_enabled() const { return limiter_enabled_.load(std::memory_order_acquire); }
    bool set_limiter_config(const LimiterConfig& input) {
        LimiterConfig value{std::max(-12.0f, std::min(0.0f, input.ceiling_db)), std::max(5.0f, std::min(2000.0f, input.release_ms))};
        auto owned = std::make_unique<LimiterConfig>(value); const auto* raw = owned.get();
        limiter_retired_configs_.push_back(std::move(owned)); limiter_config_.store(raw, std::memory_order_release); return true;
    }
    LimiterConfig limiter_config() const { return *limiter_config_.load(std::memory_order_acquire); }
    bool set_chorus_config(const ChorusConfig& input) {
        ChorusConfig value{std::max(0.05f, std::min(10.0f, input.rate_hz)),
                           std::max(0.1f, std::min(15.0f, input.depth_ms)),
                           std::max(0.0f, std::min(1.0f, input.mix))};
        auto owned = std::make_unique<ChorusConfig>(value); const auto* raw = owned.get();
        chorus_retired_configs_.push_back(std::move(owned)); chorus_config_.store(raw, std::memory_order_release); return true;
    }
    ChorusConfig chorus_config() const { return *chorus_config_.load(std::memory_order_acquire); }
    bool set_noise_gate_config(const NoiseGateConfig& input) {
        NoiseGateConfig value{std::max(-80.0f, std::min(0.0f, input.threshold_db)),
                              std::max(0.1f, std::min(200.0f, input.attack_ms)),
                              std::max(0.0f, std::min(2000.0f, input.hold_ms)),
                              std::max(5.0f, std::min(2000.0f, input.release_ms)),
                              std::max(-100.0f, std::min(0.0f, input.range_db))};
        publish_noise_gate_config(value); return true;
    }
    NoiseGateConfig noise_gate_config() const { return noise_gate_config_.load(std::memory_order_acquire)->values; }
    bool set_phaser_config(const PhaserConfig& input) {
        PhaserConfig value{std::max(0.05f, std::min(10.0f, input.rate_hz)),
                           std::max(0.0f, std::min(1.0f, input.depth)),
                           std::max(100.0f, std::min(5000.0f, input.center_hz)),
                           std::max(-0.95f, std::min(0.95f, input.feedback)),
                           std::max(0.0f, std::min(1.0f, input.mix))};
        auto owned = std::make_unique<PhaserConfig>(value); const auto* raw = owned.get();
        phaser_retired_configs_.push_back(std::move(owned)); phaser_config_.store(raw, std::memory_order_release); return true;
    }
    PhaserConfig phaser_config() const { return *phaser_config_.load(std::memory_order_acquire); }
    bool set_channel_matrix_config(const ChannelMatrixConfig& input) {
        ChannelMatrixConfig value = input;
        value.balance = std::max(-1.0f, std::min(1.0f, value.balance));
        for (auto& gain : value.output_gains) gain = std::max(0.0f, std::min(2.0f, gain));
        auto owned = std::make_unique<ChannelMatrixConfig>(value); const auto* raw = owned.get();
        channel_matrix_retired_configs_.push_back(std::move(owned)); channel_matrix_config_.store(raw, std::memory_order_release); return true;
    }
    ChannelMatrixConfig channel_matrix_config() const { return *channel_matrix_config_.load(std::memory_order_acquire); }
    bool set_stereo_field_config(const StereoFieldConfig& input) {
        if (!std::isfinite(input.mid_db) || !std::isfinite(input.side_db) || !std::isfinite(input.width)) return false;
        StereoFieldConfig value{input.enabled, std::clamp(input.mid_db, -12.0f, 6.0f),
                                std::clamp(input.side_db, -12.0f, 6.0f), std::clamp(input.width, 0.0f, 2.0f)};
        auto owned = std::make_unique<StereoFieldConfig>(value);
        const auto* raw = owned.get();
        stereo_field_retired_configs_.push_back(std::move(owned));
        stereo_field_config_.store(raw, std::memory_order_release);
        return true;
    }
    StereoFieldConfig stereo_field_config() const { return *stereo_field_config_.load(std::memory_order_acquire); }
    bool set_crossfeed_config(const CrossfeedConfig& input) {
        if (!std::isfinite(input.strength) || !std::isfinite(input.cutoff_hz) ||
            !std::isfinite(input.delay_ms)) return false;
        CrossfeedConfig value{input.enabled, std::clamp(input.strength, 0.0f, 1.0f),
                              std::clamp(input.cutoff_hz, 300.0f, 1500.0f),
                              std::clamp(input.delay_ms, 0.0f, 0.6f)};
        auto owned = std::make_unique<CrossfeedConfig>(value);
        const auto* raw = owned.get();
        crossfeed_retired_configs_.push_back(std::move(owned));
        crossfeed_config_.store(raw, std::memory_order_release);
        return true;
    }
    CrossfeedConfig crossfeed_config() const { return *crossfeed_config_.load(std::memory_order_acquire); }

    bool set_impulse_response(const std::vector<float>& samples, int sample_rate, int channels, bool enabled) {
        if (enabled && (samples.empty() || sample_rate <= 0 || channels < 1 || channels > 2 ||
                        samples.size() % static_cast<size_t>(channels) != 0)) return false;
        auto previous_source = std::move(ir_source_);
        const int previous_rate = ir_source_rate_;
        const int previous_channels = ir_source_channels_;
        const bool previous_enabled = ir_enabled_.load(std::memory_order_acquire);
        auto* previous_runtime = ir_runtime_.load();
        const float previous_auto_db = ir_auto_preamp_db_.load(std::memory_order_acquire);
        ir_source_ = samples;
        ir_source_rate_ = sample_rate;
        ir_source_channels_ = channels;
        ir_enabled_.store(enabled, std::memory_order_release);
        if (publish_ir_runtime()) return true;
        ir_source_ = std::move(previous_source);
        ir_source_rate_ = previous_rate;
        ir_source_channels_ = previous_channels;
        ir_runtime_.store(previous_runtime);
        ir_auto_preamp_db_.store(previous_auto_db, std::memory_order_release);
        ir_enabled_.store(previous_enabled, std::memory_order_release);
        return false;
    }
    bool set_ir_gain(bool automatic, float gain_db) {
        if (!std::isfinite(gain_db) || gain_db < -24.0f || gain_db > 12.0f) return false;
        ir_manual_gain_.store(std::pow(10.0f, gain_db / 20.0f), std::memory_order_release);
        ir_auto_gain_.store(automatic, std::memory_order_release);
        return true;
    }
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

    int required_input_frames(int output_frames) const noexcept {
        if (source_format_.sample_rate <= 0 || backend_format_.sample_rate <= 0) return output_frames;
        const auto* speed = playback_speed_config_.load(std::memory_order_acquire);
        const float factor = speed->enabled ? speed->speed : 1.0f;
        return static_cast<int>(std::ceil(static_cast<double>(output_frames) * factor * source_format_.sample_rate /
                                          backend_format_.sample_rate)) + 64;
    }

    // The source FIFO is owned by AudioEngine. This node only consumes the
    // frames libsamplerate reports, preserving SRC_STATE across callbacks.
    ProcessResult process(const float* input, int input_frames, int input_channels,
                          bool end_of_input, float* output, int frames, int output_channels) noexcept {
        ProcessResult result;
        const int samples = frames * output_channels;
        if (samples <= 0 || input_channels <= 0 || output_channels <= 0) return result;

        std::memset(output, 0, static_cast<size_t>(samples) * sizeof(float));
        const auto* speed = playback_speed_config_.load(std::memory_order_acquire);
        const bool stretch_enabled = speed->enabled && std::abs(speed->speed - 1.0f) >= 0.0001f;
        const int requested_frames = stretch_enabled ? std::min(time_stretch_capacity_frames_, static_cast<int>(std::ceil(frames * speed->speed)) + 64) : frames;
        const float* matrix_input = input;
        int matrix_frames = std::min(input_frames, requested_frames);
        if (resampler_) {
            SRC_DATA data{};
            data.data_in = input;
            data.input_frames = input_frames;
            data.data_out = resample_buffer_.data();
            data.output_frames = requested_frames;
            data.end_of_input = end_of_input ? 1 : 0;
            data.src_ratio = static_cast<double>(backend_format_.sample_rate) /
                             static_cast<double>(source_format_.sample_rate);
            const int error = src_process(resampler_.get(), &data);
            if (error != 0) return result;
            result.input_frames_used = static_cast<int>(data.input_frames_used);
            result.output_frames_generated = static_cast<int>(data.output_frames_gen);
            result.stream_drained = end_of_input && input_frames == 0 &&
                                    result.output_frames_generated == 0;
            matrix_input = resample_buffer_.data();
            matrix_frames = result.output_frames_generated;
        } else {
            result.input_frames_used = matrix_frames;
            result.output_frames_generated = matrix_frames;
            result.stream_drained = end_of_input && input_frames == 0;
        }

        if (stretch_enabled) {
            if (matrix_frames > 0) {
                apply_channel_matrix(matrix_input, input_channels, time_stretch_buffer_.data(), output_channels, matrix_frames);
                time_stretch_.setTempo(speed->speed);
                time_stretch_.putSamples(time_stretch_buffer_.data(), static_cast<unsigned int>(matrix_frames));
            }
            result.output_frames_generated = static_cast<int>(time_stretch_.receiveSamples(output, static_cast<unsigned int>(frames)));
        } else if (matrix_frames > 0) {
            apply_channel_matrix(matrix_input, input_channels, output, output_channels, matrix_frames);
        }
        process_ordered_nodes(output, frames, output_channels);
        apply_smoothed_gain(
            output,
            samples,
            master_volume_target_.load(std::memory_order_acquire),
            master_volume_live_);
        const auto clip_stats = OutputClipGuard::process(output, frames, output_channels);
        if (clip_stats.limited_frames > 0) {
            clip_guard_reduction_db_.store(clip_stats.max_reduction_db, std::memory_order_release);
            clip_guard_limited_frames_.fetch_add(clip_stats.limited_frames, std::memory_order_release);
        }
        return result;
    }

    uint64_t clip_guard_limited_frames() const noexcept {
        return clip_guard_limited_frames_.load(std::memory_order_acquire);
    }
    float clip_guard_reduction_db() const noexcept {
        return clip_guard_reduction_db_.load(std::memory_order_acquire);
    }

    AudioChainStatus status() const {
        AudioChainStatus result;
        result.source_format = source_format_;
        result.backend_format = backend_format_;
        const auto add_node = [&result](const char* active_name, const char* bypass_name,
                                        bool active, const char* blocker) {
            if (active) {
                result.active_nodes.emplace_back(active_name);
                result.bit_perfect_blockers.emplace_back(blocker);
            } else {
                result.bypassed_nodes.emplace_back(bypass_name);
            }
        };
        // Match process(): SRC -> routing -> tempo -> ordered DSP -> volume -> clip guard.
        add_node("libsamplerate SRC (stateful)", "Resampler", resampler_ != nullptr,
                 "Sample-rate conversion is active");
        const bool channel_conversion = source_format_.channels > 0 && backend_format_.channels > 0 &&
                                        source_format_.channels != backend_format_.channels;
        add_node("Channel routing", "Channel routing", channel_conversion,
                 "Channel count conversion is active");
        const auto* speed = playback_speed_config_.load(std::memory_order_acquire);
        add_node("SoundTouch tempo", "Playback speed",
                 speed->enabled && std::abs(speed->speed - 1.0f) >= 0.0001f,
                 "Playback speed is not unity");
        const EqConfig* eq = eq_config_.load(std::memory_order_acquire);
        result.eq_peak_db = eq->peak_db;
        result.eq_auto_preamp_db = 20.0f * std::log10(eq->headroom_gain);
        const auto* order = ordered_nodes_.load(std::memory_order_acquire);
        for (const auto id : order->ids) {
            switch (id) {
                case 0: add_node("Channel matrix", "Channel matrix", channel_matrix_config_.load()->enabled, "Channel matrix controls are enabled"); break;
                case 1: { const auto* rg = replay_gain_config_.load(); add_node("ReplayGain", "ReplayGain", rg->enabled && std::abs(rg->gain_db) >= 0.0001f, "ReplayGain is active"); break; }
                case 2: add_node("Preamp", "Preamp", preamp_enabled_.load(), "Preamp is enabled"); break;
                case 3: add_node("Parametric EQ", "EQ", eq->has_active_bands, "Parametric EQ is enabled"); break;
                case 4: add_node("Compressor", "Compressor", compressor_enabled_.load(), "Compressor is enabled"); break;
                case 5: add_node("Delay", "Delay", delay_enabled_.load(), "Delay is enabled"); break;
                case 6: add_node("Reverb", "Reverb", reverb_enabled_.load(), "Reverb is enabled"); break;
                case 7: add_node("Chorus", "Chorus", chorus_enabled_.load(), "Chorus is enabled"); break;
                case 8: add_node("Noise Gate", "Noise Gate", noise_gate_enabled_.load(), "Noise Gate is enabled"); break;
                case 9: add_node("Phaser", "Phaser", phaser_enabled_.load(), "Phaser is enabled"); break;
                case 10: add_node("Stereo field", "Stereo field", backend_format_.channels == 2 && stereo_field_config_.load()->enabled, "Stereo field is enabled"); break;
                case 11: { const auto* cf = crossfeed_config_.load(); add_node("Crossfeed", "Crossfeed", backend_format_.channels == 2 && cf->enabled && cf->strength > 0.0f, "Crossfeed is enabled"); break; }
                case 12: add_node("Impulse response", "Impulse response", backend_format_.channels >= 1 && backend_format_.channels <= 2 && ir_enabled_.load() && ir_runtime_.load() != nullptr, "Impulse response is enabled"); break;
                case 13: add_node("Limiter", "Limiter", limiter_enabled(), "Limiter is enabled"); break;
                default: break;
            }
        }
        add_node("Master volume", "Master volume", master_volume() != 1.0f,
                 "Master volume gain is not unity");
        // This conditional stage is exactly transparent for in-range PCM.
        result.active_nodes.emplace_back("Output clip guard");

        if (!configured_) {
            result.bit_perfect_blockers.push_back("Output backend is not active");
        } else {
            if (backend_type_ != BackendType::WASAPI_EXCLUSIVE &&
                backend_type_ != BackendType::ASIO) {
                result.bit_perfect_blockers.push_back("Backend is not WASAPI Exclusive or ASIO");
            }
            if (source_format_.sample_rate != backend_format_.sample_rate) {
                result.bit_perfect_blockers.push_back("Backend sample rate differs from the source");
            }
            if (source_format_.channels != backend_format_.channels) {
                result.bit_perfect_blockers.push_back("Backend channel count differs from the source");
            }
            // ASIO devices commonly expose a 24/32-bit endpoint for every
            // source. Widening 16→24 or 24→32 keeps every original integer
            // sample exactly representable; only a precision reduction can
            // discard source information. The f32 transport is separately
            // kept in the unverified state below.
            if (source_format_.bit_depth > 0 &&
                (backend_format_.bit_depth <= 0 || backend_format_.bit_depth < source_format_.bit_depth)) {
                result.bit_perfect_blockers.push_back("Backend precision is lower than the source");
            }

        }
        result.is_bit_perfect_eligible = result.bit_perfect_blockers.empty();
        result.bit_perfect_verification_state = result.is_bit_perfect_eligible
            ? "eligible_unverified" : "blocked";

        // The current backends receive f32 PCM and may perform a format
        // conversion before writing to the device. A software precondition
        // match is useful to show, but it must not become a verified claim
        // until a retained DAC/loopback sample comparison exists.
        if (result.is_bit_perfect_eligible) {
            result.bit_perfect_blockers.push_back(
                "Current f32 output path requires retained hardware verification");
        }
        result.is_bit_perfect = result.bit_perfect_verification_state == "verified";
        return result;
    }

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

    void configure_resampler(int max_output_frames) {
        resampler_.reset();
        resample_buffer_.clear();
        if (source_format_.sample_rate <= 0 || backend_format_.sample_rate <= 0 ||
            source_format_.sample_rate == backend_format_.sample_rate ||
            source_format_.channels <= 0 || max_output_frames <= 0) return;

        int error = 0;
        int converter = SRC_SINC_BEST_QUALITY;
        if (resampler_quality_ == ResamplerQuality::Medium) converter = SRC_SINC_MEDIUM_QUALITY;
        if (resampler_quality_ == ResamplerQuality::Fast) converter = SRC_SINC_FASTEST;
        SRC_STATE* state = src_new(converter, source_format_.channels, &error);
        if (!state || error != 0) return;
        resampler_.reset(state);
        resample_buffer_.assign(static_cast<size_t>(max_output_frames * 2 + 128) * source_format_.channels, 0.0f);
    }
    void configure_time_stretch(int max_output_frames) {
        const int rate = backend_format_.sample_rate > 0 ? backend_format_.sample_rate : 48000;
        const int channels = std::max(1, std::min(backend_format_.channels, kMaxAudioChannels));
        time_stretch_.clear(); time_stretch_.setSampleRate(static_cast<unsigned int>(rate)); time_stretch_.setChannels(static_cast<unsigned int>(channels)); time_stretch_.setTempo(1.0);
        time_stretch_capacity_frames_ = std::max(1, max_output_frames * 2 + 128);
        time_stretch_buffer_.assign(static_cast<size_t>(time_stretch_capacity_frames_) * channels, 0.0f);
        time_stretch_.putSamples(time_stretch_buffer_.data(), static_cast<unsigned int>(time_stretch_capacity_frames_));
        time_stretch_.clear();
    }

    bool publish_ir_runtime() {
        if (!ir_enabled_.load(std::memory_order_acquire) || ir_source_.empty()) {
            ir_runtime_.store(nullptr);
            ir_auto_preamp_db_.store(0.0f, std::memory_order_release);
            reclaim_ir_runtimes();
            return true;
        }
        const int target_rate = backend_format_.sample_rate > 0 ? backend_format_.sample_rate : ir_source_rate_;
        std::vector<float> samples = ir_source_;
        constexpr int kMaxOutputIrFrames = 262144;
        const auto fail = [this]() {
            ir_runtime_.store(nullptr);
            ir_auto_preamp_db_.store(0.0f, std::memory_order_release);
            return false;
        };
        // Tiny preset filters are defined in samples and should retain their
        // taps; sinc resamplers need much more input to produce any output.
        if (target_rate != ir_source_rate_ && ir_source_.size() / ir_source_channels_ > 32) {
            const int source_frames = static_cast<int>(ir_source_.size()) / ir_source_channels_;
            const int target_frames = static_cast<int>(std::ceil(static_cast<double>(source_frames) * target_rate / ir_source_rate_)) + 64;
            if (target_frames > kMaxOutputIrFrames) return fail();
            samples.assign(static_cast<size_t>(target_frames) * ir_source_channels_, 0.0f);
            SRC_DATA data{};
            data.data_in = ir_source_.data();
            data.input_frames = source_frames;
            data.data_out = samples.data();
            data.output_frames = target_frames;
            data.src_ratio = static_cast<double>(target_rate) / ir_source_rate_;
            data.end_of_input = 1;
            if (src_simple(&data, SRC_SINC_BEST_QUALITY, ir_source_channels_) != 0 || data.output_frames_gen <= 0) {
                return fail();
            }
            samples.resize(static_cast<size_t>(data.output_frames_gen) * ir_source_channels_);
            const float gain = static_cast<float>(1.0 / data.src_ratio);
            for (auto& sample : samples) sample *= gain;
        }
        if (samples.size() / ir_source_channels_ > kMaxOutputIrFrames) return fail();
        auto owned = std::make_unique<PartitionedConvolver>(samples, ir_source_channels_);
        auto* raw = owned.get();
        ir_retired_runtimes_.push_back(std::move(owned));
        ir_runtime_.store(raw);
        ir_auto_preamp_db_.store(raw->auto_gain_db(), std::memory_order_release);
        reclaim_ir_runtimes();
        return true;
    }
    void reclaim_ir_runtimes() {
        if (ir_readers_.load() != 0) return;
        const auto* active = ir_runtime_.load();
        ir_retired_runtimes_.erase(
            std::remove_if(ir_retired_runtimes_.begin(), ir_retired_runtimes_.end(),
                           [active](const auto& runtime) { return runtime.get() != active; }),
            ir_retired_runtimes_.end());
    }

    void process_stereo_field(float* samples, int frames, int channels) noexcept {
        const auto* config = stereo_field_config_.load(std::memory_order_acquire);
        if (!config->enabled || channels != 2) return;
        const float mid_gain = std::pow(10.0f, config->mid_db / 20.0f);
        const float side_gain = std::pow(10.0f, config->side_db / 20.0f) * config->width;
        const float headroom = 1.0f / std::max(1.0f, std::max(mid_gain, side_gain));
        for (int frame = 0; frame < frames; ++frame) {
            float* pair = samples + frame * channels;
            const float mid = 0.5f * (pair[0] + pair[1]) * mid_gain * headroom;
            const float side = 0.5f * (pair[0] - pair[1]) * side_gain * headroom;
            pair[0] = mid + side;
            pair[1] = mid - side;
        }
    }
    void configure_delay(int) {
        const int rate = backend_format_.sample_rate > 0 ? backend_format_.sample_rate : 48000;
        delay_channels_ = std::max(1, std::min(backend_format_.channels, kMaxAudioChannels));
        delay_capacity_frames_ = rate * 2;
        delay_buffer_.assign(static_cast<size_t>(delay_capacity_frames_) * delay_channels_, 0.0f);
        delay_write_frame_ = 0;
        reverb_buffer_.assign(static_cast<size_t>(delay_capacity_frames_) * delay_channels_, 0.0f);
        reverb_write_frame_ = 0;
    }
    void configure_chorus() {
        const int rate = backend_format_.sample_rate > 0 ? backend_format_.sample_rate : 48000;
        chorus_channels_ = std::max(1, std::min(backend_format_.channels, kMaxAudioChannels));
        // 15 ms base delay + 15 ms modulation depth, with guard frames.
        chorus_capacity_frames_ = std::max(2, static_cast<int>(std::ceil(rate * 0.035f)) + 2);
        chorus_buffer_.assign(static_cast<size_t>(chorus_capacity_frames_) * chorus_channels_, 0.0f);
        chorus_write_frame_ = 0;
        chorus_phase_ = 0.0f;
    }

    void publish_compressor_config(const CompressorConfig& values) {
        auto config = std::make_unique<CompressorRuntimeConfig>();
        config->values = values;
        const float sample_rate = static_cast<float>(backend_format_.sample_rate > 0 ? backend_format_.sample_rate : 48000);
        config->attack_coefficient = std::exp(-1.0f / (values.attack_ms * 0.001f * sample_rate));
        config->release_coefficient = std::exp(-1.0f / (values.release_ms * 0.001f * sample_rate));
        const CompressorRuntimeConfig* raw = config.get();
        compressor_retired_configs_.push_back(std::move(config));
        compressor_config_.store(raw, std::memory_order_release);
    }
    void publish_noise_gate_config(const NoiseGateConfig& values) {
        auto config = std::make_unique<NoiseGateRuntimeConfig>();
        config->values = values;
        const float sample_rate = static_cast<float>(backend_format_.sample_rate > 0 ? backend_format_.sample_rate : 48000);
        config->attack_coefficient = std::exp(-1.0f / (values.attack_ms * 0.001f * sample_rate));
        config->release_coefficient = std::exp(-1.0f / (values.release_ms * 0.001f * sample_rate));
        config->hold_frames = static_cast<int>(values.hold_ms * 0.001f * sample_rate);
        config->minimum_gain = std::pow(10.0f, values.range_db / 20.0f);
        const auto* raw = config.get();
        noise_gate_retired_configs_.push_back(std::move(config));
        noise_gate_config_.store(raw, std::memory_order_release);
    }
    static std::array<EqBand, kEqBandCount> default_eq_bands() {
        constexpr std::array<float, kEqBandCount> frequencies = {
            20.0f, 31.5f, 50.0f, 80.0f, 125.0f, 200.0f, 315.0f, 500.0f,
            800.0f, 1250.0f, 2000.0f, 3150.0f, 5000.0f, 8000.0f, 10000.0f,
            12000.0f, 14000.0f, 16000.0f, 18000.0f, 20000.0f};
        std::array<EqBand, kEqBandCount> bands{};
        for (int i = 0; i < kEqBandCount; ++i) bands[i].frequency_hz = frequencies[i];
        return bands;
    }

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

    static float eq_peak_db(const EqConfig& config, int sample_rate) {
        if (!config.has_active_bands || sample_rate <= 0) return 0.0f;
        const double nyquist = sample_rate * 0.5;
        const double low = std::min(10.0, nyquist);
        double peak_db = 0.0;
        // A logarithmic grid resolves narrow low-frequency bands as well as
        // the closely spaced high-frequency bands. This runs off the callback.
        for (int point = 0; point <= 8192; ++point) {
            const double frequency = low * std::pow(nyquist / low, point / 8192.0);
            const double omega = 2.0 * 3.14159265358979323846 * frequency / sample_rate;
            const double real = std::cos(omega);
            const double imag = -std::sin(omega);
            const double real2 = std::cos(2.0 * omega);
            const double imag2 = -std::sin(2.0 * omega);
            double response_db = 0.0;
            for (const auto& c : config.coefficients) {
                if (c.b0 == 1.0f && c.b1 == 0.0f && c.b2 == 0.0f &&
                    c.a1 == 0.0f && c.a2 == 0.0f) continue;
                const double numerator_real = c.b0 + c.b1 * real + c.b2 * real2;
                const double numerator_imag = c.b1 * imag + c.b2 * imag2;
                const double denominator_real = 1.0 + c.a1 * real + c.a2 * real2;
                const double denominator_imag = c.a1 * imag + c.a2 * imag2;
                const double numerator_power = numerator_real * numerator_real + numerator_imag * numerator_imag;
                const double denominator_power = denominator_real * denominator_real + denominator_imag * denominator_imag;
                if (numerator_power > 0.0 && denominator_power > 0.0) {
                    response_db += 10.0 * std::log10(numerator_power / denominator_power);
                }
            }
            peak_db = std::max(peak_db, response_db);
        }
        return static_cast<float>(peak_db);
    }

    static BiquadCoefficients make_peaking_filter(const EqBand& band, int sample_rate) {
        if (!band.enabled || std::abs(band.gain_db) < 0.0001f || sample_rate <= 0) return {};

        const float frequency = std::min(band.frequency_hz, sample_rate * 0.45f);
        const float omega = 2.0f * 3.14159265358979323846f * frequency / sample_rate;
        const float sine = std::sin(omega);
        const float alpha = sine / (2.0f * band.q);
        const float a = std::pow(10.0f, band.gain_db / 40.0f);
        const float a0 = 1.0f + alpha / a;

        BiquadCoefficients coeffs;
        coeffs.b0 = (1.0f + alpha * a) / a0;
        coeffs.b1 = (-2.0f * std::cos(omega)) / a0;
        coeffs.b2 = (1.0f - alpha * a) / a0;
        coeffs.a1 = (-2.0f * std::cos(omega)) / a0;
        coeffs.a2 = (1.0f - alpha / a) / a0;
        return coeffs;
    }

    void publish_eq_config() {
        auto config = std::make_unique<EqConfig>();
        config->generation = eq_published_generation_.fetch_add(1, std::memory_order_acq_rel) + 1;
        // EQ runs after SRC, therefore its coefficients must use the rate of
        // the PCM actually delivered to the backend.
        const int sample_rate = backend_format_.sample_rate > 0 ? backend_format_.sample_rate :
                                (source_format_.sample_rate > 0 ? source_format_.sample_rate : 48000);
        for (int i = 0; i < kEqBandCount; ++i) {
            const auto& band = eq_bands_[i];
            config->coefficients[i] = make_peaking_filter(band, sample_rate);
            if (band.enabled && std::abs(band.gain_db) >= 0.0001f) {
                config->has_active_bands = true;
                ++config->active_band_count;
            }
        }
        config->peak_db = eq_peak_db(*config, sample_rate);
        // Leave a small margin for peaks between grid points and float rounding.
        config->headroom_gain = config->peak_db > 0.0001f
            ? std::pow(10.0f, -(config->peak_db + 0.25f) / 20.0f) : 1.0f;
        const EqConfig* raw = config.get();
        eq_retired_configs_.push_back(std::move(config));
        eq_config_.store(raw, std::memory_order_release);
    }

    void process_eq(float* samples, int frames, int channels, const EqConfig* config) noexcept {
        if (config != eq_live_config_) {
            for (auto& band : eq_states_) {
                for (auto& state : band) state = {};
            }
            eq_live_config_ = config;
            eq_processed_generation_.store(config->generation, std::memory_order_release);
        }
        if (!config->has_active_bands) return;

        const int active_channels = std::min(channels, kMaxAudioChannels);
        for (int band = 0; band < kEqBandCount; ++band) {
            const auto& c = config->coefficients[band];
            for (int frame = 0; frame < frames; ++frame) {
                for (int channel = 0; channel < active_channels; ++channel) {
                    const int index = frame * channels + channel;
                    auto& state = eq_states_[band][channel];
                    const float input = samples[index];
                    const float output = c.b0 * input + state.z1;
                    state.z1 = c.b1 * input - c.a1 * output + state.z2;
                    state.z2 = c.b2 * input - c.a2 * output;
                    samples[index] = output;
                }
            }
        }
    }

    void process_ordered_nodes(float* samples, int frames, int channels) noexcept {
        // One immutable order is loaded per callback. The control thread can
        // publish a new permutation without exposing a half-written order.
        const auto* order = ordered_nodes_.load(std::memory_order_acquire);
        const int sample_count = frames * channels;
        for (const auto id : order->ids) {
            switch (id) {
                case 0: apply_channel_controls(samples, frames, channels); break;
                case 1: {
                    const auto* rg = replay_gain_config_.load(std::memory_order_acquire);
                    const float target = rg->enabled ? std::pow(10.0f, rg->gain_db / 20.0f) : 1.0f;
                    apply_smoothed_gain(samples, sample_count, target, replay_gain_live_);
                    break;
                }
                case 2: {
                    const bool enabled = preamp_enabled_.load(std::memory_order_acquire);
                    const float target = enabled ? preamp_target_.load(std::memory_order_acquire) : 1.0f;
                    apply_smoothed_gain(samples, sample_count, target, preamp_live_);
                    break;
                }
                case 3: {
                    const auto* eq = eq_config_.load(std::memory_order_acquire);
                    if (eq->headroom_gain < eq_headroom_live_) eq_headroom_live_ = eq->headroom_gain;
                    apply_smoothed_gain(samples, sample_count, eq->headroom_gain, eq_headroom_live_);
                    process_eq(samples, frames, channels, eq);
                    break;
                }
                case 4: if (compressor_enabled_.load(std::memory_order_acquire)) process_compressor(samples, frames, channels); break;
                case 5: process_delay(samples, frames, channels); break;
                case 6: process_reverb(samples, frames, channels); break;
                case 7: process_chorus(samples, frames, channels); break;
                case 8: process_noise_gate(samples, frames, channels); break;
                case 9: process_phaser(samples, frames, channels); break;
                case 10: process_stereo_field(samples, frames, channels); break;
                case 11: crossfeed_processor_.process(samples, frames, channels, backend_format_.sample_rate,
                                                       *crossfeed_config_.load(std::memory_order_acquire)); break;
                case 12:
                    if (ir_enabled_.load(std::memory_order_acquire) && channels <= 2) {
                        ir_readers_.fetch_add(1, std::memory_order_acq_rel);
                        if (auto* ir = ir_runtime_.load(std::memory_order_acquire)) {
                            ir->process(samples, frames, channels);
                            const float automatic = ir_auto_gain_.load(std::memory_order_acquire) ? ir->auto_gain() : 1.0f;
                            const float target = automatic * ir_manual_gain_.load(std::memory_order_acquire);
                            apply_smoothed_gain(samples, sample_count, target, ir_gain_live_);
                        }
                        ir_readers_.fetch_sub(1, std::memory_order_acq_rel);
                    }
                    break;
                case 13: process_limiter(samples, frames, channels); break;
                default: break;
            }
        }
    }

    void process_compressor(float* samples, int frames, int channels) noexcept {
        const auto* config = compressor_config_.load(std::memory_order_acquire);
        if (config != compressor_live_config_) {
            compressor_gain_db_.fill(0.0f);
            compressor_live_config_ = config;
        }
        const int active_channels = std::min(channels, kMaxAudioChannels);
        for (int frame = 0; frame < frames; ++frame) {
            for (int channel = 0; channel < active_channels; ++channel) {
                const int index = frame * channels + channel;
                const float level_db = 20.0f * std::log10(std::max(std::abs(samples[index]), 1.0e-20f));
                const float over_db = std::max(0.0f, level_db - config->values.threshold_db);
                const float target_gain_db = -over_db * (1.0f - 1.0f / config->values.ratio) +
                                             config->values.makeup_db;
                float& live_gain_db = compressor_gain_db_[channel];
                const float coefficient = target_gain_db < live_gain_db
                    ? config->attack_coefficient : config->release_coefficient;
                live_gain_db = coefficient * live_gain_db + (1.0f - coefficient) * target_gain_db;
                samples[index] *= std::pow(10.0f, live_gain_db / 20.0f);
            }
        }
    }

    void process_delay(float* samples, int frames, int channels) noexcept {
        if (!delay_enabled_.load(std::memory_order_acquire) || delay_buffer_.empty()) return;
        const auto* config = delay_config_.load(std::memory_order_acquire);
        const int delay_frames = std::min(delay_capacity_frames_ - 1, std::max(1,
            static_cast<int>(config->delay_ms * backend_format_.sample_rate / 1000.0f)));
        const int active_channels = std::min(channels, delay_channels_);
        for (int frame = 0; frame < frames; ++frame) {
            const int read_frame = (delay_write_frame_ - delay_frames + delay_capacity_frames_) % delay_capacity_frames_;
            for (int channel = 0; channel < active_channels; ++channel) {
                const size_t write = static_cast<size_t>(delay_write_frame_) * delay_channels_ + channel;
                const float delayed = delay_buffer_[static_cast<size_t>(read_frame) * delay_channels_ + channel];
                const float input = samples[frame * channels + channel];
                delay_buffer_[write] = input + delayed * config->feedback;
                samples[frame * channels + channel] = input * (1.0f - config->mix) + delayed * config->mix;
            }
            delay_write_frame_ = (delay_write_frame_ + 1) % delay_capacity_frames_;
        }
    }
    void process_reverb(float* samples, int frames, int channels) noexcept {
        if (!reverb_enabled_.load(std::memory_order_acquire) || reverb_buffer_.empty()) return;
        const auto* config = reverb_config_.load(std::memory_order_acquire);
        const int active_channels = std::min(channels, delay_channels_);
        const int taps[3] = {29, 43, 61}; const float scale = 0.6f + config->room_size * 1.4f;
        for (int frame = 0; frame < frames; ++frame) {
            for (int channel = 0; channel < active_channels; ++channel) {
                const float dry = samples[frame * channels + channel];
                float wet = 0.0f;
                for (int tap : taps) {
                    const int offset = std::min(delay_capacity_frames_ - 1, static_cast<int>(tap * scale * backend_format_.sample_rate / 1000));
                    const int read = (reverb_write_frame_ - offset + delay_capacity_frames_) % delay_capacity_frames_;
                    wet += reverb_buffer_[static_cast<size_t>(read) * delay_channels_ + channel] * (0.4f + config->decay * 0.6f);
                }
                samples[frame * channels + channel] = dry * (1.0f - config->mix) + wet * (config->mix / 3.0f);
                reverb_buffer_[static_cast<size_t>(reverb_write_frame_) * delay_channels_ + channel] = dry;
            }
            reverb_write_frame_ = (reverb_write_frame_ + 1) % delay_capacity_frames_;
        }
    }
    void process_limiter(float* samples, int frames, int channels) noexcept {
        if (!limiter_enabled()) return;
        const auto* config = limiter_config_.load(std::memory_order_acquire);
        const float ceiling = std::pow(10.0f, config->ceiling_db / 20.0f);
        const float release = std::exp(-1.0f / (config->release_ms * 0.001f * std::max(1, backend_format_.sample_rate)));
        for (int frame = 0; frame < frames; ++frame) {
            float peak = 0.0f; for (int ch = 0; ch < channels; ++ch) peak = std::max(peak, std::abs(samples[frame * channels + ch]));
            const float target = peak > ceiling ? ceiling / peak : 1.0f;
            limiter_gain_ = target < limiter_gain_ ? target : release * limiter_gain_ + (1.0f - release) * target;
            for (int ch = 0; ch < channels; ++ch) samples[frame * channels + ch] *= limiter_gain_;
        }
    }
    void process_chorus(float* samples, int frames, int channels) noexcept {
        if (!chorus_enabled_.load(std::memory_order_acquire) || chorus_buffer_.empty()) return;
        const auto* config = chorus_config_.load(std::memory_order_acquire);
        const float sample_rate = static_cast<float>(std::max(1, backend_format_.sample_rate));
        const float phase_step = 6.28318530718f * config->rate_hz / sample_rate;
        const int active_channels = std::min(channels, chorus_channels_);
        for (int frame = 0; frame < frames; ++frame) {
            const float lfo = 0.5f * (std::sin(chorus_phase_) + 1.0f);
            const float delay_frames = (15.0f + config->depth_ms * lfo) * sample_rate / 1000.0f;
            float read_position = static_cast<float>(chorus_write_frame_) - delay_frames;
            while (read_position < 0.0f) read_position += static_cast<float>(chorus_capacity_frames_);
            const int first = static_cast<int>(read_position) % chorus_capacity_frames_;
            const int second = (first + 1) % chorus_capacity_frames_;
            const float fraction = read_position - std::floor(read_position);
            for (int channel = 0; channel < active_channels; ++channel) {
                const size_t write = static_cast<size_t>(chorus_write_frame_) * chorus_channels_ + channel;
                const float dry = samples[frame * channels + channel];
                const float delayed = chorus_buffer_[static_cast<size_t>(first) * chorus_channels_ + channel] * (1.0f - fraction) +
                                      chorus_buffer_[static_cast<size_t>(second) * chorus_channels_ + channel] * fraction;
                chorus_buffer_[write] = dry;
                samples[frame * channels + channel] = dry * (1.0f - config->mix) + delayed * config->mix;
            }
            chorus_write_frame_ = (chorus_write_frame_ + 1) % chorus_capacity_frames_;
            chorus_phase_ += phase_step;
            if (chorus_phase_ >= 6.28318530718f) chorus_phase_ -= 6.28318530718f;
        }
    }
    void process_noise_gate(float* samples, int frames, int channels) noexcept {
        if (!noise_gate_enabled_.load(std::memory_order_acquire)) return;
        const auto* config = noise_gate_config_.load(std::memory_order_acquire);
        for (int frame = 0; frame < frames; ++frame) {
            float peak = 0.0f;
            for (int channel = 0; channel < channels; ++channel) peak = std::max(peak, std::abs(samples[frame * channels + channel]));
            const float level_db = 20.0f * std::log10(std::max(peak, 1.0e-20f));
            bool open = level_db >= config->values.threshold_db;
            if (open) noise_gate_hold_frames_ = config->hold_frames;
            else if (noise_gate_hold_frames_ > 0) { --noise_gate_hold_frames_; open = true; }
            const float target = open ? 1.0f : config->minimum_gain;
            const float coefficient = target > noise_gate_gain_ ? config->attack_coefficient : config->release_coefficient;
            noise_gate_gain_ = coefficient * noise_gate_gain_ + (1.0f - coefficient) * target;
            for (int channel = 0; channel < channels; ++channel) samples[frame * channels + channel] *= noise_gate_gain_;
        }
    }
    void process_phaser(float* samples, int frames, int channels) noexcept {
        if (!phaser_enabled_.load(std::memory_order_acquire)) return;
        const auto* config = phaser_config_.load(std::memory_order_acquire);
        const float sample_rate = static_cast<float>(std::max(1, backend_format_.sample_rate));
        const int active_channels = std::min(channels, kMaxAudioChannels);
        for (int frame = 0; frame < frames; ++frame) {
            const float lfo = std::sin(phaser_phase_);
            const float frequency = std::max(30.0f, std::min(sample_rate * 0.45f,
                config->center_hz * std::pow(2.0f, config->depth * lfo)));
            const float tangent = std::tan(3.14159265359f * frequency / sample_rate);
            const float coefficient = (tangent - 1.0f) / (tangent + 1.0f);
            for (int channel = 0; channel < active_channels; ++channel) {
                const float dry = samples[frame * channels + channel];
                float wet = dry + phaser_feedback_[channel] * config->feedback;
                for (int stage = 0; stage < 4; ++stage) {
                    const float output = -coefficient * wet + phaser_states_[stage][channel];
                    phaser_states_[stage][channel] = wet + coefficient * output;
                    wet = output;
                }
                phaser_feedback_[channel] = wet;
                samples[frame * channels + channel] = dry * (1.0f - config->mix) + wet * config->mix;
            }
            phaser_phase_ += 6.28318530718f * config->rate_hz / sample_rate;
            if (phaser_phase_ >= 6.28318530718f) phaser_phase_ -= 6.28318530718f;
        }
    }

    static void apply_smoothed_gain(float* samples, int count, float target, float& live) noexcept {
        if (target == live) {
            // A stable non-unity gain still has to be applied to every audio
            // buffer. Returning here previously made volume/preamp affect
            // only the transition buffer.
            if (target == 1.0f) return;
            for (int i = 0; i < count; ++i) {
                samples[i] *= target;
            }
            return;
        }
        const float step = (target - live) / static_cast<float>(count);
        float gain = live;
        for (int i = 0; i < count; ++i) {
            gain += step;
            samples[i] *= gain;
        }
        live = target;
    }

    static void apply_channel_matrix(const float* input, int input_channels,
                                     float* output, int output_channels,
                                     int frames) noexcept {
        if (input == output && input_channels == output_channels) return;

        for (int frame = 0; frame < frames; ++frame) {
            const float* in = input + frame * input_channels;
            float* out = output + frame * output_channels;

            if (input_channels == output_channels) {
                std::memcpy(out, in, output_channels * sizeof(float));
            } else if (input_channels == 1 && output_channels == 2) {
                out[0] = in[0];
                out[1] = in[0];
            } else if (input_channels == 2 && output_channels == 1) {
                out[0] = 0.5f * (in[0] + in[1]);
            } else {
                const int shared = std::min(input_channels, output_channels);
                for (int channel = 0; channel < shared; ++channel) out[channel] = in[channel];
                for (int channel = shared; channel < output_channels; ++channel) out[channel] = 0.0f;
            }
        }
    }
    void apply_channel_controls(float* samples, int frames, int channels) noexcept {
        const auto* config = channel_matrix_config_.load(std::memory_order_acquire);
        if (!config->enabled || channels < 1) return;
        const float left_gain = config->balance > 0.0f ? 1.0f - config->balance : 1.0f;
        const float right_gain = config->balance < 0.0f ? 1.0f + config->balance : 1.0f;
        for (int frame = 0; frame < frames; ++frame) {
            float* values = samples + frame * channels;
            if (channels >= 2) {
                if (config->mono_downmix) {
                    const float mono = 0.5f * (values[0] + values[1]);
                    values[0] = mono; values[1] = mono;
                }
                if (config->swap_stereo) std::swap(values[0], values[1]);
                values[0] *= left_gain; values[1] *= right_gain;
            } else {
                values[0] *= std::min(left_gain, right_gain);
            }
            for (int channel = 0; channel < std::min(channels, kMaxAudioChannels); ++channel) values[channel] *= config->output_gains[channel];
        }
    }

    AudioFormat source_format_{};
    AudioFormat backend_format_{};
    BackendType backend_type_ = BackendType::DIRECTSOUND;
    bool configured_ = false;
    std::atomic<bool> preamp_enabled_{false};
    std::atomic<float> preamp_target_{1.0f};
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
    std::vector<float> time_stretch_buffer_;
    int time_stretch_capacity_frames_ = 0;
};
