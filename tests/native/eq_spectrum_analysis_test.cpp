#include "eq_spectrum_analysis.h"
#include <iostream>
#include <stdexcept>

#define CHECK(condition) do { if (!(condition)) throw std::runtime_error(#condition); } while (0)

static void check_signal(int rate, double frequency) {
    constexpr int channels = 2;
    constexpr int block = 511;
    EqSpectrumAnalysis spectrum(rate, channels);
    std::array<float, block * channels> samples{};
    int updates = 0;
    for (int start = 0; start + block <= rate; start += block) {
        for (int frame = 0; frame < block; ++frame) {
            const auto value = static_cast<float>(0.5 * std::sin(6.283185307179586 * (start + frame) * frequency / rate));
            samples[frame * channels] = value;
            samples[frame * channels + 1] = -value;
        }
        if (!spectrum.add(samples.data(), block)) continue;
        ++updates;
        const auto levels = spectrum.levels();
        const auto peak = std::max_element(levels.begin(), levels.end());
        const double peak_frequency = 20.0 * std::pow(1000.0, double(peak - levels.begin()) / (levels.size() - 1));
        CHECK(std::abs(peak_frequency / frequency - 1.0) < 0.08);
        CHECK(*peak > -8.0f && *peak < -5.0f);
    }
    CHECK(updates >= 27 && updates <= 30);
}

static void check_level_change() {
    EqSpectrumAnalysis spectrum(48000, 1);
    std::array<float, 4096> samples{};
    for (size_t frame = 0; frame < samples.size(); ++frame)
        samples[frame] = static_cast<float>(0.5 * std::sin(6.283185307179586 * 1000 * frame / 48000));
    CHECK(spectrum.add(samples.data(), static_cast<int>(samples.size())));
    const auto louder = spectrum.levels();
    for (auto& sample : samples) sample *= 0.1f;
    CHECK(spectrum.add(samples.data(), static_cast<int>(samples.size())));
    const auto quieter = spectrum.levels();
    const float difference = *std::max_element(louder.begin(), louder.end()) -
                             *std::max_element(quieter.begin(), quieter.end());
    CHECK(std::abs(difference - 20.0f) < 0.1f);
}

int main() {
    try {
        check_signal(44100, 1000);
        check_signal(48000, 10000);
        check_signal(192000, 16000);
        check_level_change();
        EqSpectrumAnalysis silence(48000, 1);
        std::vector<float> samples(6000);
        CHECK(silence.add(samples.data(), static_cast<int>(samples.size())));
        const auto levels = silence.levels();
        CHECK(std::all_of(levels.begin(), levels.end(), [](float level) { return level == EqSpectrumAnalysis::floor_db; }));
    } catch (const std::exception& error) {
        std::cerr << error.what() << '\n';
        return 1;
    }
    std::cout << "EQ spectrum verifies tone level, frequency, stereo cancellation resistance, cadence and silence\n";
}
