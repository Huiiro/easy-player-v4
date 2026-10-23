#pragma once
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <numeric>
#include <vector>

namespace auto_mix {
struct MusicalProfile {
    double bpm = 0, confidence = 0, period = 0, first_beat = 0;
    // Four-beat accent grouping is only a hint when repeated accents agree.
    double bar_confidence = 0, first_bar = 0;
    int key = -1; // 0..11 major, 12..23 minor; -1 unknown
    double key_confidence = 0;
};

// Bounded local analysis, independent of playback speed and audio callback.
class MusicalAnalyzer {
public:
    explicit MusicalAnalyzer(int rate, int channels, double start_seconds = 0)
        : rate_(rate), channels_(channels), start_(start_seconds), hop_(std::max(1, rate / 100)),
          stride_(std::max(1, rate / 8000)) {}
    void add(const float* pcm, int frames) {
        for (int i = 0; i < frames; ++i) {
            double mono = 0, energy = 0;
            for (int c = 0; c < channels_; ++c) {
                const double sample = pcm[i * channels_ + c];
                if (!std::isfinite(sample)) continue;
                mono += sample; energy += sample * sample;
            }
            mono /= channels_;
            // Low-pass before decimation for chroma analysis.
            filtered_ += 0.35 * (mono - filtered_);
            if (samples_++ % stride_ == 0) mono_.push_back(filtered_);
            energy_ += energy / channels_;
            if (++in_hop_ == hop_) {
                const double rms = std::sqrt(energy_ / hop_);
                envelope_.push_back(std::max(0.0, rms - previous_));
                previous_ = rms; in_hop_ = 0; energy_ = 0;
            }
        }
    }
    MusicalProfile finish() const {
        MusicalProfile result;
        rhythm(result); tonality(result);
        return result;
    }
private:
    void rhythm(MusicalProfile& result) const {
        if (envelope_.size() < 600) return; // at least six seconds
        const double hop_seconds = double(hop_) / rate_;
        const double maximum = *std::max_element(envelope_.begin(), envelope_.end());
        const double mean = std::accumulate(envelope_.begin(), envelope_.end(), 0.0) / envelope_.size();
        if (maximum < 0.0005) return;
        std::vector<int> peaks;
        for (int i = 1; i + 1 < static_cast<int>(envelope_.size()); ++i) {
            if (envelope_[i] < std::max(maximum * 0.16, mean * 1.5) ||
                envelope_[i] < envelope_[i - 1] || envelope_[i] < envelope_[i + 1]) continue;
            if (!peaks.empty() && (i - peaks.back()) * hop_seconds < 0.18) {
                if (envelope_[i] > envelope_[peaks.back()]) peaks.back() = i;
            } else peaks.push_back(i);
        }
        if (peaks.size() < 8) return;
        // Search continuous tempo candidates; a soft onset tolerance avoids
        // integer-lag quantization at tempos such as 123 BPM.
        double best = 0, period = 0, phase = 0;
        for (double bpm = 65; bpm <= 180; bpm += 0.25) {
            const double candidate = 60.0 / bpm;
            for (int seed = 0; seed < std::min<int>(8, peaks.size()); ++seed) {
                const double origin = peaks[seed] * hop_seconds;
                double support = 0, weight = 0;
                int hits = 0;
                for (int peak : peaks) {
                    const double cycles = (peak * hop_seconds - origin) / candidate;
                    const double distance = std::abs(cycles - std::round(cycles)) * candidate;
                    const double w = std::sqrt(envelope_[peak]);
                    weight += w;
                    const double match = std::max(0.0, 1.0 - distance / 0.045);
                    support += w * match;
                    if (distance < 0.035) ++hits;
                }
                const double expected = std::max(1.0, (peaks.back() - peaks.front()) * hop_seconds / candidate + 1);
                const double coverage = std::min(1.0, hits / expected);
                const double score = support / std::max(weight, 1e-12) * coverage;
                if (score > best) { best = score; period = candidate; phase = origin; }
            }
        }
        if (best < 0.72) return;
        // Reject drift: require aligned evidence in both halves of the region.
        int early = 0, late = 0;
        for (int peak : peaks) {
            const double cycles = (peak * hop_seconds - phase) / period;
            if (std::abs(cycles - std::round(cycles)) * period > 0.035) continue;
            if (peak < (peaks.front() + peaks.back()) / 2) ++early; else ++late;
        }
        if (early < 3 || late < 3) return;
        while (phase >= period) phase -= period;
        result.period = period; result.bpm = 60.0 / period;
        result.confidence = best; result.first_beat = start_ + phase;
        std::array<double, 4> accents{};
        std::array<int, 4> counts{};
        for (int peak : peaks) {
            const double beat = (peak * hop_seconds - phase) / period;
            if (std::abs(beat - std::round(beat)) * period > 0.035) continue;
            const int slot = (static_cast<int>(std::llround(beat)) % 4 + 4) % 4;
            accents[slot] += envelope_[peak]; ++counts[slot];
        }
        if (*std::min_element(counts.begin(), counts.end()) < 3) return;
        for (int i = 0; i < 4; ++i) accents[i] /= counts[i];
        const int strong = static_cast<int>(std::max_element(accents.begin(), accents.end()) - accents.begin());
        const double others = (std::accumulate(accents.begin(), accents.end(), 0.0) - accents[strong]) / 3;
        result.bar_confidence = std::clamp((accents[strong] / std::max(others, 1e-9) - 1.0) / 1.5, 0.0, 1.0);
        result.first_bar = result.first_beat + strong * period;
    }
    void tonality(MusicalProfile& result) const {
        constexpr int window = 2048;
        if (mono_.size() < window * 4) return;
        const double rate = double(rate_) / stride_;
        std::array<double, 12> chroma{};
        std::array<double, 48> coefficients{};
        for (int n = 0; n < 48; ++n) {
            const double frequency = 440.0 * std::pow(2.0, (48 + n - 69) / 12.0);
            coefficients[n] = 2.0 * std::cos(6.283185307179586 * frequency / rate);
        }
        std::array<double, window> block{};
        for (size_t at = 0; at + window <= mono_.size(); at += window) {
            for (int i = 0; i < window; ++i)
                block[i] = mono_[at + i] * (0.5 - 0.5 * std::cos(6.283185307179586 * i / (window - 1)));
            for (int n = 0; n < 48; ++n) {
                double a = 0, b = 0;
                for (double sample : block) { const double value = sample + coefficients[n] * a - b; b = a; a = value; }
                chroma[n % 12] += std::sqrt(std::max(0.0, a * a + b * b - coefficients[n] * a * b));
            }
        }
        const double peak = *std::max_element(chroma.begin(), chroma.end());
        if (peak < 0.01 || std::count_if(chroma.begin(), chroma.end(), [&](double x) { return x > peak * 0.18; }) < 3) return;
        // Pearson correlation with major/minor pitch-class templates.
        const std::array<double, 12> major{6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88};
        const std::array<double, 12> minor{6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17};
        double best = -1, second = -1;
        int key = -1;
        const double mean = std::accumulate(chroma.begin(), chroma.end(), 0.0) / 12;
        for (int mode = 0; mode < 2; ++mode) {
            const auto& pattern = mode == 0 ? major : minor;
            const double pm = std::accumulate(pattern.begin(), pattern.end(), 0.0) / 12;
            for (int tonic = 0; tonic < 12; ++tonic) {
                double dot = 0, x2 = 0, y2 = 0;
                for (int note = 0; note < 12; ++note) {
                    const double x = chroma[(note + tonic) % 12] - mean, y = pattern[note] - pm;
                    dot += x * y; x2 += x * x; y2 += y * y;
                }
                const double score = dot / std::sqrt(std::max(1e-15, x2 * y2));
                if (score > best) { second = best; best = score; key = tonic + mode * 12; }
                else second = std::max(second, score);
            }
        }
        result.key_confidence = std::clamp(std::min((best - 0.45) / 0.35, (best - second) / 0.10), 0.0, 1.0);
        if (result.key_confidence >= 0.6) result.key = key;
    }
    int rate_, channels_;
    double start_;
    int hop_, stride_, samples_ = 0, in_hop_ = 0;
    double energy_ = 0, previous_ = 0, filtered_ = 0;
    std::vector<double> envelope_, mono_;
};

inline bool harmonic_compatible(int a, int b) {
    if (a < 0 || b < 0) return true; // unknown is not evidence of a clash
    if (a == b) return true;
    const int tonic_a = a % 12, tonic_b = b % 12;
    if (a / 12 == b / 12) {
        const int distance = (tonic_a - tonic_b + 12) % 12;
        return distance == 5 || distance == 7;
    }
    const int major = a < 12 ? tonic_a : tonic_b;
    const int minor = a >= 12 ? tonic_a : tonic_b;
    return (major + 9) % 12 == minor;
}
struct BeatHandoff {
    bool matched = false;
    int64_t fade_frames = 0, delay_frames = 0;
    double tempo = 1.0;
    int64_t source_start = 0;
};
inline BeatHandoff choose_handoff(const MusicalProfile& out, const MusicalProfile& in,
    int64_t end, int64_t max_frames, int rate, double separation, int64_t source_start = 0) {
    BeatHandoff result;
    if (out.confidence < 0.78 || in.confidence < 0.78 || out.period <= 0 || in.period <= 0 ||
        separation > 0.7 || !harmonic_compatible(out.key, in.key)) return result;
    const double tempo = out.bpm / in.bpm;
    // Avoid octave guesses and audible stretching across unrelated tempos.
    if (tempo < 0.96 || tempo > 1.04) return result;
    const double period_frames = out.period * rate;
    const double origin = out.first_beat * rate;
    double start = origin + std::ceil((end - max_frames - origin) / period_frames) * period_frames;
    start = std::max(0.0, start);
    // Only use four-beat accent grouping when both segments support it.
    if (out.bar_confidence >= 0.7 && in.bar_confidence >= 0.7) {
        const double bar_origin = out.first_bar * rate;
        start = bar_origin + std::ceil((start - bar_origin) / (period_frames * 4)) * period_frames * 4;
    }
    const int64_t fade = end - static_cast<int64_t>(std::llround(start));
    double beat_offset = std::fmod((in.first_beat * rate - source_start) / tempo, period_frames);
    if (beat_offset < 0) beat_offset += period_frames;
    const int64_t delay = static_cast<int64_t>(std::llround(std::fmod(period_frames - beat_offset, period_frames)));
    if (fade - delay < period_frames * 4 || fade > max_frames) return result;
    return {true, fade, delay, tempo, source_start};
}
} // namespace auto_mix
