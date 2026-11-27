#include "easy_player/dsp_pipeline.h"
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <vector>

#define CHECK(x) do { if (!(x)) throw std::runtime_error(#x); } while (0)

static void run(DspPipeline& pipeline, int source_rate, int output_rate, int total, int block, float speed) {
    pipeline.configure({source_rate, 16, 2}, {output_rate, 16, 2}, BackendType::ASIO, block);
    CHECK(pipeline.set_playback_speed_config({true, speed}));
    std::vector<float> input(total * 2, 0.1f), output(block * 2);
    int consumed = 0, generated = 0;
    double energy = 0;
    bool drained = false;
    for (int callback = 0; callback < 20000 && !drained; ++callback) {
        const int supplied = std::min(total - consumed, pipeline.required_input_frames(block));
        const auto result = pipeline.process(input.data() + consumed * 2, supplied, 2,
            consumed + supplied == total, output.data(), block, 2);
        CHECK(result.input_frames_used >= 0 && result.input_frames_used <= supplied);
        CHECK(result.output_frames_generated >= 0 && result.output_frames_generated <= block);
        consumed += result.input_frames_used;
        generated += result.output_frames_generated;
        for (int i = 0; i < result.output_frames_generated * 2; ++i) energy += std::abs(output[i]);
        drained = result.stream_drained;
        if (drained) CHECK(result.output_frames_generated == 0);
    }
    const double expected = static_cast<double>(total) * output_rate / source_rate / speed;
    if (!drained || consumed != total || std::abs(generated - expected) > 16 || energy == 0) {
        std::cerr << "rate=" << source_rate << "->" << output_rate << " input=" << total
                  << " block=" << block << " speed=" << speed << " expected=" << expected
                  << " generated=" << generated << " consumed=" << consumed << " drained=" << drained << '\n';
        throw std::runtime_error("stream duration/tail mismatch");
    }
    // EOF polling must not flush repeatedly and manufacture additional silence.
    for (int i = 0; i < 3; ++i) {
        const auto result = pipeline.process(input.data(), 0, 2, true, output.data(), block, 2);
        CHECK(result.stream_drained && result.output_frames_generated == 0);
    }
}

static void live_speed_changes() {
    constexpr int rate = 48000;
    constexpr int block = 128;
    DspPipeline pipeline;
    pipeline.configure({rate, 16, 2}, {rate, 16, 2}, BackendType::ASIO, block);
    std::vector<float> old_audio((block * 2 + 64) * 2, 0.25f);
    std::vector<float> new_audio(old_audio.size(), -0.25f);
    std::vector<float> output(block * 2);
    const auto render = [&](const std::vector<float>& input) {
        return pipeline.process(input.data(), static_cast<int>(input.size() / 2), 2,
                                false, output.data(), block, 2);
    };

    CHECK(pipeline.set_playback_speed_config({true, 0.5f}));
    int consumed = 0;
    int generated = 0;
    for (int callback = 0; callback < 1500; ++callback) {
        const auto result = render(old_audio);
        consumed += result.input_frames_used;
        generated += result.output_frames_generated;
        if (callback >= 50) CHECK(result.output_frames_generated == block);
    }
    CHECK(consumed * 2 - generated < rate / 4);

    // The 1x bypass must play the old tail before consuming any dry input.
    CHECK(pipeline.set_playback_speed_config({false, 1.0f}));
    int tail = 0;
    bool bypassed = false;
    for (int callback = 0; callback < 100 && !bypassed; ++callback) {
        const auto result = render(new_audio);
        bypassed = result.input_frames_used == block;
        if (!bypassed) tail += result.output_frames_generated;
    }
    CHECK(tail > 0 && bypassed && output.front() == new_audio.front());

    // A fast move away from 1x must never replay samples from the old segment.
    CHECK(pipeline.set_playback_speed_config({true, 2.0f}));
    bool heard_new_audio = false;
    for (int callback = 0; callback < 100; ++callback) {
        const auto result = render(new_audio);
        for (int i = 0; i < result.output_frames_generated * 2; ++i) {
            CHECK(output[i] <= 0.0f);
            heard_new_audio |= output[i] < -0.1f;
        }
    }
    CHECK(heard_new_audio);
}

int main() {
    try {
        DspPipeline pipeline;
        for (const float speed : {0.5f, 0.75f, 1.5f, 2.0f}) {
            run(pipeline, 48000, 48000, 512, 512, speed);
            run(pipeline, 48000, 48000, 48000, 64, speed);
            run(pipeline, 48000, 44100, 48000, 512, speed);
            run(pipeline, 44100, 48000, 44100, 4800, speed);
        }
        live_speed_changes();
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
    std::cout << "Short/long streams, speed changes, SRC, repeated EOF and pipeline reuse passed\n";
}
