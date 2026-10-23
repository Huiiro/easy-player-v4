#pragma once
#include "auto_mix.h"

namespace auto_mix {
// Independent vocal and residual envelopes. Stems must be sample-aligned to
// the original mixture; the residual is always mixture minus vocal estimate.
class VocalMixer {
public:
    void reset(int rate) {
        activity_ = 0; vocal_power_ = mixture_power_ = incoming_bed_power_ = 0;
        alpha_ = 1.0f - std::exp(-1.0f / (std::max(1, rate) * 0.08f));
    }
    void process(float* outgoing, const float* incoming, const float* out_voice,
        const float* in_voice, int frames, int channels, int64_t offset, int64_t total) {
        for (int frame = 0; frame < frames; ++frame) {
            const float t = std::clamp(static_cast<float>(offset + frame) / std::max<int64_t>(1, total - 1), 0.0f, 1.0f);
            const auto full = gains(t, 0);
            float voice_square = 0, mix_square = 0, incoming_bed_square = 0;
            for (int c = 0; c < channels; ++c) {
                const size_t at = static_cast<size_t>(frame) * channels + c;
                voice_square += out_voice[at] * out_voice[at] / channels;
                mix_square += outgoing[at] * outgoing[at] / channels;
                const float bed = incoming[at] - in_voice[at];
                incoming_bed_square += bed * bed / channels;
            }
            vocal_power_ += alpha_ * (voice_square - vocal_power_);
            mixture_power_ += alpha_ * (mix_square - mixture_power_);
            incoming_bed_power_ += alpha_ * (incoming_bed_square - incoming_bed_power_);
            const float detected = vocal_power_ > 1e-7f
                ? std::clamp(std::sqrt(vocal_power_ / std::max(mixture_power_, 1e-8f)) * 1.8f, 0.0f, 1.0f) : 0;
            activity_ += alpha_ * (detected - activity_);
            const float restore = smooth((t - 0.65f) / 0.35f);
            // Separator leakage in an exhausted tail must not keep ducking the
            // next bed. Protection follows audible voice, not just voice ratio.
            const float audible = smooth((std::sqrt(vocal_power_) - 0.002f) / 0.010f) *
                smooth(std::sqrt(vocal_power_ / std::max(incoming_bed_power_, 1e-8f)) / 0.08f);
            const float protection = activity_ * audible * (1 - restore);
            // The outgoing tail remains forward until the last part of the
            // overlap. Boost is limited to +6dB and smoothly enters/exits.
            const float bridge = smooth(t / 0.12f) * (1 - smooth((t - 0.72f) / 0.28f));
            const float out_gain = std::max(full.first, bridge);
            const float needed = std::clamp(0.45f * std::sqrt(incoming_bed_power_ /
                std::max(vocal_power_, 1e-8f)), 1.0f, 1.995f);
            const float boost = 1 + (needed - 1) * activity_ * bridge;
            const float in_bed_gain = full.second * (1 - 0.65f * protection);
            const float in_voice_gain = full.second * (1 - 0.5f * protection);
            for (int c = 0; c < channels; ++c) {
                const size_t at = static_cast<size_t>(frame) * channels + c;
                outgoing[at] = (outgoing[at] - out_voice[at]) * full.first +
                    out_voice[at] * out_gain * boost +
                    (incoming[at] - in_voice[at]) * in_bed_gain + in_voice[at] * in_voice_gain;
            }
        }
    }
private:
    static float smooth(float t) { t = std::clamp(t, 0.0f, 1.0f); return t * t * (3 - 2 * t); }
    float alpha_ = 0, activity_ = 0, vocal_power_ = 0, mixture_power_ = 0, incoming_bed_power_ = 0;
};
} // namespace auto_mix
