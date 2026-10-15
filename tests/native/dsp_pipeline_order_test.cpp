#include "easy_player/dsp_pipeline.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdio>
#include <thread>
#include <vector>

namespace {
std::vector<DspNodeConfig> with_limiter_before_preamp(DspPipeline& pipeline) {
    auto nodes = pipeline.dsp_nodes();
    const auto it = std::find_if(nodes.begin(), nodes.end(), [](const auto& node) {
        return node.id == "limiter";
    });
    const auto limiter = *it;
    nodes.erase(it);
    nodes.insert(nodes.begin() + 2, limiter);
    return nodes;
}

float run_gain_order(bool limiter_first) {
    DspPipeline pipeline;
    pipeline.configure({48000, 16, 2}, {48000, 16, 2}, BackendType::WASAPI_EXCLUSIVE, 4096);
    pipeline.set_preamp_db(6.0f, true);
    pipeline.set_limiter_enabled(true);
    pipeline.set_limiter_config({-6.0f, 80.0f});
    if (limiter_first && !pipeline.set_dsp_nodes(with_limiter_before_preamp(pipeline))) return -1.0f;
    const float input[] = {0.8f, 0.8f};
    float output[] = {0.0f, 0.0f};
    pipeline.process(input, 1, 2, false, output, 1, 2);
    return output[1];
}

std::vector<float> run_reverb(bool delay_enabled, bool delay_first) {
    constexpr int frames = 4096;
    DspPipeline pipeline;
    pipeline.configure({48000, 16, 2}, {48000, 16, 2}, BackendType::WASAPI_EXCLUSIVE, frames);
    pipeline.set_delay_config({250.0f, 0.0f, 0.0f});
    pipeline.set_reverb_config({0.5f, 0.4f, 0.5f});
    auto nodes = pipeline.dsp_nodes();
    for (auto& node : nodes) {
        if (node.id == "delay") node.enabled = delay_enabled;
        if (node.id == "reverb") node.enabled = true;
    }
    if (!delay_first) {
        const auto delay = std::find_if(nodes.begin(), nodes.end(), [](const auto& node) { return node.id == "delay"; });
        const auto reverb = std::find_if(nodes.begin(), nodes.end(), [](const auto& node) { return node.id == "reverb"; });
        std::iter_swap(delay, reverb);
    }
    if (!pipeline.set_dsp_nodes(nodes)) return {};
    std::vector<float> input(frames * 2, 0.0f);
    std::vector<float> output(frames * 2, 0.0f);
    input[0] = input[1] = 1.0f;
    pipeline.process(input.data(), frames, 2, false, output.data(), frames, 2);
    return output;
}
}

int main() {
    const float normal = run_gain_order(false);
    const float reordered = run_gain_order(true);
    if (!(normal > 0.49f && normal < 0.52f && reordered > 0.95f)) {
        std::fprintf(stderr, "gain order: normal=%f reordered=%f\n", normal, reordered);
        return 1;
    }

    const auto reverb_only = run_reverb(false, true);
    const auto delay_then_reverb = run_reverb(true, true);
    const auto reverb_then_delay = run_reverb(true, false);
    if (reverb_only.empty() || delay_then_reverb.size() != reverb_only.size() ||
        reverb_then_delay.size() != reverb_only.size()) return 2;
    bool has_tail = false;
    for (size_t i = 2; i < reverb_only.size(); ++i) {
        has_tail |= std::abs(reverb_only[i]) > 0.0001f;
        if (std::abs(reverb_only[i] - delay_then_reverb[i]) > 0.00001f ||
            std::abs(reverb_only[i] - reverb_then_delay[i]) > 0.00001f) return 3;
    }
    if (!has_tail) return 4;

    DspPipeline pipeline;
    pipeline.set_preamp_db(3.0f, true);
    pipeline.set_limiter_enabled(true);
    const auto normal_order = pipeline.dsp_nodes();
    const auto reversed_order = with_limiter_before_preamp(pipeline);
    std::atomic<bool> done{false};
    std::thread writer([&] {
        for (int i = 0; i < 1000; ++i)
            pipeline.set_dsp_nodes(i % 2 ? normal_order : reversed_order);
        done.store(true);
    });
    bool valid = true;
    do {
        const auto status = pipeline.status();
        valid &= std::count(status.active_nodes.begin(), status.active_nodes.end(), "Preamp") == 1;
        valid &= std::count(status.active_nodes.begin(), status.active_nodes.end(), "Limiter") == 1;
    } while (!done.load());
    writer.join();
    return valid ? 0 : 5;
}
