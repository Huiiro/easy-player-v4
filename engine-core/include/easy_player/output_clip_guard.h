#pragma once

#include <algorithm>
#include <cstddef>
#include <cmath>
#include <cstdint>

struct OutputClipGuardStats {
    uint64_t limited_frames = 0;
    float max_reduction_db = 0.0f;
};

// Last-resort PCM sample-peak protection. Frames already inside full scale
// pass through unchanged; overloaded channels share one gain so their balance
// and stereo image are preserved. DoP never enters the PCM DSP pipeline.
class OutputClipGuard {
public:
    static OutputClipGuardStats process(float* samples, int frames, int channels) noexcept {
        OutputClipGuardStats stats{};
        if (!samples || frames <= 0 || channels <= 0) return stats;
        float max_input_peak = 1.0f;
        for (int frame = 0; frame < frames; ++frame) {
            float* values = samples + static_cast<size_t>(frame) * channels;
            float peak = 0.0f;
            for (int channel = 0; channel < channels; ++channel) {
                if (!std::isfinite(values[channel])) values[channel] = 0.0f;
                peak = std::max(peak, std::abs(values[channel]));
            }
            if (peak <= 1.0f) continue;
            ++stats.limited_frames;
            max_input_peak = std::max(max_input_peak, peak);
            const float gain = 1.0f / peak;
            for (int channel = 0; channel < channels; ++channel)
                values[channel] = std::clamp(values[channel] * gain, -1.0f, 1.0f);
        }
        if (stats.limited_frames > 0)
            stats.max_reduction_db = 20.0f * std::log10(max_input_peak);
        return stats;
    }
};
