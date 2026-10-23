#include "audio_engine.h"
#include "auto_mix.h"
#include "auto_mix_preparation.h"
#include <cmath>
#include "logger.h"
#include <chrono>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <iomanip>
#include <iostream>
#include <stdexcept>

using namespace std::chrono_literals;
#define CHECK(x) do { if (!(x)) throw std::runtime_error(#x); } while (0)

struct BackendState {
    std::atomic<unsigned> events{0};
    std::atomic<int> opens{0}, stops_in_flight{0};
    std::atomic<bool> overlap{false}, slow_stop{false}, stop_entered{false}, fail_flush{false}, fail_open{false};
    std::atomic<int> frames{64};
    std::atomic<int> longest_silence{0};
    bool capture_output = false;
    std::vector<float> captured;
    std::atomic<bool> hold_output{false};
};

class FakeBackend : public AudioBackend {
public:
    explicit FakeBackend(std::shared_ptr<BackendState> state) : shared_(std::move(state)) {}
    ~FakeBackend() override { close(); }
    std::vector<DeviceInfo> enumerate_devices() override { return {}; }
    AudioFormat open(const std::wstring&, const AudioFormat& requested, AudioCallback callback) override {
        ++shared_->opens;
        if (shared_->fail_open) return {};
        format_ = requested; callback_ = std::move(callback); return format_;
    }
    bool start() override {
        running_ = true;
        render_ = std::thread([this] {
            std::vector<float> output(256 * format_.channels);
            while (running_) {
                if (!shared_->hold_output) {
                    callback_(output.data(), shared_->frames.load(), format_.channels);
                    if (shared_->capture_output)
                        shared_->captured.insert(shared_->captured.end(), output.begin(), output.begin() + shared_->frames.load() * format_.channels);
                    for (int i = 0; i < shared_->frames.load(); ++i) {
                        float peak = 0;
                        for (int c = 0; c < format_.channels; ++c)
                            peak = std::max(peak, std::abs(output[i * format_.channels + c]));
                        if (peak > 1e-6f) { heard_ = true; silent_ = 0; }
                        else if (heard_) {
                            ++silent_;
                            if (silent_ > shared_->longest_silence) shared_->longest_silence = silent_;
                        }
                    }
                }
                std::this_thread::sleep_for(1ms);
            }
        });
        return true;
    }
    bool stop() override {
        if (shared_->stops_in_flight.fetch_add(1) != 0) shared_->overlap = true;
        shared_->stop_entered = true;
        if (shared_->slow_stop) std::this_thread::sleep_for(150ms);
        running_ = false;
        if (render_.joinable()) render_.join();
        --shared_->stops_in_flight;
        return true;
    }
    void close() override {
        if (shared_->stops_in_flight != 0) shared_->overlap = true;
        if (running_) stop();
    }
    void flush() override {}
    bool flush_checked() override { return !shared_->fail_flush; }
    unsigned take_events() override { return shared_->events.exchange(0); }
    BackendType type() const override { return BackendType::ASIO; }
    AudioFormat current_format() const override { return format_; }
    bool is_active() const override { return running_; }
    int buffer_size_frames() const override { return shared_->frames; }
    double latency_ms() const override { return 2; }
private:
    std::shared_ptr<BackendState> shared_;
    AudioCallback callback_;
    AudioFormat format_{};
    std::atomic<bool> running_{false};
    std::thread render_;
    bool heard_ = false;
    int silent_ = 0;
};

class FakeFactory : public AudioBackendFactory {
public:
    std::shared_ptr<BackendState> shared = std::make_shared<BackendState>();
    std::unique_ptr<AudioBackend> create(BackendType) override { return std::make_unique<FakeBackend>(shared); }
    std::vector<DeviceInfo> enumerate_devices() override { return {}; }
    bool supports(BackendType) const override { return true; }
};

static void wave(const char* path, int audible_seconds, int silent_seconds, double frequency, double amplitude = 12000) {
    const int frames = 48000 * (audible_seconds + silent_seconds);
    std::ofstream file(path, std::ios::binary);
    const auto word = [&](uint32_t value, int bytes) {
        for (int i = 0; i < bytes; ++i) file.put(static_cast<char>(value >> (i * 8)));
    };
    file.write("RIFF", 4); word(36 + frames * 4, 4); file.write("WAVEfmt ", 8);
    word(16, 4); word(1, 2); word(2, 2); word(48000, 4); word(192000, 4);
    word(4, 2); word(16, 2); file.write("data", 4); word(frames * 4, 4);
    for (int i = 0; i < frames; ++i) {
        const int16_t sample = i < audible_seconds * 48000
            ? static_cast<int16_t>(amplitude * std::sin(i * frequency * 6.28318530718 / 48000)) : 0;
        word(static_cast<uint16_t>(sample), 2); word(static_cast<uint16_t>(sample), 2);
    }
}
static void descriptors_and_envelopes() {
    std::vector<float> low(4800), high(4800);
    for (int i = 0; i < 4800; ++i) {
        low[i] = 0.25f * std::sin(i * 220 * 6.28318530718 / 48000);
        high[i] = 0.25f * std::sin(i * 5000 * 6.28318530718 / 48000);
    }
    const auto a = auto_mix::summarize({auto_mix::measure(low.data(), 4800, 1, 4800)}, 0, 4800);
    const auto b = auto_mix::summarize({auto_mix::measure(high.data(), 4800, 1, 4800)}, 0, 4800);
    CHECK(auto_mix::difference(a, a) < 0.001);
    CHECK(auto_mix::difference(a, b) > 0.99);
    CHECK(auto_mix::overlap_frames(240000, 48000, auto_mix::difference(a, b)) == 180000); // 3.75s, not a short cut
    CHECK(auto_mix::overlap_frames(240000, 48000, 0) == 240000);
    CHECK(auto_mix::overlap_frames(2400, 48000, 1) == 2400);
    CHECK(auto_mix::silence_threshold(0.25) < 0.001); // quiet reverb survives
    for (double separation : {0.0, 0.5, 1.0}) {
        auto first = auto_mix::gains(0, separation), last = auto_mix::gains(1, separation);
        CHECK(std::abs(first.first - 1) < 1e-6 && first.second == 0);
        CHECK(std::abs(last.first) < 1e-6 && std::abs(last.second - 1) < 1e-6);
        auto previous = first;
        for (int i = 1; i <= 1000; ++i) {
            const auto gain = auto_mix::gains(i / 1000.0f, separation);
            CHECK(gain.first <= previous.first && gain.second >= previous.second);
            CHECK(gain.first + gain.second >= 0.999f);
            previous = gain;
        }
    }
}
static void skip_long_tail(int silence, bool late, double amplitude = 12000, int overlap_ms = 5000, int incoming_seconds = 6, bool in_silence = false) {
    wave("mix-out.wav", 4, silence, 220, amplitude);
    wave("mix-in.wav", incoming_seconds, 0, 4321);
    auto factory = std::make_shared<FakeFactory>();
    factory->shared->frames = 256;
    AudioEngine engine(factory);
    std::atomic<int> transitions{0};
    std::atomic<bool> trimmed{false};
    Logger::instance().set_callback([&](LogLevel, const std::string& message) {
        if (message.find("Auto crossfade plan:") != std::string::npos &&
            (message.find("end=4150ms") != std::string::npos ||
             (in_silence && message.find("end=10150ms") != std::string::npos))) trimmed = true;
    });
    auto config = engine.transition_config();
    config.crossfade_enabled = true; config.crossfade_auto = true;
    config.crossfade_ms = overlap_ms; config.pause_fade_enabled = false;
    CHECK(engine.set_transition_config(config));
    CHECK(engine.open("mix-out.wav"));
    if (late) CHECK(engine.seek(in_silence ? 10000 : 3800));
    engine.set_track_ended_callback([&](const std::string& reason, const std::string&) {
        if (reason == "transition") ++transitions;
    });
    CHECK(engine.set_next_track("mix-in.wav"));
    CHECK(trimmed);
    CHECK(engine.play());
    const auto deadline = std::chrono::steady_clock::now() + 3s;
    while (transitions == 0 && std::chrono::steady_clock::now() < deadline)
        std::this_thread::sleep_for(2ms);
    CHECK(transitions == 1); // untrimmed 24/74s would miss this deadline
    engine.stop();
    Logger::instance().set_callback({});
}

static std::vector<float> musical_signal(double bpm, int seconds, int rate = 48000, double phase = 0.12, bool irregular = false) {
    std::vector<float> pcm(static_cast<size_t>(seconds) * rate * 2);
    const double period = 60 / bpm;
    for (int i = 0; i < seconds * rate; ++i) {
        const double time = double(i) / rate;
        const int beat = static_cast<int>(std::floor(std::max(0.0, time - phase) / period));
        const double shift = irregular ? 0.11 * std::sin(beat * 2.17) : 0;
        const double within = time - phase - beat * period - shift;
        const double click = within >= 0 && within < 0.025
            ? (beat % 4 == 0 ? 0.7 : 0.4) * std::exp(-within * 180) * std::sin(within * 6.28318530718 * 1300) : 0;
        const double chord = 0.04 * (std::sin(time * 6.28318530718 * 261.625565) +
            std::sin(time * 6.28318530718 * 329.627557) + std::sin(time * 6.28318530718 * 391.995436));
        pcm[i * 2] = pcm[i * 2 + 1] = static_cast<float>(click + chord);
    }
    return pcm;
}
static void save_signal(const char* path, const std::vector<float>& pcm, int rate = 48000, int channels = 2) {
    std::ofstream file(path, std::ios::binary);
    const auto word = [&](uint32_t value, int bytes) {
        for (int i = 0; i < bytes; ++i) file.put(static_cast<char>(value >> (i * 8)));
    };
    file.write("RIFF", 4); word(36 + static_cast<uint32_t>(pcm.size() * 2), 4); file.write("WAVEfmt ", 8);
    word(16, 4); word(1, 2); word(channels, 2); word(rate, 4); word(rate * channels * 2, 4);
    word(channels * 2, 2); word(16, 2); file.write("data", 4); word(static_cast<uint32_t>(pcm.size() * 2), 4);
    for (float sample : pcm) word(static_cast<uint16_t>(static_cast<int16_t>(sample * 32767)), 2);
}
static auto_mix::MusicalProfile profile(const std::vector<float>& pcm, int rate = 48000) {
    auto_mix::MusicalAnalyzer analyzer(rate, 2);
    // Deliberately use an unaligned chunk size, as the decoder does.
    for (size_t at = 0; at < pcm.size(); at += 3074) {
        const int frames = static_cast<int>(std::min<size_t>(3074, pcm.size() - at) / 2);
        analyzer.add(pcm.data() + at, frames);
    }
    return analyzer.finish();
}
static void musical_analysis_and_rendering() {
    auto outgoing = musical_signal(120, 16);
    auto incoming = musical_signal(123, 16);
    const auto a = profile(outgoing), b = profile(incoming);
    std::cerr << "Music profiles: " << a.bpm << "/" << a.confidence << " key=" << a.key << "/" << a.key_confidence
              << "; " << b.bpm << "/" << b.confidence << " key=" << b.key << "/" << b.key_confidence << '\n';
    CHECK(std::abs(a.bpm - 120) < 0.6 && a.confidence >= 0.78);
    CHECK(std::abs(b.bpm - 123) < 0.6 && b.confidence >= 0.78);
    CHECK(a.key == -1 && b.key == -1); // isolated triad is harmonically ambiguous
    CHECK(a.key_confidence < 0.6 && b.key_confidence < 0.6);
    CHECK(std::abs(a.first_beat - 0.12) < 0.03);
    CHECK(profile(std::vector<float>(48000 * 16 * 2)).confidence == 0);
    CHECK(profile(musical_signal(120, 16, 48000, 0.12, true)).confidence < 0.78);
    CHECK(auto_mix::harmonic_compatible(0, 9 + 12));
    CHECK(auto_mix::harmonic_compatible(0, 7));
    CHECK(!auto_mix::harmonic_compatible(0, 6));
    auto handoff = auto_mix::choose_handoff(a, b, 48000 * 16, 48000 * 5, 48000, 0.1);
    CHECK(handoff.matched && handoff.tempo >= 0.96 && handoff.tempo <= 1.04);
    CHECK(handoff.fade_frames <= 48000 * 5);
    auto known_key = a; known_key.key = 0;
    auto bad_key = b; bad_key.key = 6;
    CHECK(!auto_mix::choose_handoff(known_key, bad_key, 48000 * 16, 48000 * 5, 48000, 0.1).matched);
    auto bad_tempo = b; bad_tempo.bpm = 160;
    CHECK(!auto_mix::choose_handoff(a, bad_tempo, 48000 * 16, 48000 * 5, 48000, 0.1).matched);
    auto uncertain = b; uncertain.confidence = 0.5;
    CHECK(!auto_mix::choose_handoff(a, uncertain, 48000 * 16, 48000 * 5, 48000, 0.1).matched);
    save_signal("musical-in.wav", incoming);
    const auto prepared = auto_mix::prepare_intro("musical-in.wav", 48000, 2, handoff, a.period);
    CHECK(prepared.pcm.size() == static_cast<size_t>(handoff.fade_frames) * 2);
    CHECK(prepared.source_frames > 0 && prepared.source_frames < 48000 * 8);
    CHECK(std::all_of(prepared.pcm.begin(), prepared.pcm.end(), [](float x) { return std::isfinite(x) && std::abs(x) < 1.5; }));
    // The prepared segment must rejoin the raw source with matching endpoint.
    Decoder raw; CHECK(raw.open("musical-in.wav")); CHECK(raw.seek(prepared.source_frames - 1));
    float last[2]; CHECK(raw.decode(last, 1) == 1);
    CHECK(std::abs(last[1] - prepared.pcm.back()) < 1e-6);
    // Onsets remain near the aligned grid before the final recovery beat.
    for (int beat = 0; beat < 4; ++beat) {
        const double time = double(handoff.delay_frames) / 48000 + 0.12 / handoff.tempo + beat * a.period;
        double peak = 0;
        for (int frame = static_cast<int>((time - 0.035) * 48000); frame < (time + 0.035) * 48000; ++frame) {
            if (frame >= 0 && frame * 2 < static_cast<int>(prepared.pcm.size()))
                peak = std::max(peak, double(std::abs(prepared.pcm[frame * 2])));
        }
        CHECK(peak > 0.2);
    }
    // A rich, unambiguous pitch-class profile must resolve a major key.
    const std::array<double, 12> weights{6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88};
    std::vector<float> tonal(48000 * 8 * 2);
    for (int frame = 0; frame < 48000 * 8; ++frame) {
        double value = 0;
        for (int note = 0; note < 12; ++note)
            value += weights[note] * 0.005 * std::sin(frame * 6.28318530718 * 261.625565 * std::pow(2.0, note / 12.0) / 48000 + note);
        tonal[frame * 2] = tonal[frame * 2 + 1] = static_cast<float>(value);
    }
    const auto key_profile = profile(tonal);
    CHECK(key_profile.key == 0 && key_profile.key_confidence >= 0.6);

    // Cache invalidates when the same path is rewritten with a different song.
    const auto cached = auto_mix::analyze_region("musical-in.wav", 0, 48000 * 16);
    CHECK(std::abs(cached.bpm - 123) < 0.6);
    incoming = musical_signal(140, 17); save_signal("musical-in.wav", incoming);
    const auto changed = auto_mix::analyze_region("musical-in.wav", 0, 48000 * 16);
    CHECK(std::abs(changed.bpm - 140) < 0.6);
}
static void musical_engine_transition(bool disable_during_mix = false) {
    save_signal("musical-out.wav", musical_signal(120, 16));
    save_signal("musical-in.wav", musical_signal(123, 16));
    auto factory = std::make_shared<FakeFactory>(); factory->shared->frames = 256;
    std::atomic<bool> beat_matched{false}, started{false}; std::atomic<int> transitions{0};
    Logger::instance().set_callback([&](LogLevel, const std::string& message) {
        if (message.find("strategy=beat-matched") != std::string::npos) beat_matched = true;
        if (message.find("Crossfade started:") != std::string::npos) started = true;
    });
    {
        AudioEngine engine(factory);
        auto config = engine.transition_config(); config.crossfade_enabled = config.crossfade_auto = true;
        config.crossfade_ms = 5000; config.pause_fade_enabled = false;
        CHECK(engine.set_transition_config(config)); CHECK(engine.open("musical-out.wav"));
        CHECK(engine.set_next_track("musical-in.wav")); CHECK(beat_matched);
        // Seek before overlap: prepared audio must remain usable after rewind.
        CHECK(engine.seek(10000));
        engine.set_track_ended_callback([&](const std::string& reason, const std::string&) {
            if (reason == "transition") ++transitions;
        });
        CHECK(engine.play());
        const auto deadline = std::chrono::steady_clock::now() + 5s;
        if (disable_during_mix) {
            while (!started && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(2ms);
            CHECK(started);
            config.crossfade_enabled = config.crossfade_auto = config.gapless_enabled = false;
            CHECK(engine.set_transition_config(config));
        }
        while (transitions == 0 && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(2ms);
        CHECK(transitions == 1);
        CHECK(engine.position_ms() > 2000 && engine.position_ms() < 7000);
        engine.stop();
    }
    Logger::instance().set_callback({});
}


static void formatted_wave(const char* path, int rate, int channels, int bits, int leading_ms = 0) {
    const int frames = rate * 8, bytes = bits / 8;
    std::ofstream file(path, std::ios::binary);
    const auto word = [&](uint32_t value, int count) {
        for (int i = 0; i < count; ++i) file.put(static_cast<char>(value >> (i * 8)));
    };
    file.write("RIFF", 4); word(36 + frames * channels * bytes, 4); file.write("WAVEfmt ", 8);
    word(16, 4); word(1, 2); word(channels, 2); word(rate, 4); word(rate * channels * bytes, 4);
    word(channels * bytes, 2); word(bits, 2); file.write("data", 4); word(frames * channels * bytes, 4);
    for (int i = 0; i < frames; ++i) {
        const double value = i < rate * leading_ms / 1000 ? 0 : 0.2 * std::sin(i * 6.28318530718 * 440 / rate);
        const int32_t sample = static_cast<int32_t>(value * (bits == 24 ? 8388607 : 32767));
        for (int c = 0; c < channels; ++c) word(static_cast<uint32_t>(sample), bytes);
    }
}
static void normalized_decoder() {
    formatted_wave("normalized.wav", 44100, 1, 24);
    Decoder decoder; CHECK(decoder.open("normalized.wav", 48000, 2));
    CHECK(decoder.track_info().sample_rate == 48000 && decoder.track_info().channels == 2);
    CHECK(decoder.track_info().original_sample_rate == 44100 && decoder.track_info().original_channels == 1);
    std::vector<float> pcm(2048); int64_t frames = 0;
    while (true) {
        const int count = decoder.decode(pcm.data(), 1024); CHECK(count >= 0);
        if (!count) break;
        frames += count;
        CHECK(std::abs(decoder.position() - frames) <= 2);
        for (int i = 0; i < count; ++i) CHECK(std::abs(pcm[i * 2] - pcm[i * 2 + 1]) < 1e-6);
    }
    CHECK(std::abs(frames - 48000 * 8) <= 2);
    CHECK(decoder.seek(48000)); CHECK(decoder.decode(pcm.data(), 1024) == 1024);
    CHECK(std::abs(decoder.position() - 49024) <= 2);
}
static void cross_format_continuity(int from_rate, int to_rate, int to_channels, int to_bits, bool fixed = false) {
    formatted_wave("format-out.wav", from_rate, 2, 16);
    formatted_wave("format-in.wav", to_rate, to_channels, to_bits, fixed ? 0 : 1500);
    auto factory = std::make_shared<FakeFactory>(); factory->shared->frames = 256;
    AudioEngine engine(factory); std::atomic<int> transitions{0};
    auto config = engine.transition_config(); config.crossfade_enabled = true;
    config.crossfade_auto = !fixed; config.crossfade_ms = 3000; config.pause_fade_enabled = false;
    CHECK(engine.set_transition_config(config)); CHECK(engine.open("format-out.wav"));
    CHECK(engine.set_next_track("format-in.wav")); CHECK(engine.seek(4500));
    engine.set_track_ended_callback([&](const std::string& reason, const std::string&) {
        if (reason == "transition") ++transitions;
    });
    CHECK(engine.play());
    const auto deadline = std::chrono::steady_clock::now() + 4s;
    while (transitions == 0 && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(2ms);
    CHECK(transitions == 1 && factory->shared->opens == 1);
    CHECK(engine.track_info().sample_rate == from_rate);
    CHECK(engine.position_ms() >= 500 && engine.position_ms() < 5000);
    CHECK(factory->shared->longest_silence < from_rate / 50); // no audible buffer gap
    CHECK(engine.seek(4000)); // seek continues in the normalized time base
    CHECK(engine.position_ms() == 4000);
    engine.stop();
}

static double tone_amplitude(const std::vector<float>& pcm, size_t start, int frames, double hz) {
    double real = 0, imag = 0;
    for (int i = 0; i < frames; ++i) {
        const double sample = pcm[start + i * 2];
        const double phase = 6.28318530718 * hz * i / 48000;
        real += sample * std::cos(phase); imag += sample * std::sin(phase);
    }
    return std::hypot(real, imag) * 2 / frames;
}
static void audible_overlap_regression() {
    wave("overlap-out.wav", 8, 0, 440);
    wave("overlap-in.wav", 16, 0, 1760);
    auto factory = std::make_shared<FakeFactory>();
    factory->shared->frames = 256; factory->shared->capture_output = true;
    std::atomic<int> transitions{0};
    {
        AudioEngine engine(factory);
        auto config = engine.transition_config(); config.crossfade_enabled = config.crossfade_auto = true;
        config.crossfade_ms = 5000; config.pause_fade_enabled = false;
        CHECK(engine.set_transition_config(config)); CHECK(engine.open("overlap-out.wav"));
        CHECK(engine.set_next_track("overlap-in.wav")); CHECK(engine.seek(2000));
        engine.set_track_ended_callback([&](const std::string& reason, const std::string&) {
            if (reason == "transition") ++transitions;
        });
        CHECK(engine.play());
        const auto deadline = std::chrono::steady_clock::now() + 5s;
        while (transitions == 0 && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(2ms);
        CHECK(transitions == 1); engine.stop();
    }
    const auto& pcm = factory->shared->captured;
    int concurrent_ms = 0, longest_ms = 0;
    constexpr int window = 4800;
    for (size_t at = 0; at + window * 2 <= pcm.size(); at += window * 2) {
        const bool both = tone_amplitude(pcm, at, window, 440) > 0.025 &&
            tone_amplitude(pcm, at, window, 1760) > 0.025;
        concurrent_ms = both ? concurrent_ms + 100 : 0;
        longest_ms = std::max(longest_ms, concurrent_ms);
    }
    CHECK(longest_ms >= 1000); // two simultaneous sources, not just gapless switching
    std::cout << "Audible simultaneous overlap=" << longest_ms << "ms\n";
    // Verify frequency routing state does not depend on decoder block size.
    std::vector<float> a(48000), b(48000), whole, chunks;
    for (size_t i = 0; i < a.size() / 2; ++i) {
        a[i * 2] = a[i * 2 + 1] = 0.2f * std::sin(i * 6.28318530718 * 90 / 48000);
        b[i * 2] = b[i * 2 + 1] = 0.2f * std::sin(i * 6.28318530718 * 3000 / 48000);
    }
    whole = chunks = a;
    auto_mix::StagedMixer first, second; first.reset(48000, 2); second.reset(48000, 2);
    first.process(whole.data(), b.data(), 24000, 2, 0, 24000, 0.8);
    for (int at = 0; at < 24000; at += 317)
        second.process(chunks.data() + at * 2, b.data() + at * 2, std::min(317, 24000 - at), 2, at, 24000, 0.8);
    CHECK(std::abs(whole.front() - a.front()) < 1e-6);
    CHECK(std::abs(whole.back() - b.back()) < 1e-6);
    for (size_t i = 0; i < whole.size(); ++i) CHECK(std::abs(whole[i] - chunks[i]) < 1e-6 && std::isfinite(whole[i]));
}


static void preserve_voice_band() {
    // Measure each source against a full-band equal-power reference. A delayed
    // 220-2400Hz entrance used to suppress these components by over 10dB.
    constexpr int rate = 48000, frames = 9600, total = rate * 100;
    for (double frequency : {120.0, 250.0, 500.0, 1000.0, 2000.0, 3500.0}) {
        for (float progress : {0.12f, 0.35f, 0.65f, 0.88f}) {
            for (bool incoming : {false, true}) {
                const int offset = static_cast<int>(progress * total);
                std::vector<float> out(frames * 2, 0), in(frames * 2, 0), reference(frames * 2);
                for (int i = 0; i < frames; ++i) {
                    const float sample = static_cast<float>(0.2 * std::sin(i * 6.28318530718 * frequency / rate));
                    auto& source = incoming ? in : out;
                    source[i * 2] = source[i * 2 + 1] = sample;
                    const auto gain = auto_mix::gains(static_cast<float>(offset + i) / (total - 1), 0);
                    reference[i * 2] = reference[i * 2 + 1] = sample * (incoming ? gain.second : gain.first);
                }
                auto_mix::StagedMixer mixer; mixer.reset(rate, 2);
                mixer.process(out.data(), in.data(), frames, 2, offset, total, 1.0);
                // Ignore filter startup; voice-band retention must hold for
                // incoming and outgoing sources throughout the crossfade.
                const double actual = tone_amplitude(out, 4800, 4800, frequency);
                const double expected = tone_amplitude(reference, 4800, 4800, frequency);
                const double db = 20 * std::log10(actual / expected);
                CHECK(db > -2.0 && db < 2.0);
            }
        }
    }
}

static void real_playlist_regression(const char* manifest, const char* preview = nullptr, const char* stems = nullptr) {
    std::ifstream file(manifest);
    std::string outgoing, incoming;
    std::getline(file, outgoing); std::getline(file, incoming);
    CHECK(!outgoing.empty() && !incoming.empty());
    auto factory = std::make_shared<FakeFactory>(); factory->shared->frames = 256;
    factory->shared->capture_output = preview != nullptr;
    std::atomic<int> transitions{0};
    Logger::instance().set_callback([](LogLevel, const std::string& message) {
        if (message.find("Auto crossfade plan:") != std::string::npos ||
            message.find("Track transition:") != std::string::npos) std::cout << message << '\n';
    });
    {
        AudioEngine engine(factory);
        auto config = engine.transition_config(); config.crossfade_enabled = config.crossfade_auto = true;
        config.pause_fade_enabled = false; config.crossfade_ms = 5000;
        CHECK(engine.set_transition_config(config)); CHECK(engine.open(outgoing));
        CHECK(engine.set_next_track(incoming));
        if (stems) {
            std::ifstream stem_file(stems); std::string out_vocals, in_vocals;
            std::getline(stem_file, out_vocals); std::getline(stem_file, in_vocals);
            int64_t cue = -1, out_start = -1; stem_file >> cue >> out_start;
            const auto request = engine.auto_mix_stem_request();
            CHECK(engine.set_auto_mix_vocals(request.revision, out_vocals, in_vocals, cue, out_start));
        }
        engine.set_track_ended_callback([&](const std::string& reason, const std::string&) {
            if (reason == "transition") ++transitions;
        });
        CHECK(engine.seek(std::max(0.0, engine.duration_ms() - 18000)));
        CHECK(engine.play());
        const auto deadline = std::chrono::steady_clock::now() + 10s;
        while (transitions == 0 && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(2ms);
        CHECK(transitions == 1 && factory->shared->opens == 1);
        std::cout << "Real playlist: uninterrupted device, longest silent run="
            << factory->shared->longest_silence * 1000.0 / engine.track_info().sample_rate << "ms\n";
        if (preview) {
            std::this_thread::sleep_for(500ms);
            const int rate = engine.track_info().sample_rate, channels = engine.track_info().channels;
            engine.stop();
            const auto& pcm = factory->shared->captured;
            const size_t count = std::min<size_t>(pcm.size(), static_cast<size_t>(rate) * channels * 12);
            save_signal(preview, std::vector<float>(pcm.end() - count, pcm.end()), rate, channels);
        } else engine.stop();
    }
    Logger::instance().set_callback({});
}


static void stem_request_file(const char* manifest, const char* output) {
    std::ifstream file(manifest); std::string outgoing, incoming;
    std::getline(file, outgoing); std::getline(file, incoming);
    AudioEngine engine(std::make_shared<FakeFactory>());
    auto config = engine.transition_config(); config.crossfade_enabled = config.crossfade_auto = true;
    config.crossfade_ms = 5000; CHECK(engine.set_transition_config(config));
    CHECK(engine.open(outgoing)); CHECK(engine.set_next_track(incoming));
    const auto request = engine.auto_mix_stem_request(); CHECK(request.fade_frames > 0);
    std::ofstream json(output);
    json << "{\"id\":1,\"sourcePath\":" << std::quoted(request.source_path)
         << ",\"nextPath\":" << std::quoted(request.next_path)
         << ",\"revision\":" << request.revision << ",\"sampleRate\":" << request.sample_rate
         << ",\"outStartFrame\":" << request.out_start_frame << ",\"inStartFrame\":" << request.in_start_frame
         << ",\"vocalCue\":" << (request.vocal_cue ? "true" : "false")
         << ",\"fadeFrames\":" << request.fade_frames << ",\"channels\":" << request.channels << "}";
    engine.stop();
}
static void vocal_protection_regression() {
    constexpr int rate = 48000, frames = rate * 5;
    std::vector<float> original(frames * 2), incoming(frames * 2), voice(frames * 2), no_voice(frames * 2, 0);
    for (int i = 0; i < frames; ++i) {
        const float v = 0.025f * std::sin(i * 6.28318530718 * 700 / rate);
        const float bed = 0.05f * std::sin(i * 6.28318530718 * 110 / rate);
        const float next = 0.3f * std::sin(i * 6.28318530718 * 1800 / rate);
        for (int c = 0; c < 2; ++c) { voice[i * 2 + c] = v; original[i * 2 + c] = bed + v; incoming[i * 2 + c] = next; }
    }
    auto baseline = original, protected_mix = original;
    auto_mix::StagedMixer staged; staged.reset(rate, 2);
    staged.process(baseline.data(), incoming.data(), frames, 2, 0, frames, 1);
    auto_mix::VocalMixer vocals; vocals.reset(rate);
    vocals.process(protected_mix.data(), incoming.data(), voice.data(), no_voice.data(), frames, 2, 0, frames);
    const size_t at = rate * 2 * 2;
    CHECK(tone_amplitude(protected_mix, at, 4800, 700) > tone_amplitude(baseline, at, 4800, 700) * 1.6);
    CHECK(tone_amplitude(protected_mix, at, 4800, 1800) < tone_amplitude(baseline, at, 4800, 1800) * 0.7);
    CHECK(std::abs(protected_mix.front() - original.front()) < 1e-6);
    CHECK(std::abs(protected_mix.back() - incoming.back()) < 1e-6);
    CHECK(std::all_of(protected_mix.begin(), protected_mix.end(), [](float x) { return std::isfinite(x); }));
    // A zero vocal estimate must reconstruct an ordinary equal-power mix.
    vocals.reset(rate); auto empty = original;
    vocals.process(empty.data(), incoming.data(), no_voice.data(), no_voice.data(), frames, 2, 0, frames);
    for (int frame = 0; frame < frames; frame += 719) {
        const auto gain = auto_mix::gains(float(frame) / (frames - 1), 0);
        CHECK(std::abs(empty[frame * 2] - original[frame * 2] * gain.first - incoming[frame * 2] * gain.second) < 1e-6);
    }
    // A barely audible tail voice must release the next bed; a relative-only
    // activity gate used to duck even separator leakage in a depleted fade.
    auto quiet_voice = voice, quiet_tail = voice;
    for (size_t i = 0; i < voice.size(); ++i) quiet_voice[i] = quiet_tail[i] = voice[i] * 0.02f;
    vocals.reset(rate);
    vocals.process(quiet_tail.data(), incoming.data(), quiet_voice.data(), no_voice.data(), frames, 2, 0, frames);
    CHECK(tone_amplitude(quiet_tail, at, 4800, 1800) > tone_amplitude(baseline, at, 4800, 1800) * 0.95);
    wave("vocal-request-out.wav", 8, 2, 700); wave("vocal-request-in.wav", 16, 0, 1800);
    auto factory = std::make_shared<FakeFactory>();
    AudioEngine engine(factory);
    auto config = engine.transition_config(); config.crossfade_auto = config.crossfade_enabled = true;
    config.vocal_cue_enabled = false;
    CHECK(engine.set_transition_config(config)); CHECK(engine.open("vocal-request-out.wav"));
    CHECK(engine.set_next_track("vocal-request-in.wav"));
    auto request = engine.auto_mix_stem_request(); CHECK(request.fade_frames > 0 && !request.vocal_cue);
    CHECK(!engine.set_auto_mix_vocals(request.revision, "unused", "unused", request.in_start_frame + rate));
    config.vocal_cue_enabled = true;
    CHECK(engine.set_transition_config(config)); request = engine.auto_mix_stem_request(); CHECK(request.vocal_cue);
    std::vector<float> silence(static_cast<size_t>(request.fade_frames) * request.channels, 0);
    save_signal("vocal-silent-stem.wav", silence, request.sample_rate, request.channels);
    CHECK(!engine.set_auto_mix_vocals(request.revision + 1, "vocal-silent-stem.wav", "vocal-silent-stem.wav"));
    CHECK(!engine.set_auto_mix_vocals(request.revision, "vocal-silent-stem.wav", "vocal-silent-stem.wav", rate, request.out_start_frame + 1));
    CHECK(engine.set_auto_mix_vocals(request.revision, "vocal-silent-stem.wav", "vocal-silent-stem.wav", rate));
    CHECK(!engine.set_auto_mix_vocals(request.revision, "vocal-silent-stem.wav", "vocal-silent-stem.wav"));
    CHECK(engine.seek(7800)); // late attachment must never rewrite a live overlap
    CHECK(engine.auto_mix_stem_request().fade_frames == 0);
    std::atomic<int> transitioned{0}; factory->shared->frames = 256;
    engine.set_track_ended_callback([&](const std::string& reason, const std::string&) { if (reason == "transition") ++transitioned; });
    CHECK(engine.play());
    const auto deadline = std::chrono::steady_clock::now() + 3s;
    while (!transitioned && std::chrono::steady_clock::now() < deadline) std::this_thread::sleep_for(2ms);
    CHECK(transitioned == 1 && engine.position_ms() > 4000); // cue + full overlap offset
    engine.stop();
}

int main(int argc, char** argv) {
    try {
        if (argc == 4 && std::string(argv[1]) == "--stem-request") { stem_request_file(argv[2], argv[3]); return 0; }
        if (argc >= 2) { real_playlist_regression(argv[1], argc >= 3 ? argv[2] : nullptr, argc >= 4 ? argv[3] : nullptr); return 0; }
        vocal_protection_regression();
        preserve_voice_band();
        audible_overlap_regression();
        normalized_decoder();
        cross_format_continuity(48000, 44100, 1, 24);
        cross_format_continuity(44100, 48000, 2, 24);
        cross_format_continuity(48000, 48000, 2, 24, true);
        descriptors_and_envelopes();
        musical_analysis_and_rendering();
        musical_engine_transition();
        musical_engine_transition(true);
        skip_long_tail(20, false);
        skip_long_tail(70, false); // entire initial scan is silent
        skip_long_tail(20, true, 12000, 5000, 6, true); // already inside silence
        skip_long_tail(20, true); // late preparation must retain trimming
        skip_long_tail(20, false, 15); // quiet recording, about -70 dBFS
        skip_long_tail(20, false, 12000, 5000, 1); // very short incoming track
        skip_long_tail(20, false, 12000, 100); // respect small user maximum
    } catch (const std::exception& error) {
        Logger::instance().set_callback({});
        std::cerr << error.what() << '\n'; return 1;
    }
    std::cout << "Auto Mix: long/quiet tails, late queue, descriptors and envelopes passed\n";
}
