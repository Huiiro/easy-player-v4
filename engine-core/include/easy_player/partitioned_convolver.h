#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <complex>
#include <cstddef>
#include <vector>

// Uniform partitioned overlap-add convolution. All storage and IR transforms
// are prepared before publication to the audio thread. Processing allocates
// nothing and has a fixed 512-frame latency.
class PartitionedConvolver {
public:
    static constexpr int kBlock = 512;
    static constexpr int kFft = kBlock * 2;

    PartitionedConvolver(const std::vector<float>& interleaved_ir, int ir_channels) {
        ir_channels_ = std::max(1, std::min(2, ir_channels));
        const int frames = static_cast<int>(interleaved_ir.size()) / ir_channels_;
        energy_gain_ = measure_energy_gain(interleaved_ir, ir_channels_, frames);
        partitions_ = std::max(1, (frames + kBlock - 1) / kBlock);
        states_.resize(2);
        for (int channel = 0; channel < 2; ++channel) {
            auto& state = states_[channel];
            state.ir.resize(partitions_, std::vector<Complex>(kFft));
            state.history.resize(partitions_, std::vector<Complex>(kFft));
            state.work.resize(kFft);
            state.sum.resize(kFft);
            for (int part = 0; part < partitions_; ++part) {
                auto& spectrum = state.ir[part];
                for (int sample = 0; sample < kBlock; ++sample) {
                    const int frame = part * kBlock + sample;
                    if (frame < frames) spectrum[sample] = interleaved_ir[frame * ir_channels_ + std::min(channel, ir_channels_ - 1)];
                }
                fft(spectrum, false);
            }
        }
    }

    float auto_gain() const noexcept { return 1.0f / std::max(1.0f, energy_gain_); }
    float auto_gain_db() const noexcept { return 20.0f * std::log10(auto_gain()); }

    void process(float* samples, int frames, int channels) noexcept {
        if (channels < 1 || channels > 2) return;
        for (int frame = 0; frame < frames; ++frame) {
            for (int channel = 0; channel < channels; ++channel) {
                auto& state = states_[channel];
                const int index = frame * channels + channel;
                const float input = samples[index];
                samples[index] = state.output[position_];
                state.input[position_] = input;
            }
            if (++position_ == kBlock) {
                process_block();
                position_ = 0;
            }
        }
    }

private:
    using Complex = std::complex<float>;
    struct State {
        std::vector<std::vector<Complex>> ir;
        std::vector<std::vector<Complex>> history;
        std::vector<Complex> work;
        std::vector<Complex> sum;
        std::array<float, kBlock> input{};
        std::array<float, kBlock> output{};
        std::array<float, kBlock> overlap{};
    };

    static void fft(std::vector<Complex>& values, bool inverse) noexcept {
        const int length_total = static_cast<int>(values.size());
        for (int i = 1, j = 0; i < length_total; ++i) {
            int bit = length_total >> 1;
            for (; j & bit; bit >>= 1) j ^= bit;
            j ^= bit;
            if (i < j) std::swap(values[i], values[j]);
        }
        for (int length = 2; length <= length_total; length <<= 1) {
            const float angle = (inverse ? 2.0f : -2.0f) * 3.14159265358979323846f / length;
            const Complex step(std::cos(angle), std::sin(angle));
            for (int start = 0; start < length_total; start += length) {
                Complex rotation(1.0f, 0.0f);
                for (int offset = 0; offset < length / 2; ++offset) {
                    const Complex even = values[start + offset];
                    const Complex odd = values[start + offset + length / 2] * rotation;
                    values[start + offset] = even + odd;
                    values[start + offset + length / 2] = even - odd;
                    rotation *= step;
                }
            }
        }
        if (inverse) for (auto& value : values) value /= static_cast<float>(length_total);
    }

    static float measure_energy_gain(const std::vector<float>& ir, int channels, int frames) {
        float peak = 0.0f;
        for (int channel = 0; channel < channels; ++channel) {
            double energy = 0.0;
            for (int frame = 0; frame < frames; ++frame) {
                const double sample = ir[frame * channels + channel];
                energy += sample * sample;
            }
            peak = std::max(peak, static_cast<float>(std::sqrt(energy)));
        }
        return peak;
    }

    void process_block() noexcept {
        for (auto& state : states_) {
            std::fill(state.work.begin(), state.work.end(), Complex{});
            for (int i = 0; i < kBlock; ++i) state.work[i] = state.input[i];
            fft(state.work, false);
            std::copy(state.work.begin(), state.work.end(), state.history[history_head_].begin());
            std::fill(state.sum.begin(), state.sum.end(), Complex{});
            for (int part = 0; part < partitions_; ++part) {
                const auto& input = state.history[(history_head_ - part + partitions_) % partitions_];
                const auto& filter = state.ir[part];
                for (int bin = 0; bin < kFft; ++bin) state.sum[bin] += input[bin] * filter[bin];
            }
            fft(state.sum, true);
            for (int i = 0; i < kBlock; ++i) {
                state.output[i] = state.sum[i].real() + state.overlap[i];
                state.overlap[i] = state.sum[i + kBlock].real();
            }
        }
        history_head_ = (history_head_ + 1) % partitions_;
    }

    int ir_channels_ = 1;
    int partitions_ = 1;
    int position_ = 0;
    int history_head_ = 0;
    float energy_gain_ = 1.0f;
    std::vector<State> states_;
};
