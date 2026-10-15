#include "easy_player/output_clip_guard.h"

#include <cmath>
#include <limits>

int main() {
    float samples[] = {
        1.0f, -1.0f,
        1.5f, -0.75f,
        0.5f, -0.3f,
        std::numeric_limits<float>::quiet_NaN(), 0.2f,
        std::numeric_limits<float>::infinity(), -0.4f,
    };
    const auto stats = OutputClipGuard::process(samples, 5, 2);
    if (stats.limited_frames != 1 || std::abs(stats.max_reduction_db - 3.521825f) > 0.001f) return 7;
    if (samples[0] != 1.0f || samples[1] != -1.0f) return 1;
    if (samples[2] != 1.0f || samples[3] != -0.5f) return 2;
    if (samples[4] != 0.5f || samples[5] != -0.3f) return 3;
    if (samples[6] != 0.0f || samples[7] != 0.2f) return 4;
    if (samples[8] != 0.0f || samples[9] != -0.4f) return 5;

    float multichannel[] = {2.0f, -1.0f, 0.5f};
    const auto multichannel_stats = OutputClipGuard::process(multichannel, 1, 3);
    if (multichannel_stats.limited_frames != 1 ||
        std::abs(multichannel_stats.max_reduction_db - 6.0206f) > 0.001f) return 8;
    if (multichannel[0] != 1.0f || multichannel[1] != -0.5f ||
        multichannel[2] != 0.25f) return 6;

    float in_range[] = {0.5f, -0.9f};
    const auto no_reduction = OutputClipGuard::process(in_range, 1, 2);
    if (no_reduction.limited_frames != 0 || no_reduction.max_reduction_db != 0.0f) return 9;
}
