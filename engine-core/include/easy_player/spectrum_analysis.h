#pragma once
#include <algorithm>
#include <array>
#include <cmath>

// Same 64 logarithmic DFT magnitudes as the visualizer, using Goertzel's
// recurrence. Mix channels and apply the Hann window once per block instead
// of repeating both operations and three trig calls per sample per band.
class SpectrumAnalysis {
public:
    std::array<float, 64> process(const float* samples, int frames, int channels, float rate) {
        std::array<float, 64> result{};
        if (!samples || frames <= 0 || frames > 1024 || channels <= 0 || rate <= 0) return result;
        if (rate != rate_) {
            rate_ = rate;
            for (int band = 0; band < 64; ++band) {
                const double frequency = std::min(double(rate) * 0.45, 45.0 * std::pow(2.0, band / 10.0));
                coefficients_[band] = 2.0 * std::cos(6.283185307179586 * frequency / rate);
            }
        }
        if (frames != frames_) {
            frames_ = frames;
            for (int frame = 0; frame < frames; ++frame)
                window_[frame] = 0.5 - 0.5 * std::cos(6.283185307179586 * frame / std::max(1, frames - 1));
        }
        for (int frame = 0; frame < frames; ++frame) {
            double mono = 0;
            for (int channel = 0; channel < channels; ++channel) mono += samples[frame * channels + channel];
            mono_[frame] = std::isfinite(mono) ? mono * window_[frame] : 0;
        }
        for (int band = 0; band < 64; ++band) {
            double first = 0, second = 0;
            const double coefficient = coefficients_[band];
            for (int frame = 0; frame < frames; ++frame) {
                const double value = mono_[frame] + coefficient * first - second;
                second = first;
                first = value;
            }
            const double power = std::max(0.0, first * first + second * second - coefficient * first * second);
            result[band] = static_cast<float>(std::min(1.0, 4.0 * std::sqrt(power) / frames));
        }
        return result;
    }
private:
    float rate_ = 0;
    int frames_ = 0;
    std::array<double, 64> coefficients_{};
    std::array<double, 1024> mono_{}, window_{};
};
