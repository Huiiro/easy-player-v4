#pragma once

#include <algorithm>
#include <array>
#include <cmath>

struct CrossfeedConfig {
    bool enabled = false;
    float strength = 0.5f;   // 0..1; maps to at most 35% opposite-channel low-frequency bleed
    float cutoff_hz = 700.0f;
    float delay_ms = 0.25f;
};

// A low-passed, optionally delayed difference signal is blended into the
// opposite channel. The common (mono) signal remains unchanged.
class CrossfeedProcessor {
public:
    void reset() noexcept {
        lowpass_state_ = 0.0f;
        delay_line_.fill(0.0f);
        write_index_ = 0;
        gain_live_ = 0.0f;
    }

    void process(float* samples, int frames, int channels, int sample_rate,
                 const CrossfeedConfig& config) noexcept {
        if (channels != 2 || frames <= 0 || sample_rate <= 0) return;
        const float target = config.enabled ? config.strength * 0.35f : 0.0f;
        if (target == 0.0f && gain_live_ == 0.0f) return;

        constexpr float kPi = 3.14159265358979323846f;
        const float alpha = 1.0f - std::exp(-2.0f * kPi * config.cutoff_hz / sample_rate);
        const int delay = std::clamp(static_cast<int>(std::lround(config.delay_ms * sample_rate / 1000.0f)),
                                     0, static_cast<int>(delay_line_.size()) - 1);
        const float gain_step = (target - gain_live_) / frames;
        for (int frame = 0; frame < frames; ++frame) {
            const float left = samples[2 * frame];
            const float right = samples[2 * frame + 1];
            lowpass_state_ += alpha * ((left - right) - lowpass_state_);
            delay_line_[write_index_] = lowpass_state_;
            const int read_index = (write_index_ + static_cast<int>(delay_line_.size()) - delay)
                                   % static_cast<int>(delay_line_.size());
            const float difference = delay_line_[read_index];
            write_index_ = (write_index_ + 1) % static_cast<int>(delay_line_.size());
            gain_live_ += gain_step;
            samples[2 * frame] = left - gain_live_ * difference;
            samples[2 * frame + 1] = right + gain_live_ * difference;
        }
        gain_live_ = target;
        if (target == 0.0f) reset();
    }

private:
    std::array<float, 1024> delay_line_{};
    float lowpass_state_ = 0.0f;
    float gain_live_ = 0.0f;
    int write_index_ = 0;
};
