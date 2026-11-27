// Dynamics, time-based effects and stereo controls.
// Settings publish immutable snapshots while the render path updates its own filter and delay state.

#include "dsp_pipeline.h"
#include <algorithm>
#include <cmath>
#include <utility>

bool DspPipeline::set_compressor_config(const CompressorConfig& config) {
    CompressorConfig clamped = config;
    clamped.threshold_db = std::max(-60.0f, std::min(0.0f, clamped.threshold_db));
    clamped.ratio = std::max(1.0f, std::min(20.0f, clamped.ratio));
    clamped.attack_ms = std::max(0.1f, std::min(500.0f, clamped.attack_ms));
    clamped.release_ms = std::max(5.0f, std::min(2000.0f, clamped.release_ms));
    clamped.makeup_db = std::max(-12.0f, std::min(24.0f, clamped.makeup_db));
    publish_compressor_config(clamped);
    return true;
}

bool DspPipeline::set_delay_config(const DelayConfig& config) {
    DelayConfig clamped = config;
    clamped.delay_ms = std::max(1.0f, std::min(2000.0f, clamped.delay_ms));
    clamped.feedback = std::max(0.0f, std::min(0.95f, clamped.feedback));
    clamped.mix = std::max(0.0f, std::min(1.0f, clamped.mix));
    auto owned = std::make_unique<DelayConfig>(clamped);
    const DelayConfig* raw = owned.get(); delay_retired_configs_.push_back(std::move(owned));
    delay_config_.store(raw, std::memory_order_release); return true;
}

bool DspPipeline::set_reverb_config(const ReverbConfig& config) {
    ReverbConfig value{std::max(0.0f, std::min(1.0f, config.room_size)),
                       std::max(0.0f, std::min(1.0f, config.decay)),
                       std::max(0.0f, std::min(1.0f, config.mix))};
    auto owned = std::make_unique<ReverbConfig>(value); const auto* raw = owned.get();
    reverb_retired_configs_.push_back(std::move(owned)); reverb_config_.store(raw, std::memory_order_release); return true;
}

bool DspPipeline::set_limiter_config(const LimiterConfig& input) {
    LimiterConfig value{std::max(-12.0f, std::min(0.0f, input.ceiling_db)), std::max(5.0f, std::min(2000.0f, input.release_ms))};
    auto owned = std::make_unique<LimiterConfig>(value); const auto* raw = owned.get();
    limiter_retired_configs_.push_back(std::move(owned)); limiter_config_.store(raw, std::memory_order_release); return true;
}

bool DspPipeline::set_chorus_config(const ChorusConfig& input) {
    ChorusConfig value{std::max(0.05f, std::min(10.0f, input.rate_hz)),
                       std::max(0.1f, std::min(15.0f, input.depth_ms)),
                       std::max(0.0f, std::min(1.0f, input.mix))};
    auto owned = std::make_unique<ChorusConfig>(value); const auto* raw = owned.get();
    chorus_retired_configs_.push_back(std::move(owned)); chorus_config_.store(raw, std::memory_order_release); return true;
}

bool DspPipeline::set_noise_gate_config(const NoiseGateConfig& input) {
    NoiseGateConfig value{std::max(-80.0f, std::min(0.0f, input.threshold_db)),
                          std::max(0.1f, std::min(200.0f, input.attack_ms)),
                          std::max(0.0f, std::min(2000.0f, input.hold_ms)),
                          std::max(5.0f, std::min(2000.0f, input.release_ms)),
                          std::max(-100.0f, std::min(0.0f, input.range_db))};
    publish_noise_gate_config(value); return true;
}

bool DspPipeline::set_phaser_config(const PhaserConfig& input) {
    PhaserConfig value{std::max(0.05f, std::min(10.0f, input.rate_hz)),
                       std::max(0.0f, std::min(1.0f, input.depth)),
                       std::max(100.0f, std::min(5000.0f, input.center_hz)),
                       std::max(-0.95f, std::min(0.95f, input.feedback)),
                       std::max(0.0f, std::min(1.0f, input.mix))};
    auto owned = std::make_unique<PhaserConfig>(value); const auto* raw = owned.get();
    phaser_retired_configs_.push_back(std::move(owned)); phaser_config_.store(raw, std::memory_order_release); return true;
}

bool DspPipeline::set_channel_matrix_config(const ChannelMatrixConfig& input) {
    ChannelMatrixConfig value = input;
    value.balance = std::max(-1.0f, std::min(1.0f, value.balance));
    for (auto& gain : value.output_gains) gain = std::max(0.0f, std::min(2.0f, gain));
    auto owned = std::make_unique<ChannelMatrixConfig>(value); const auto* raw = owned.get();
    channel_matrix_retired_configs_.push_back(std::move(owned)); channel_matrix_config_.store(raw, std::memory_order_release); return true;
}

bool DspPipeline::set_stereo_field_config(const StereoFieldConfig& input) {
    if (!std::isfinite(input.mid_db) || !std::isfinite(input.side_db) || !std::isfinite(input.width)) return false;
    StereoFieldConfig value{input.enabled, std::clamp(input.mid_db, -12.0f, 6.0f),
                            std::clamp(input.side_db, -12.0f, 6.0f), std::clamp(input.width, 0.0f, 2.0f)};
    auto owned = std::make_unique<StereoFieldConfig>(value);
    const auto* raw = owned.get();
    stereo_field_retired_configs_.push_back(std::move(owned));
    stereo_field_config_.store(raw, std::memory_order_release);
    return true;
}

bool DspPipeline::set_crossfeed_config(const CrossfeedConfig& input) {
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

void DspPipeline::process_stereo_field(float* samples, int frames, int channels) noexcept {
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

void DspPipeline::configure_delay(int) {
    const int rate = backend_format_.sample_rate > 0 ? backend_format_.sample_rate : 48000;
    delay_channels_ = std::max(1, std::min(backend_format_.channels, kMaxAudioChannels));
    delay_capacity_frames_ = rate * 2;
    delay_buffer_.assign(static_cast<size_t>(delay_capacity_frames_) * delay_channels_, 0.0f);
    delay_write_frame_ = 0;
    reverb_buffer_.assign(static_cast<size_t>(delay_capacity_frames_) * delay_channels_, 0.0f);
    reverb_write_frame_ = 0;
}

void DspPipeline::configure_chorus() {
    const int rate = backend_format_.sample_rate > 0 ? backend_format_.sample_rate : 48000;
    chorus_channels_ = std::max(1, std::min(backend_format_.channels, kMaxAudioChannels));
    // 15 ms base delay + 15 ms modulation depth, with guard frames.
    chorus_capacity_frames_ = std::max(2, static_cast<int>(std::ceil(rate * 0.035f)) + 2);
    chorus_buffer_.assign(static_cast<size_t>(chorus_capacity_frames_) * chorus_channels_, 0.0f);
    chorus_write_frame_ = 0;
    chorus_phase_ = 0.0f;
}

void DspPipeline::publish_compressor_config(const CompressorConfig& values) {
    auto config = std::make_unique<CompressorRuntimeConfig>();
    config->values = values;
    const float sample_rate = static_cast<float>(backend_format_.sample_rate > 0 ? backend_format_.sample_rate : 48000);
    config->attack_coefficient = std::exp(-1.0f / (values.attack_ms * 0.001f * sample_rate));
    config->release_coefficient = std::exp(-1.0f / (values.release_ms * 0.001f * sample_rate));
    const CompressorRuntimeConfig* raw = config.get();
    compressor_retired_configs_.push_back(std::move(config));
    compressor_config_.store(raw, std::memory_order_release);
}

void DspPipeline::publish_noise_gate_config(const NoiseGateConfig& values) {
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

void DspPipeline::process_compressor(float* samples, int frames, int channels) noexcept {
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

void DspPipeline::process_delay(float* samples, int frames, int channels) noexcept {
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

void DspPipeline::process_reverb(float* samples, int frames, int channels) noexcept {
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

void DspPipeline::process_limiter(float* samples, int frames, int channels) noexcept {
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

void DspPipeline::process_chorus(float* samples, int frames, int channels) noexcept {
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

void DspPipeline::process_noise_gate(float* samples, int frames, int channels) noexcept {
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

void DspPipeline::process_phaser(float* samples, int frames, int channels) noexcept {
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

void DspPipeline::apply_channel_controls(float* samples, int frames, int channels) noexcept {
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
