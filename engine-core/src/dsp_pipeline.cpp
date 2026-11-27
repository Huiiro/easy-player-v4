// DSP configuration, format conversion and rendering order.
// Each render call reports consumed input and produced output so EOF can drain the pipeline.

#include "dsp_pipeline.h"
#include "output_clip_guard.h"
#include <algorithm>
#include <cmath>
#include <cstring>
#include <utility>

DspPipeline::DspPipeline() {
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

void DspPipeline::set_preamp_db(float db, bool enabled) {
    const float clamped_db = std::max(-24.0f, std::min(24.0f, db));
    preamp_target_.store(std::pow(10.0f, clamped_db / 20.0f),
                         std::memory_order_release);
    preamp_enabled_.store(enabled, std::memory_order_release);
}

bool DspPipeline::set_replay_gain_config(const ReplayGainConfig& input) {
    ReplayGainConfig value{input.enabled, std::max(-60.0f, std::min(24.0f, input.gain_db)), std::max(0.0f, std::min(100.0f, input.peak)), input.prevent_clipping};
    if (value.prevent_clipping && value.peak > 0.0f) value.gain_db = std::min(value.gain_db, -20.0f * std::log10(value.peak));
    auto owned = std::make_unique<ReplayGainConfig>(value); const auto* raw = owned.get();
    replay_gain_retired_configs_.push_back(std::move(owned)); replay_gain_config_.store(raw, std::memory_order_release); return true;
}

bool DspPipeline::set_playback_speed_config(const PlaybackSpeedConfig& input) {
    PlaybackSpeedConfig value{input.enabled, std::max(0.5f, std::min(2.0f, input.speed))};
    auto owned = std::make_unique<PlaybackSpeedConfig>(value); const auto* raw = owned.get();
    playback_speed_retired_configs_.push_back(std::move(owned)); playback_speed_config_.store(raw, std::memory_order_release); return true;
}

void DspPipeline::set_master_volume(float volume) {
    master_volume_target_.store(std::max(0.0f, std::min(1.0f, volume)),
                                std::memory_order_release);
}

void DspPipeline::configure(const AudioFormat& source_format,
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

void DspPipeline::reset(const AudioFormat& source_format) {
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
    reset_time_stretch();
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

bool DspPipeline::set_dsp_nodes(const std::vector<DspNodeConfig>& nodes) {
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

std::vector<DspNodeConfig> DspPipeline::dsp_nodes() const {
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

int DspPipeline::required_input_frames(int output_frames) const noexcept {
    if (source_format_.sample_rate <= 0 || backend_format_.sample_rate <= 0) return output_frames;
    const auto* speed = playback_speed_config_.load(std::memory_order_acquire);
    const float factor = speed->enabled ? speed->speed : 1.0f;
    return static_cast<int>(std::ceil(static_cast<double>(output_frames) * factor * source_format_.sample_rate /
                                      backend_format_.sample_rate)) + 64;
}

DspPipeline::ProcessResult DspPipeline::process(const float* input, int input_frames, int input_channels,
                                                bool end_of_input, float* output, int frames, int output_channels,
                                                RingBuffer* pre_volume_monitor) noexcept {
    ProcessResult result;
    const int samples = frames * output_channels;
    if (samples <= 0 || input_channels <= 0 || output_channels <= 0) return result;

    std::memset(output, 0, static_cast<size_t>(samples) * sizeof(float));
    const auto* speed = playback_speed_config_.load(std::memory_order_acquire);
    const bool stretch_enabled = speed->enabled && std::abs(speed->speed - 1.0f) >= 0.0001f;
    // Deliver the old tail before bypassing at 1x. Once padding has started,
    // finish the tail even if another speed arrives during the transition.
    time_stretch_finishing_ = time_stretch_finishing_ ||
        (!stretch_enabled && !time_stretch_flushed_ && time_stretch_expected_frames_ > 0);
    int requested_frames = frames;
    if (time_stretch_finishing_) {
        requested_frames = 0;
    } else if (stretch_enabled) {
        time_stretch_.setTempo(speed->speed);
        const auto ready_frames = time_stretch_.numSamples();
        const double pending_frames = ready_frames +
            static_cast<double>(time_stretch_.numUnprocessedSamples()) / speed->speed;
        // Keep enough look-ahead to produce the next batch, while preventing
        // the input margin from building up an ever-growing output queue.
        const double look_ahead = time_stretch_.getSetting(SETTING_INITIAL_LATENCY) / speed->speed;
        requested_frames = ready_frames >= static_cast<unsigned int>(frames) &&
                           pending_frames >= frames + look_ahead
            ? 0
            : std::min(time_stretch_capacity_frames_, static_cast<int>(std::ceil(frames * speed->speed)) + 64);
    }
    const float* matrix_input = input;
    int matrix_frames = std::min(input_frames, requested_frames);
    if (resampler_ && requested_frames > 0) {
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
    } else if (requested_frames > 0) {
        result.input_frames_used = matrix_frames;
        result.output_frames_generated = matrix_frames;
        result.stream_drained = end_of_input && input_frames == 0;
    }

    if (stretch_enabled || time_stretch_finishing_) {
        if (matrix_frames > 0) {
            time_stretch_flushed_ = false;
            apply_channel_matrix(matrix_input, input_channels, time_stretch_buffer_.data(), output_channels, matrix_frames);
            time_stretch_expected_frames_ += matrix_frames * time_stretch_.getInputOutputSampleRatio();
            time_stretch_.putSamples(time_stretch_buffer_.data(), static_cast<unsigned int>(matrix_frames));
        }
        // Drain SRC first, then push the SoundTouch tail out with preallocated
        // silence. SoundTouch::flush() allocates a temporary array, so it
        // cannot be used on this real-time path. Match its 128-frame padding
        // and 200-block bound, capping output to the real input duration.
        const bool upstream_drained = result.stream_drained;
        const bool drain_stretch = upstream_drained || time_stretch_finishing_;
        int receive_frames = frames;
        const auto expected_frames = static_cast<int64_t>(time_stretch_expected_frames_ + 0.5);
        if (drain_stretch) {
            const int64_t remaining = std::max<int64_t>(0, expected_frames - time_stretch_delivered_frames_);
            receive_frames = static_cast<int>(std::min<int64_t>(frames, remaining));
            while (time_stretch_.numSamples() < static_cast<unsigned int>(receive_frames) &&
                   time_stretch_tail_blocks_ < 200) {
                time_stretch_.putSamples(time_stretch_tail_silence_.data(), 128);
                ++time_stretch_tail_blocks_;
            }
        }
        result.output_frames_generated = static_cast<int>(time_stretch_.receiveSamples(output, static_cast<unsigned int>(receive_frames)));
        time_stretch_delivered_frames_ += result.output_frames_generated;
        if (drain_stretch && (time_stretch_delivered_frames_ >= expected_frames ||
            (time_stretch_tail_blocks_ == 200 && time_stretch_.numSamples() == 0))) {
            if (time_stretch_finishing_) {
                reset_time_stretch();
            } else if (!time_stretch_flushed_) {
                time_stretch_.clear();
                time_stretch_flushed_ = true;
            }
        }
        result.stream_drained = upstream_drained && time_stretch_flushed_ &&
            result.output_frames_generated == 0 && time_stretch_.numSamples() == 0;
    } else if (matrix_frames > 0) {
        apply_channel_matrix(matrix_input, input_channels, output, output_channels, matrix_frames);
    }
    if (!playback_only_.load(std::memory_order_acquire)) {
        process_ordered_nodes(output, frames, output_channels);
        if (pre_volume_monitor) pre_volume_monitor->write(output, frames, 0);
    }
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

AudioChainStatus DspPipeline::status() const {
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
        // source. Widening 16 to 24 or 24 to 32 keeps every original integer
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

void DspPipeline::configure_resampler(int max_output_frames) {
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

void DspPipeline::reset_time_stretch() noexcept {
    time_stretch_.clear();
    time_stretch_finishing_ = false;
    time_stretch_flushed_ = false;
    time_stretch_expected_frames_ = 0;
    time_stretch_delivered_frames_ = 0;
    time_stretch_tail_blocks_ = 0;
}

void DspPipeline::configure_time_stretch(int max_output_frames) {
    reset_time_stretch();
    const int rate = backend_format_.sample_rate > 0 ? backend_format_.sample_rate : 48000;
    const int channels = std::max(1, std::min(backend_format_.channels, kMaxAudioChannels));
    time_stretch_.setSampleRate(static_cast<unsigned int>(rate));
    time_stretch_.setChannels(static_cast<unsigned int>(channels));
    time_stretch_.setTempo(1.0);
    time_stretch_capacity_frames_ = std::max(1, max_output_frames * 2 + 128);
    time_stretch_buffer_.assign(static_cast<size_t>(time_stretch_capacity_frames_) * channels, 0.0f);
    time_stretch_.putSamples(time_stretch_buffer_.data(), static_cast<unsigned int>(time_stretch_capacity_frames_));
    time_stretch_.clear();
}

void DspPipeline::process_ordered_nodes(float* samples, int frames, int channels) noexcept {
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

void DspPipeline::apply_smoothed_gain(float* samples, int count, float target, float& live) noexcept {
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

void DspPipeline::apply_channel_matrix(const float* input, int input_channels,
                                       float* output, int output_channels,
                                       int frames) noexcept {
    if (input_channels == output_channels) {
        if (input != output)
            std::memcpy(output, input, static_cast<size_t>(frames) * input_channels * sizeof(float));
        return;
    }

    for (int frame = 0; frame < frames; ++frame) {
        const float* in = input + frame * input_channels;
        float* out = output + frame * output_channels;

        if (input_channels == 1 && output_channels == 2) {
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
