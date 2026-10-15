#include "easy_player/crossfeed_processor.h"

#include <cmath>
#include <vector>

int main() {
    CrossfeedProcessor processor;
    const CrossfeedConfig standard{true, 0.5f, 700.0f, 0.25f};

    std::vector<float> mono(256 * 2, 0.4f);
    processor.process(mono.data(), 256, 2, 48000, standard);
    for (float sample : mono) {
        if (std::abs(sample - 0.4f) > 0.000001f) return 1;
    }

    processor.reset();
    std::vector<float> left_only(2048 * 2, 0.0f);
    for (int frame = 0; frame < 2048; ++frame) left_only[2 * frame] = 1.0f;
    processor.process(left_only.data(), 2048, 2, 48000, standard);
    if (std::abs(left_only[2 * 2047] - 0.825f) > 0.001f ||
        std::abs(left_only[2 * 2047 + 1] - 0.175f) > 0.001f) return 2;

    std::vector<float> alternating(2048 * 2, 0.0f);
    for (int frame = 0; frame < 2048; ++frame)
        alternating[2 * frame] = frame % 2 ? -1.0f : 1.0f;
    processor.process(alternating.data(), 2048, 2, 48000, standard);
    if (std::abs(alternating[2 * 2047 + 1]) > 0.02f) return 3;

    processor.reset();
    std::vector<float> impulse(128 * 2, 0.0f);
    impulse[0] = 1.0f;
    processor.process(impulse.data(), 128, 2, 48000, {true, 1.0f, 700.0f, 0.5f});
    for (int frame = 0; frame < 24; ++frame)
        if (impulse[2 * frame + 1] != 0.0f) return 4;
    if (impulse[2 * 24 + 1] <= 0.0f) return 5;

    std::vector<float> bypass(128 * 2, 0.0f);
    processor.process(bypass.data(), 128, 2, 48000, {false, 1.0f, 700.0f, 0.5f});
    std::vector<float> original(128 * 2, 0.0f);
    original[0] = 1.0f;
    bypass = original;
    processor.process(bypass.data(), 128, 2, 48000, {false, 1.0f, 700.0f, 0.5f});
    if (bypass != original) return 6;
}
