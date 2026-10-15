#include "spectrum_analysis.h"
#include <iostream>
#include <vector>

int main() {
    SpectrumAnalysis spectrum;
    double worst_error = 0;
    for (int rate : {8000, 44100, 48000, 192000}) {
        for (int frames : {1, 127, 512, 1024}) {
            for (int channels : {1, 2, 8}) {
                std::vector<float> samples(frames * channels);
                for (int frame = 0; frame < frames; ++frame)
                    for (int channel = 0; channel < channels; ++channel)
                        samples[frame * channels + channel] = 0.03f * std::sin(frame * 0.017 + channel) + 0.01f;
                const auto actual = spectrum.process(samples.data(), frames, channels, static_cast<float>(rate));
                for (int band = 0; band < 64; ++band) {
                    const double frequency = std::min(rate * 0.45, 45.0 * std::pow(2.0, band / 10.0));
                    double real = 0, imaginary = 0;
                    for (int frame = 0; frame < frames; ++frame) {
                        double mono = 0;
                        for (int channel = 0; channel < channels; ++channel) mono += samples[frame * channels + channel];
                        const double window = 0.5 - 0.5 * std::cos(6.283185307179586 * frame / std::max(1, frames - 1));
                        const double phase = 6.283185307179586 * frequency * frame / rate;
                        real += mono * window * std::cos(phase);
                        imaginary -= mono * window * std::sin(phase);
                    }
                    const double expected = std::min(1.0, 4.0 * std::hypot(real, imaginary) / frames);
                    const double error = std::abs(expected - actual[band]);
                    worst_error = std::max(worst_error, error);
                    if (!std::isfinite(actual[band]) || error > 1e-5) return 1;
                }
            }
        }
    }
    std::cout << "48 spectrum fixtures match the reference DFT; max error=" << worst_error << '\n';
}
