#include "easy_player/partitioned_convolver.h"
#include <cmath>
#include <vector>

int main() {
    const PartitionedConvolver amplified({2.0f}, 1);
    if (std::abs(amplified.auto_gain_db() + 6.0206f) > 0.001f) return 4;
    const PartitionedConvolver quiet({0.5f}, 1);
    if (std::abs(quiet.auto_gain_db()) > 0.001f) return 5;
    constexpr int frames = 1600;
    std::vector<float> samples(frames * 2, 0.0f);
    samples[0] = 1.0f;
    samples[1] = 1.0f;
    std::vector<float> ir(700 * 2, 0.0f);
    ir[0] = 0.75f;
    ir[1] = 0.25f;
    ir[2 * 511] = 0.5f;
    ir[2 * 511 + 1] = -0.5f;
    ir[2 * 650] = -0.125f;
    ir[2 * 650 + 1] = 0.125f;
    PartitionedConvolver convolver(ir, 2);
    convolver.process(samples.data(), 137, 2);
    convolver.process(samples.data() + 137 * 2, frames - 137, 2);
    for (int frame = 0; frame < frames; ++frame) {
        const int tap = frame - PartitionedConvolver::kBlock;
        const float left = tap >= 0 && tap < 700 ? ir[tap * 2] : 0.0f;
        const float right = tap >= 0 && tap < 700 ? ir[tap * 2 + 1] : 0.0f;
        if (std::abs(samples[frame * 2] - left) >= 0.0001f) return 1;
        if (std::abs(samples[frame * 2 + 1] - right) >= 0.0001f) return 2;
    }
    std::vector<float> input(frames * 2);
    for (int frame = 0; frame < frames; ++frame) {
        input[frame * 2] = std::sin(frame * 0.13f);
        input[frame * 2 + 1] = std::cos(frame * 0.07f);
    }
    std::vector<float> actual = input;
    PartitionedConvolver streamed(ir, 2);
    for (int offset = 0; offset < frames;) {
        const int count = std::min(73, frames - offset);
        streamed.process(actual.data() + offset * 2, count, 2);
        offset += count;
    }
    for (int frame = 0; frame < frames; ++frame) {
        for (int channel = 0; channel < 2; ++channel) {
            float expected = 0.0f;
            for (int tap = 0; tap < 700; ++tap) {
                const int source = frame - PartitionedConvolver::kBlock - tap;
                if (source >= 0 && source < frames)
                    expected += input[source * 2 + channel] * ir[tap * 2 + channel];
            }
            if (std::abs(actual[frame * 2 + channel] - expected) >= 0.0002f) return 3;
        }
    }
}
