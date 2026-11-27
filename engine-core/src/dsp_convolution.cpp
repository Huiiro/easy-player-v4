// Impulse response preparation and publication of partitioned convolution state.
// Reader tracking defers reclamation until the render callback releases the previous runtime.

#include "dsp_pipeline.h"
#include <algorithm>
#include <cmath>
#include <utility>

bool DspPipeline::set_impulse_response(const std::vector<float>& samples, int sample_rate, int channels, bool enabled) {
    if (enabled && (samples.empty() || sample_rate <= 0 || channels < 1 || channels > 2 ||
                    samples.size() % static_cast<size_t>(channels) != 0)) return false;
    auto previous_source = std::move(ir_source_);
    const int previous_rate = ir_source_rate_;
    const int previous_channels = ir_source_channels_;
    const bool previous_enabled = ir_enabled_.load(std::memory_order_acquire);
    auto* previous_runtime = ir_runtime_.load();
    const float previous_auto_db = ir_auto_preamp_db_.load(std::memory_order_acquire);
    ir_source_ = samples;
    ir_source_rate_ = sample_rate;
    ir_source_channels_ = channels;
    ir_enabled_.store(enabled, std::memory_order_release);
    if (publish_ir_runtime()) return true;
    ir_source_ = std::move(previous_source);
    ir_source_rate_ = previous_rate;
    ir_source_channels_ = previous_channels;
    ir_runtime_.store(previous_runtime);
    ir_auto_preamp_db_.store(previous_auto_db, std::memory_order_release);
    ir_enabled_.store(previous_enabled, std::memory_order_release);
    return false;
}

bool DspPipeline::set_ir_gain(bool automatic, float gain_db) {
    if (!std::isfinite(gain_db) || gain_db < -24.0f || gain_db > 12.0f) return false;
    ir_manual_gain_.store(std::pow(10.0f, gain_db / 20.0f), std::memory_order_release);
    ir_auto_gain_.store(automatic, std::memory_order_release);
    return true;
}

bool DspPipeline::publish_ir_runtime() {
    if (!ir_enabled_.load(std::memory_order_acquire) || ir_source_.empty()) {
        ir_runtime_.store(nullptr);
        ir_auto_preamp_db_.store(0.0f, std::memory_order_release);
        reclaim_ir_runtimes();
        return true;
    }
    const int target_rate = backend_format_.sample_rate > 0 ? backend_format_.sample_rate : ir_source_rate_;
    std::vector<float> samples = ir_source_;
    constexpr int kMaxOutputIrFrames = 262144;
    const auto fail = [this]() {
        ir_runtime_.store(nullptr);
        ir_auto_preamp_db_.store(0.0f, std::memory_order_release);
        return false;
    };
    // Tiny preset filters are defined in samples and should retain their
    // taps; sinc resamplers need much more input to produce any output.
    if (target_rate != ir_source_rate_ && ir_source_.size() / ir_source_channels_ > 32) {
        const int source_frames = static_cast<int>(ir_source_.size()) / ir_source_channels_;
        const int target_frames = static_cast<int>(std::ceil(static_cast<double>(source_frames) * target_rate / ir_source_rate_)) + 64;
        if (target_frames > kMaxOutputIrFrames) return fail();
        samples.assign(static_cast<size_t>(target_frames) * ir_source_channels_, 0.0f);
        SRC_DATA data{};
        data.data_in = ir_source_.data();
        data.input_frames = source_frames;
        data.data_out = samples.data();
        data.output_frames = target_frames;
        data.src_ratio = static_cast<double>(target_rate) / ir_source_rate_;
        data.end_of_input = 1;
        if (src_simple(&data, SRC_SINC_BEST_QUALITY, ir_source_channels_) != 0 || data.output_frames_gen <= 0) {
            return fail();
        }
        samples.resize(static_cast<size_t>(data.output_frames_gen) * ir_source_channels_);
        const float gain = static_cast<float>(1.0 / data.src_ratio);
        for (auto& sample : samples) sample *= gain;
    }
    if (samples.size() / ir_source_channels_ > kMaxOutputIrFrames) return fail();
    auto owned = std::make_unique<PartitionedConvolver>(samples, ir_source_channels_);
    auto* raw = owned.get();
    ir_retired_runtimes_.push_back(std::move(owned));
    ir_runtime_.store(raw);
    ir_auto_preamp_db_.store(raw->auto_gain_db(), std::memory_order_release);
    reclaim_ir_runtimes();
    return true;
}

void DspPipeline::reclaim_ir_runtimes() {
    if (ir_readers_.load() != 0) return;
    const auto* active = ir_runtime_.load();
    ir_retired_runtimes_.erase(
        std::remove_if(ir_retired_runtimes_.begin(), ir_retired_runtimes_.end(),
                       [active](const auto& runtime) { return runtime.get() != active; }),
        ir_retired_runtimes_.end());
}
