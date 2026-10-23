#pragma once
#include <algorithm>
#include <cmath>
#include <cstdint>
#include <utility>
#include <vector>

// Lightweight handoff descriptors, measured off the audio callback. These are
// compatibility heuristics, not musical genre, beat or key classification.
namespace auto_mix {
constexpr double silence_floor = 0.0001; // -80 dBFS; preserve quiet reverberation
inline double silence_threshold(double peak) {
    return std::max(silence_floor, peak * 0.003);
}
struct Level { int64_t end; double rms; double brightness; };
inline Level measure(const float* pcm, int frames, int channels, int64_t end) {
    double energy = 0.0, difference = 0.0;
    for (int f = 0; f < frames; ++f) {
        for (int c = 0; c < channels; ++c) {
            const double sample = pcm[f * channels + c];
            energy += sample * sample;
            if (f > 0) {
                const double delta = sample - pcm[(f - 1) * channels + c];
                difference += delta * delta;
            }
        }
    }
    return {end, std::sqrt(energy / std::max(1, frames * channels)),
        energy > 1e-15 ? std::sqrt(difference / energy) : 0.0};
}
struct Profile { double rms = 0.0, brightness = 0.0, transient = 0.0; int count = 0; };
inline Profile summarize(const std::vector<Level>& levels, int64_t from, int64_t to) {
    Profile result;
    double previous = 0.0;
    for (const auto& level : levels) {
        if (level.end <= from || level.end > to || level.rms < silence_floor) continue;
        result.rms += level.rms;
        result.brightness += level.brightness;
        if (previous > silence_floor)
            result.transient += std::min(1.0, std::abs(level.rms - previous) / std::max(level.rms, previous));
        previous = level.rms;
        ++result.count;
    }
    if (result.count) {
        result.rms /= result.count;
        result.brightness /= result.count;
        result.transient /= std::max(1, result.count - 1);
    }
    return result;
}
inline double difference(const Profile& a, const Profile& b) {
    if (!a.count || !b.count) return 1.0;
    const double loudness = std::min(1.0, std::abs(20.0 * std::log10(
        std::max(a.rms, silence_floor) / std::max(b.rms, silence_floor))) / 12.0);
    const double timbre = std::min(1.0, std::abs(std::log2(
        std::max(a.brightness, 0.01) / std::max(b.brightness, 0.01))) / 2.0);
    const double rhythm = std::min(1.0, std::abs(a.transient - b.transient) * 3.0);
    return std::clamp(std::max({loudness, timbre, rhythm}), 0.0, 1.0);
}
inline int64_t overlap_frames(int64_t requested, int rate, double separation) {
    // Preserve an audible overlap even when tempo/key analysis is unavailable.
    // Dissimilarity changes band handoff timing rather than reducing everything
    // to a sub-second cut. The setting is still a strict upper bound.
    if (requested <= rate / 2) return requested;
    const double fraction = 1.0 - 0.25 * std::clamp(separation, 0.0, 1.0);
    return std::min<int64_t>(requested, static_cast<int64_t>(std::min(requested / double(std::max(1, rate)), 12.0) * rate * fraction));
}
inline std::pair<float, float> gains(float t, double separation) {
    t = std::clamp(t, 0.0f, 1.0f);
    // Keep fixed crossfades equal-power. Adaptive handoffs ease both endpoints
    // and reduce summed gain for incompatible material, without a hard cut.
    const float eased = t * t * (3.0f - 2.0f * t);
    t += static_cast<float>(separation) * (eased - t);
    const float weight = static_cast<float>(separation);
    return {std::cos(1.57079632679f * t) * (1.0f - weight) + (1.0f - t) * weight,
        std::sin(1.57079632679f * t) * (1.0f - weight) + t * weight};
}

// Preserve full-band voices on the ordinary equal-power envelope. Only the
// lowest bass receives a gentle timing correction; no midrange is withheld.
// This is broad EQ, not vocal/drum separation.
class StagedMixer {
public:
    void reset(int rate, int channels) {
        channels_ = channels;
        bass_alpha_ = static_cast<float>(1.0 - std::exp(-6.283185307179586 * 110 / std::max(1, rate)));
        out_bass_.assign(channels, 0);
        in_bass_.assign(channels, 0);
    }
    void process(float* outgoing, const float* incoming, int frames, int channels,
        int64_t offset, int64_t total, double separation) {
        if (channels != channels_ || total <= 0) return;
        for (int frame = 0; frame < frames; ++frame) {
            const float t = std::clamp(static_cast<float>(offset + frame) / std::max<int64_t>(1, total - 1), 0.0f, 1.0f);
            const auto full = gains(t, 0);
            const float low_t = std::clamp((t - 0.42f) / 0.16f, 0.0f, 1.0f);
            const auto bass = gains(low_t * low_t * (3 - 2 * low_t), 0);
            for (int c = 0; c < channels; ++c) {
                const size_t at = static_cast<size_t>(frame) * channels + c;
                const float a = outgoing[at], b = incoming[at];
                out_bass_[c] += bass_alpha_ * (a - out_bass_[c]);
                in_bass_[c] += bass_alpha_ * (b - in_bass_[c]);
                // Keep 65-70% of the unfiltered bass envelope too, so low
                // voices retain their fundamentals while the bass lines trade.
                const float correction = static_cast<float>(0.30 + 0.05 * std::clamp(separation, 0.0, 1.0));
                outgoing[at] = a * full.first + b * full.second + correction *
                    (out_bass_[c] * (bass.first - full.first) +
                     in_bass_[c] * (bass.second - full.second));
            }
        }
    }
private:
    int channels_ = 0;
    float bass_alpha_ = 0;
    std::vector<float> out_bass_, in_bass_;
};
} // namespace auto_mix
