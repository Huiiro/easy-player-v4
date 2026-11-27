// Parametric EQ coefficient design, headroom estimation and per-channel biquad processing.

#include "dsp_pipeline.h"
#include <algorithm>
#include <cmath>
#include <utility>

bool DspPipeline::set_eq_bands(const std::array<EqBand, kEqBandCount>& bands) {
    eq_bands_ = bands;
    for (auto& band : eq_bands_) {
        band.frequency_hz = std::max(10.0f, std::min(40000.0f, band.frequency_hz));
        band.gain_db = std::max(-24.0f, std::min(24.0f, band.gain_db));
        band.q = std::max(0.1f, std::min(24.0f, band.q));
    }
    publish_eq_config();
    return true;
}

std::array<EqBand, kEqBandCount> DspPipeline::default_eq_bands() {
    constexpr std::array<float, kEqBandCount> frequencies = {
        20.0f, 31.5f, 50.0f, 80.0f, 125.0f, 200.0f, 315.0f, 500.0f,
        800.0f, 1250.0f, 2000.0f, 3150.0f, 5000.0f, 8000.0f, 10000.0f,
        12000.0f, 14000.0f, 16000.0f, 18000.0f, 20000.0f};
    std::array<EqBand, kEqBandCount> bands{};
    for (int i = 0; i < kEqBandCount; ++i) bands[i].frequency_hz = frequencies[i];
    return bands;
}

float DspPipeline::eq_peak_db(const EqConfig& config, int sample_rate) {
    if (!config.has_active_bands || sample_rate <= 0) return 0.0f;
    const double nyquist = sample_rate * 0.5;
    const double low = std::min(10.0, nyquist);
    double peak_db = 0.0;
    // A logarithmic grid resolves narrow low-frequency bands as well as
    // the closely spaced high-frequency bands. This runs off the callback.
    for (int point = 0; point <= 8192; ++point) {
        const double frequency = low * std::pow(nyquist / low, point / 8192.0);
        const double omega = 2.0 * 3.14159265358979323846 * frequency / sample_rate;
        const double real = std::cos(omega);
        const double imag = -std::sin(omega);
        const double real2 = std::cos(2.0 * omega);
        const double imag2 = -std::sin(2.0 * omega);
        double response_db = 0.0;
        for (const auto& c : config.coefficients) {
            if (c.b0 == 1.0f && c.b1 == 0.0f && c.b2 == 0.0f &&
                c.a1 == 0.0f && c.a2 == 0.0f) continue;
            const double numerator_real = c.b0 + c.b1 * real + c.b2 * real2;
            const double numerator_imag = c.b1 * imag + c.b2 * imag2;
            const double denominator_real = 1.0 + c.a1 * real + c.a2 * real2;
            const double denominator_imag = c.a1 * imag + c.a2 * imag2;
            const double numerator_power = numerator_real * numerator_real + numerator_imag * numerator_imag;
            const double denominator_power = denominator_real * denominator_real + denominator_imag * denominator_imag;
            if (numerator_power > 0.0 && denominator_power > 0.0) {
                response_db += 10.0 * std::log10(numerator_power / denominator_power);
            }
        }
        peak_db = std::max(peak_db, response_db);
    }
    return static_cast<float>(peak_db);
}

DspPipeline::BiquadCoefficients DspPipeline::make_peaking_filter(const EqBand& band, int sample_rate) {
    if (!band.enabled || std::abs(band.gain_db) < 0.0001f || sample_rate <= 0) return {};

    const float frequency = std::min(band.frequency_hz, sample_rate * 0.45f);
    const float omega = 2.0f * 3.14159265358979323846f * frequency / sample_rate;
    const float sine = std::sin(omega);
    const float alpha = sine / (2.0f * band.q);
    const float a = std::pow(10.0f, band.gain_db / 40.0f);
    const float a0 = 1.0f + alpha / a;

    BiquadCoefficients coeffs;
    coeffs.b0 = (1.0f + alpha * a) / a0;
    coeffs.b1 = (-2.0f * std::cos(omega)) / a0;
    coeffs.b2 = (1.0f - alpha * a) / a0;
    coeffs.a1 = (-2.0f * std::cos(omega)) / a0;
    coeffs.a2 = (1.0f - alpha / a) / a0;
    return coeffs;
}

void DspPipeline::publish_eq_config() {
    auto config = std::make_unique<EqConfig>();
    config->generation = eq_published_generation_.fetch_add(1, std::memory_order_acq_rel) + 1;
    // EQ runs after SRC, therefore its coefficients must use the rate of
    // the PCM actually delivered to the backend.
    const int sample_rate = backend_format_.sample_rate > 0 ? backend_format_.sample_rate :
                            (source_format_.sample_rate > 0 ? source_format_.sample_rate : 48000);
    for (int i = 0; i < kEqBandCount; ++i) {
        const auto& band = eq_bands_[i];
        config->coefficients[i] = make_peaking_filter(band, sample_rate);
        if (band.enabled && std::abs(band.gain_db) >= 0.0001f) {
            config->has_active_bands = true;
            ++config->active_band_count;
        }
    }
    config->peak_db = eq_peak_db(*config, sample_rate);
    // Leave a small margin for peaks between grid points and float rounding.
    config->headroom_gain = config->peak_db > 0.0001f
        ? std::pow(10.0f, -(config->peak_db + 0.25f) / 20.0f) : 1.0f;
    const EqConfig* raw = config.get();
    eq_retired_configs_.push_back(std::move(config));
    eq_config_.store(raw, std::memory_order_release);
}

void DspPipeline::process_eq(float* samples, int frames, int channels, const EqConfig* config) noexcept {
    if (config != eq_live_config_) {
        for (auto& band : eq_states_) {
            for (auto& state : band) state = {};
        }
        eq_live_config_ = config;
        eq_processed_generation_.store(config->generation, std::memory_order_release);
    }
    if (!config->has_active_bands) return;

    const int active_channels = std::min(channels, kMaxAudioChannels);
    for (int band = 0; band < kEqBandCount; ++band) {
        const auto& c = config->coefficients[band];
        for (int frame = 0; frame < frames; ++frame) {
            for (int channel = 0; channel < active_channels; ++channel) {
                const int index = frame * channels + channel;
                auto& state = eq_states_[band][channel];
                const float input = samples[index];
                const float output = c.b0 * input + state.z1;
                state.z1 = c.b1 * input - c.a1 * output + state.z2;
                state.z2 = c.b2 * input - c.a2 * output;
                samples[index] = output;
            }
        }
    }
}
