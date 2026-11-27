// Spectrum, beat and loudness analysis on a separate worker.
// This worker consumes the PCM taps and publishes snapshots for polling.

#include "audio_engine.h"
#include "eq_spectrum_analysis.h"
#include "logger.h"
#include "spectrum_analysis.h"
#include <algorithm>
#include <array>
#include <chrono>
#include <cmath>
#include <deque>
#include <utility>
#include <vector>

namespace {
    float lufs_from_energy(double energy) {
        if (energy <= 1.0e-12) return -70.0f;
        return static_cast<float>(std::max(-70.0, -0.691 + 10.0 * std::log10(energy)));
    }
} // namespace

AudioAnalysisSnapshot AudioEngine::audio_analysis_snapshot(bool include_spectrum, bool include_eq_spectrum) const {
    const int rate = pcm_output_sample_rate_.load(std::memory_order_acquire);
    AudioAnalysisSnapshot snapshot{};
    snapshot.output_time_ms = rate > 0 ? analysis_output_frames_.load(std::memory_order_acquire) * 1000.0 / rate : 0.0;
    snapshot.rms = analysis_rms_.load(std::memory_order_acquire);
    snapshot.low_energy = analysis_low_energy_.load(std::memory_order_acquire);
    snapshot.onset_strength = analysis_onset_strength_.load(std::memory_order_acquire);
    snapshot.dropped_frames = analysis_dropped_frames_.load(std::memory_order_acquire);
    snapshot.glitch_count = glitch_count();
    snapshot.clip_guard_limited_frames = dsp_pipeline_.clip_guard_limited_frames();
    snapshot.clip_guard_reduction_db = dsp_pipeline_.clip_guard_reduction_db();
    if (rate > 0) {
        snapshot.analysis_time_ms = analysis_processed_frames_.load(std::memory_order_acquire) * 1000.0 / rate;
        snapshot.analysis_latency_ms = std::max(0.0, snapshot.output_time_ms - snapshot.analysis_time_ms);
    }
    snapshot.beat_sequence = analysis_beat_sequence_.load(std::memory_order_acquire);
    snapshot.bpm = analysis_bpm_.load(std::memory_order_acquire);
    snapshot.momentary_lufs = lufs_from_energy(analysis_momentary_energy_.load(std::memory_order_acquire));
    snapshot.short_term_lufs = lufs_from_energy(analysis_short_term_energy_.load(std::memory_order_acquire));
    snapshot.integrated_lufs = analysis_integrated_lufs_.load(std::memory_order_acquire);
    if (include_spectrum) {
        for (size_t i = 0; i < snapshot.spectrum.size(); ++i)
            snapshot.spectrum[i] = analysis_spectrum_[i].load(std::memory_order_acquire);
    }
    if (include_eq_spectrum && is_playing() && !playback_only_.load(std::memory_order_acquire)) {
        std::lock_guard<std::mutex> lock(eq_spectrum_mutex_);
        if (eq_spectrum_reset_generation_ == analysis_reset_generation_.load(std::memory_order_acquire))
            snapshot.eq_spectrum = eq_spectrum_;
    }
    return snapshot;
}

void AudioEngine::set_eq_spectrum_analysis_enabled(bool enabled) {
    std::lock_guard<std::mutex> lock(eq_spectrum_mutex_);
    const uint64_t request = eq_spectrum_request_.load(std::memory_order_relaxed);
    if (static_cast<bool>(request & 1) == enabled) return;
    eq_spectrum_.reset();
    eq_spectrum_request_.store(request + 1, std::memory_order_release);
}

void AudioEngine::stop_analysis_thread() {
    {
        std::lock_guard<std::mutex> lock(analysis_wait_mutex_);
        analysis_running_.store(false, std::memory_order_release);
    }
    analysis_cv_.notify_one();
    if (analysis_thread_ && analysis_thread_->joinable()) analysis_thread_->join();
    analysis_thread_.reset();
}

void AudioEngine::analysis_thread_func() {
    // The visualizer currently polls at 20 Hz. Keep some margin for callback
    // jitter while avoiding a spectrum transform for every output block.
    constexpr int spectrum_updates_per_second = 30;
    SpectrumAnalysis spectrum;
    std::unique_ptr<EqSpectrumAnalysis> eq_spectrum;
    uint64_t eq_request = 0;
    struct Biquad {
        float b0 = 1.0f, b1 = 0.0f, b2 = 0.0f, a1 = 0.0f, a2 = 0.0f, z1 = 0.0f, z2 = 0.0f;
        float process(float input) { const float output = b0 * input + z1; z1 = b1 * input - a1 * output + z2; z2 = b2 * input - a2 * output; return output; }
    };
    struct LoudnessChannel {
        Biquad shelf, highpass;
        float weight = 1.0f;
    };
    float previous_rms = 0.0f;
    float lowpass = 0.0f;
    float onset_average = 0.002f;
    uint64_t consumed_frames = 0, last_beat_frame = 0;
    uint64_t next_spectrum_frame = 0;
    uint64_t reset_generation = analysis_reset_generation_.load(std::memory_order_acquire);
    int loudness_channels = 0;
    float loudness_rate = 0.0f;
    std::vector<LoudnessChannel> loudness_filters;
    std::deque<std::pair<int, double>> momentary_window, short_term_window;
    // Keep the relative gate's history in fixed 0.1 LU bins to bound memory.
    // The absolute gate only needs a running energy sum and block count.
    static constexpr size_t kIntegratedLufsBins = 701;
    std::array<double, kIntegratedLufsBins> integrated_energy_bins{};
    std::array<uint64_t, kIntegratedLufsBins> integrated_block_counts{};
    double momentary_energy = 0.0, short_term_energy = 0.0, integrated_energy = 0.0;
    double absolute_gate_energy = 0.0;
    uint64_t absolute_gate_count = 0;
    int momentary_frames = 0, short_term_frames = 0, integrated_frames = 0;
    uint64_t loudness_log_frames = 0;
    bool loudness_enabled = false;
    auto drain_eq_monitor = [&] {
        if (eq_monitor_ring_buffer_ && !analysis_work_buffer_.empty()) {
            while (eq_monitor_ring_buffer_->frames_available() > 0)
                eq_monitor_ring_buffer_->read(analysis_work_buffer_.data(), 1024);
        }
    };
    auto configure_loudness = [&](int channels, float rate) {
        loudness_channels = channels; loudness_rate = rate;
        loudness_filters.assign(channels, {});
        const float shelf_a = std::pow(10.0f, 4.0f / 40.0f), shelf_w = 6.28318530718f * 1681.97445f / rate;
        const float shelf_alpha = std::sin(shelf_w) / (2.0f * 0.707175f), shelf_beta = 2.0f * std::sqrt(shelf_a) * shelf_alpha;
        const float shelf_cos = std::cos(shelf_w), shelf_a0 = (shelf_a + 1.0f) - (shelf_a - 1.0f) * shelf_cos + shelf_beta;
        const float hp_w = 6.28318530718f * 38.13547f / rate, hp_cos = std::cos(hp_w), hp_alpha = std::sin(hp_w) / (2.0f * 0.500327f);
        const float hp_a0 = 1.0f + hp_alpha;
        for (int channel = 0; channel < channels; ++channel) {
            auto& filter = loudness_filters[channel];
            if (channels > 3 && channel == 3) {
                filter.weight = 0.0f; // LFE
                continue;
            }
            if (channel >= 4) filter.weight = 1.41421356f;
            auto& shelf = filter.shelf;
            shelf.b0 = shelf_a * ((shelf_a + 1.0f) + (shelf_a - 1.0f) * shelf_cos + shelf_beta) / shelf_a0;
            shelf.b1 = -2.0f * shelf_a * ((shelf_a - 1.0f) + (shelf_a + 1.0f) * shelf_cos) / shelf_a0;
            shelf.b2 = shelf_a * ((shelf_a + 1.0f) + (shelf_a - 1.0f) * shelf_cos - shelf_beta) / shelf_a0;
            // RBJ high-shelf denominator: the sign between these terms is
            // essential. A '+' makes one pole leave the unit circle and the
            // energy accumulator reaches infinity within milliseconds.
            shelf.a1 = 2.0f * ((shelf_a - 1.0f) - (shelf_a + 1.0f) * shelf_cos) / shelf_a0;
            shelf.a2 = ((shelf_a + 1.0f) - (shelf_a - 1.0f) * shelf_cos - shelf_beta) / shelf_a0;
            auto& highpass = filter.highpass;
            highpass.b0 = (1.0f + hp_cos) * 0.5f / hp_a0; highpass.b1 = -(1.0f + hp_cos) / hp_a0; highpass.b2 = highpass.b0;
            highpass.a1 = -2.0f * hp_cos / hp_a0; highpass.a2 = (1.0f - hp_alpha) / hp_a0;
        }
    };
    auto reset_loudness = [&] {
        momentary_window.clear(); short_term_window.clear();
        integrated_energy_bins.fill(0.0); integrated_block_counts.fill(0);
        momentary_energy = short_term_energy = integrated_energy = 0.0;
        absolute_gate_energy = 0.0;
        absolute_gate_count = 0;
        momentary_frames = short_term_frames = integrated_frames = 0;
        loudness_channels = 0; loudness_rate = 0.0f;
    };
    while (analysis_running_.load(std::memory_order_acquire)) {
        // Only the consumer drains this SPSC ring. Never reset it from the UI
        // thread while an audio callback may still be writing its last block.
        if (!analysis_enabled_.load(std::memory_order_acquire) ||
            playback_only_.load(std::memory_order_acquire)) {
            next_spectrum_frame = 0;
            eq_spectrum.reset();
            drain_eq_monitor();
            if (analysis_ring_buffer_ && !analysis_work_buffer_.empty()) {
                while (analysis_ring_buffer_->read(analysis_work_buffer_.data(), 1024) > 0) {}
            }
            std::unique_lock<std::mutex> lock(analysis_wait_mutex_);
            analysis_cv_.wait(lock, [this] {
                return !analysis_running_.load(std::memory_order_acquire) ||
                    (analysis_enabled_.load(std::memory_order_acquire) &&
                     !playback_only_.load(std::memory_order_acquire));
            });
            continue;
        }
        if (!analysis_ring_buffer_ || analysis_work_buffer_.empty()) { std::this_thread::sleep_for(std::chrono::milliseconds(10)); continue; }
        const int frames = analysis_ring_buffer_->read(analysis_work_buffer_.data(), 1024);
        if (frames == 0) { std::this_thread::sleep_for(std::chrono::milliseconds(10)); continue; }
        // The tap carries final output PCM in FIFO order. Remaining queued
        // frames let us tag the processed analysis frame on the output clock.
        const uint64_t produced = analysis_output_frames_.load(std::memory_order_acquire);
        const uint64_t queued = static_cast<uint64_t>(std::max(0, analysis_ring_buffer_->frames_available()));
        analysis_processed_frames_.store(produced > queued ? produced - queued : 0, std::memory_order_release);
        const uint64_t requested_reset = analysis_reset_generation_.load(std::memory_order_acquire);
        if (requested_reset != reset_generation) {
            previous_rms = 0.0f;
            lowpass = 0.0f;
            onset_average = 0.002f;
            consumed_frames = 0;
            last_beat_frame = 0;
            next_spectrum_frame = 0;
            eq_spectrum.reset();
            drain_eq_monitor();
            reset_loudness();
            reset_generation = requested_reset;
            continue;
        }
        const int channels = std::max(1, static_cast<int>(analysis_work_buffer_.size() / 1024));
        const float sample_rate = backend_ ? static_cast<float>(backend_->current_format().sample_rate) : 48000.0f;
        const bool requested_loudness = loudness_analysis_enabled_.load(std::memory_order_acquire);
        if (requested_loudness != loudness_enabled) {
            reset_loudness();
            loudness_enabled = requested_loudness;
            analysis_momentary_energy_.store(0.0, std::memory_order_release);
            analysis_short_term_energy_.store(0.0, std::memory_order_release);
            analysis_integrated_lufs_.store(-70.0f, std::memory_order_release);
        }
        if (loudness_enabled && (channels != loudness_channels || std::abs(sample_rate - loudness_rate) > 0.5f)) configure_loudness(channels, sample_rate);
        double square_sum = 0.0, low_square_sum = 0.0, weighted_square_sum = 0.0;
        for (int frame = 0; frame < frames; ++frame) {
            float mono = 0.0f; for (int channel = 0; channel < channels; ++channel) mono += analysis_work_buffer_[frame * channels + channel];
            mono /= channels; lowpass = 0.94f * lowpass + 0.06f * mono;
            square_sum += mono * mono; low_square_sum += lowpass * lowpass;
            if (loudness_enabled) {
                for (int channel = 0; channel < channels; ++channel) {
                    auto& filter = loudness_filters[channel];
                    if (filter.weight == 0.0f) continue;
                    const float input = analysis_work_buffer_[frame * channels + channel];
                    float filtered = filter.highpass.process(filter.shelf.process(input));
                    // A malformed source sample must not poison a persistent IIR
                    // state and make the public loudness meter permanently NaN.
                    if (!std::isfinite(filtered)) {
                        filter.shelf.z1 = filter.shelf.z2 = 0.0f;
                        filter.highpass.z1 = filter.highpass.z2 = 0.0f;
                        filtered = std::isfinite(input) ? input : 0.0f;
                    }
                    weighted_square_sum += filter.weight * filtered * filtered;
                }
            }
        }
        // Preserve a usable output meter if a non-standard multichannel layout
        // exposes only an LFE lane. Normal stereo/multichannel input uses the
        // K-weighted value above.
        const float rms = std::sqrt(static_cast<float>(square_sum / frames));
        analysis_rms_.store(rms, std::memory_order_release);
        analysis_low_energy_.store(std::sqrt(static_cast<float>(low_square_sum / frames)), std::memory_order_release);
        const float onset = std::max(0.0f, rms - previous_rms);
        analysis_onset_strength_.store(onset, std::memory_order_release);
        if (loudness_enabled) {
            if (weighted_square_sum <= 0.0 && square_sum > 0.0) weighted_square_sum = square_sum;
            momentary_window.emplace_back(frames, weighted_square_sum); momentary_energy += weighted_square_sum; momentary_frames += frames;
            short_term_window.emplace_back(frames, weighted_square_sum); short_term_energy += weighted_square_sum; short_term_frames += frames;
            const int momentary_limit = std::max(1, static_cast<int>(sample_rate * 0.4f)), short_term_limit = std::max(1, static_cast<int>(sample_rate * 3.0f));
            while (momentary_frames > momentary_limit && !momentary_window.empty()) { momentary_frames -= momentary_window.front().first; momentary_energy -= momentary_window.front().second; momentary_window.pop_front(); }
            while (short_term_frames > short_term_limit && !short_term_window.empty()) { short_term_frames -= short_term_window.front().first; short_term_energy -= short_term_window.front().second; short_term_window.pop_front(); }
            const double momentary_mean = momentary_energy / std::max(1, momentary_frames);
            const double short_term_mean = short_term_energy / std::max(1, short_term_frames);
            analysis_momentary_energy_.store(momentary_mean, std::memory_order_release);
            analysis_short_term_energy_.store(short_term_mean, std::memory_order_release);
            loudness_log_frames += frames;
            if (loudness_log_frames >= static_cast<uint64_t>(sample_rate * 2.0f)) {
                loudness_log_frames = 0;
                LOG_DEBUG("Loudness analysis: energy=" + std::to_string(weighted_square_sum / frames) +
                         ", M=" + std::to_string(lufs_from_energy(momentary_mean)) +
                         ", S=" + std::to_string(lufs_from_energy(short_term_mean)) +
                         ", rate=" + std::to_string(sample_rate) + ", channels=" + std::to_string(channels) +
                         ", processed_frames=" + std::to_string(analysis_processed_frames_.load(std::memory_order_relaxed)) +
                         ", dropped_frames=" + std::to_string(analysis_dropped_frames_.load(std::memory_order_relaxed)));
            }
            integrated_energy += weighted_square_sum; integrated_frames += frames;
            if (integrated_frames >= momentary_limit) {
                const double block_energy = integrated_energy / integrated_frames;
                const float block_lufs = lufs_from_energy(block_energy);
                if (block_lufs > -70.0f) {
                    const auto bin = static_cast<size_t>(std::clamp(
                        std::lround((std::clamp(block_lufs, -70.0f, 0.0f) + 70.0f) * 10.0f),
                        0l,
                        static_cast<long>(kIntegratedLufsBins - 1)));
                    integrated_energy_bins[bin] += block_energy;
                    ++integrated_block_counts[bin];
                    absolute_gate_energy += block_energy;
                    ++absolute_gate_count;
                    const float ungated = lufs_from_energy(absolute_gate_energy / absolute_gate_count);
                    double gated_sum = 0.0;
                    uint64_t gated_count = 0;
                    for (size_t index = 0; index < kIntegratedLufsBins; ++index) {
                        const float bin_lufs = -70.0f + static_cast<float>(index) / 10.0f;
                        if (bin_lufs > ungated - 10.0f) {
                            gated_sum += integrated_energy_bins[index];
                            gated_count += integrated_block_counts[index];
                        }
                    }
                    analysis_integrated_lufs_.store(
                        lufs_from_energy(gated_sum / std::max<uint64_t>(1, gated_count)),
                        std::memory_order_release);
                }
                integrated_energy = 0.0; integrated_frames = 0;
            }
        }
        const uint64_t minimum_interval = static_cast<uint64_t>(sample_rate * 0.18f);
        if (onset > std::max(0.003f, onset_average * 1.8f) && (last_beat_frame == 0 || consumed_frames - last_beat_frame >= minimum_interval)) {
            if (last_beat_frame != 0) {
                const float instant_bpm = 60.0f * sample_rate / static_cast<float>(consumed_frames - last_beat_frame);
                if (instant_bpm >= 55.0f && instant_bpm <= 220.0f) {
                    const float prior = analysis_bpm_.load(std::memory_order_relaxed);
                    analysis_bpm_.store(prior > 0.0f ? prior * 0.8f + instant_bpm * 0.2f : instant_bpm, std::memory_order_release);
                }
            }
            last_beat_frame = consumed_frames;
            analysis_beat_sequence_.fetch_add(1, std::memory_order_release);
        }
        onset_average = onset_average * 0.94f + onset * 0.06f;
        const uint64_t block_end = consumed_frames + frames;
        if (!spectrum_analysis_enabled_.load(std::memory_order_acquire)) {
            next_spectrum_frame = 0;
        } else if (block_end >= next_spectrum_frame) {
            const auto magnitudes = spectrum.process(analysis_work_buffer_.data(), frames, channels, sample_rate);
            for (size_t band = 0; band < magnitudes.size(); ++band) {
                analysis_spectrum_[band].store(magnitudes[band], std::memory_order_release);
            }
            const auto interval = static_cast<uint64_t>(std::max(1, static_cast<int>(sample_rate) / spectrum_updates_per_second));
            next_spectrum_frame = next_spectrum_frame == 0
                ? block_end + interval
                : std::max(next_spectrum_frame + interval, block_end + 1);
        }
        previous_rms = 0.85f * previous_rms + 0.15f * rms;
        consumed_frames = block_end;

        // Reuse the scratch buffer after the final-output meters are done.
        const auto requested_eq = eq_spectrum_request_.load(std::memory_order_acquire);
        if (requested_eq != eq_request) {
            if (eq_request & 1) drain_eq_monitor();
            eq_spectrum.reset();
            eq_request = requested_eq;
        }
        if (!(requested_eq & 1) || !is_playing() || sample_rate <= 0 || !eq_monitor_ring_buffer_) {
            if (eq_spectrum) {
                eq_spectrum.reset();
                drain_eq_monitor();
            }
            continue;
        }
        if (eq_monitor_ring_buffer_->frames_available() == 0) continue;
        if (!eq_spectrum) eq_spectrum = std::make_unique<EqSpectrumAnalysis>(static_cast<int>(sample_rate), channels);
        const int monitor_frames = eq_monitor_ring_buffer_->read(analysis_work_buffer_.data(), 1024);
        if (eq_spectrum->add(analysis_work_buffer_.data(), monitor_frames)) {
            const auto levels = eq_spectrum->levels();
            std::lock_guard<std::mutex> lock(eq_spectrum_mutex_);
            if (requested_eq == eq_spectrum_request_.load(std::memory_order_acquire)) {
                eq_spectrum_ = levels;
                eq_spectrum_reset_generation_ = requested_reset;
            }
        }
    }
}
