#pragma once

#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <vector>

extern "C" {
#include <libavutil/tx.h>
}

// Logarithmic levels from 20 Hz to 20 kHz, inclusive. Each point is
// the peak across channels and nearby FFT bins, in dBFS.
class EqSpectrumAnalysis {
public:
    static constexpr size_t point_count = 128;
    static constexpr float floor_db = -96.0f;
    using Levels = std::array<float, point_count>;

    EqSpectrumAnalysis(int rate, int channels)
        : frames_(window_frames(rate)), channels_(channels), hop_(std::max(1, rate / 30)),
          pcm_(static_cast<size_t>(frames_) * channels), input_(frames_), window_(frames_),
          output_(frames_ / 2 + 1), power_(output_.size()) {
        double window_sum = 0;
        for (int i = 0; i < frames_; ++i) {
            window_[i] = static_cast<float>(0.5 - 0.5 * std::cos(6.283185307179586 * i / frames_));
            window_sum += window_[i];
        }
        const float scale = static_cast<float>(2.0 / window_sum);
        av_tx_init(&transform_, &run_, AV_TX_FLOAT_RDFT, 0, frames_, &scale, AV_TX_UNALIGNED);
        const double step = std::log(1000.0) / (point_count - 1);
        const double half_band = std::exp(0.5 * step);
        for (size_t index = 0; index < point_count; ++index) {
            auto& band = bands_[index];
            const double bin = 20.0 * std::exp(step * index) * frames_ / rate;
            if (bin > frames_ / 2) continue;
            band.center = bin;
            band.first = std::max(1, static_cast<int>(std::ceil(bin / half_band)));
            band.last = std::min(frames_ / 2, static_cast<int>(std::floor(bin * half_band)));
        }
    }

    ~EqSpectrumAnalysis() { av_tx_uninit(&transform_); }
    EqSpectrumAnalysis(const EqSpectrumAnalysis&) = delete;
    EqSpectrumAnalysis& operator=(const EqSpectrumAnalysis&) = delete;

    // Keep a rolling window on the analysis thread, even when the audio
    // backend delivers far fewer samples per callback than the FFT needs.
    bool add(const float* samples, int frames) {
        if (!transform_ || frames <= 0) return false;
        received_ += frames;
        if (frames > frames_) {
            samples += static_cast<size_t>(frames - frames_) * channels_;
            frames = frames_;
        }
        const int first = std::min(frames, frames_ - write_at_);
        std::copy_n(samples, first * channels_, pcm_.data() + write_at_ * channels_);
        std::copy_n(samples + first * channels_, (frames - first) * channels_, pcm_.data());
        write_at_ = (write_at_ + frames) % frames_;
        if (received_ < next_update_ || received_ < frames_) return false;
        next_update_ = next_update_ == 0 ? received_ + hop_ : std::max(next_update_ + hop_, received_ + 1);
        return true;
    }

    Levels levels() {
        std::fill(power_.begin(), power_.end(), 0.0f);
        for (int channel = 0; channel < channels_; ++channel) {
            int at = write_at_;
            for (int i = 0; i < frames_; ++i) {
                const float sample = pcm_[at * channels_ + channel];
                input_[i] = std::isfinite(sample) ? sample * window_[i] : 0.0f;
                if (++at == frames_) at = 0;
            }
            run_(transform_, output_.data(), input_.data(), sizeof(float));
            for (size_t i = 1; i < output_.size(); ++i) {
                const auto [re, im] = output_[i];
                power_[i] = std::max(power_[i], re * re + im * im);
            }
        }
        Levels result;
        result.fill(floor_db);
        for (size_t index = 0; index < result.size(); ++index) {
            const auto& band = bands_[index];
            if (band.center == 0) continue;
            float peak;
            if (band.first <= band.last) {
                peak = *std::max_element(power_.begin() + band.first, power_.begin() + band.last + 1);
            } else {
                const auto lower = static_cast<size_t>(band.center);
                const auto upper = std::min(lower + 1, power_.size() - 1);
                peak = power_[lower] + static_cast<float>(band.center - lower) * (power_[upper] - power_[lower]);
            }
            if (peak > 0.0f) result[index] = std::clamp(10.0f * std::log10(peak), floor_db, 0.0f);
        }
        return result;
    }

private:
    static int window_frames(int rate) {
        int frames = 4096;
        while (frames < 32768 && rate > frames / 4096 * 48000) frames *= 2;
        return frames;
    }

    struct Band {
        double center = 0;
        int first = 0, last = 0;
    };
    int frames_, channels_, hop_, write_at_ = 0;
    int64_t received_ = 0, next_update_ = 0;
    std::vector<float> pcm_, input_, window_;
    std::vector<AVComplexFloat> output_;
    std::vector<float> power_;
    std::array<Band, point_count> bands_{};
    AVTXContext* transform_ = nullptr;
    av_tx_fn run_ = nullptr;
};
