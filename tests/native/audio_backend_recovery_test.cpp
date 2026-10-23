#include "audio_engine.h"
#include "logger.h"
#include <chrono>
#include <cstdlib>
#include <exception>
#include <fstream>
#include <iostream>
#include <stdexcept>

using namespace std::chrono_literals;
#define CHECK(x) do { if (!(x)) throw std::runtime_error(#x); } while (0)

struct BackendState {
    std::atomic<unsigned> events{0};
    std::atomic<int> opens{0}, stops_in_flight{0};
    std::atomic<bool> overlap{false}, slow_stop{false}, stop_entered{false}, fail_flush{false}, fail_open{false};
    std::atomic<int> frames{64};
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
                if (!shared_->hold_output)
                    callback_(output.data(), shared_->frames.load(), format_.channels);
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
};

class FakeFactory : public AudioBackendFactory {
public:
    std::shared_ptr<BackendState> shared = std::make_shared<BackendState>();
    std::unique_ptr<AudioBackend> create(BackendType) override { return std::make_unique<FakeBackend>(shared); }
    std::vector<DeviceInfo> enumerate_devices() override { return {}; }
    bool supports(BackendType) const override { return true; }
};

static void wave(const char* path, int frames) {
    std::ofstream file(path, std::ios::binary);
    const auto word = [&](uint32_t value, int bytes) {
        for (int i = 0; i < bytes; ++i) file.put(static_cast<char>(value >> (i * 8)));
    };
    file.write("RIFF", 4); word(36 + frames * 4, 4); file.write("WAVEfmt ", 8);
    word(16, 4); word(1, 2); word(2, 2); word(48000, 4); word(192000, 4);
    word(4, 2); word(16, 2); file.write("data", 4); word(frames * 4, 4);
    for (int i = 0; i < frames * 2; ++i) word(100, 2);
}

template<class F> static void until(F predicate) {
    const auto deadline = std::chrono::steady_clock::now() + 3s;
    while (!predicate()) {
        CHECK(std::chrono::steady_clock::now() < deadline);
        std::this_thread::sleep_for(1ms);
    }
}

static void eof_device_switch() {
    auto factory = std::make_shared<FakeFactory>();
    AudioEngine engine(factory);
    CHECK(engine.open("recovery-short.wav"));
    factory->shared->slow_stop = true;
    CHECK(engine.play());
    until([&] { return factory->shared->stop_entered.load(); });
    // Switch while the position timer is inside EOF stop().
    CHECK(engine.select_output_device(BackendType::ASIO, L"second-device"));
    CHECK(!factory->shared->overlap);
    engine.stop();
}

static void reset_and_seek_errors() {
    auto factory = std::make_shared<FakeFactory>();
    AudioEngine engine(factory);
    std::atomic<int> errors{0};
    engine.set_error_callback([&](int, const std::string&) { ++errors; });
    CHECK(engine.open("recovery-long.wav")); CHECK(engine.play());
    CHECK(engine.seek(500));
    factory->shared->frames = 128;
    factory->shared->events = BackendEventReset | BackendEventRateChanged;
    engine.service_backend_events();
    CHECK(engine.state() == EngineState::Playing);
    CHECK(factory->shared->opens == 2 && engine.position_ms() >= 500);
    CHECK(engine.pause());
    factory->shared->events = BackendEventResync;
    engine.service_backend_events();
    CHECK(engine.state() == EngineState::Paused);
    CHECK(factory->shared->opens == 2); // reopening is deferred until resume
    CHECK(engine.play()); CHECK(factory->shared->opens == 3);
    factory->shared->fail_flush = true;
    CHECK(!engine.seek(600));
    CHECK(engine.state() == EngineState::Stopped && errors > 0);
    CHECK(!factory->shared->overlap);
    engine.stop();

    factory->shared->fail_flush = false;
    CHECK(engine.open("recovery-long.wav")); CHECK(engine.play());
    factory->shared->fail_open = true;
    factory->shared->events = BackendEventReset;
    const int previous_errors = errors;
    engine.service_backend_events();
    CHECK(engine.state() == EngineState::Stopped && errors > previous_errors);
}

static void render_failure_stops_engine() {
    auto factory = std::make_shared<FakeFactory>();
    AudioEngine engine(factory);
    int errors = 0;
    engine.set_error_callback([&](int, const std::string&) { ++errors; });
    CHECK(engine.open("recovery-long.wav")); CHECK(engine.play());
    const int opens = factory->shared->opens;
    factory->shared->events = BackendEventFailure;
    engine.service_backend_events();
    CHECK(engine.state() == EngineState::Stopped && errors == 1);
    CHECK(factory->shared->opens == opens); // No automatic retry loop on a broken device.
    engine.service_backend_events();
    CHECK(errors == 1);
}

static void restore_position_after_startup_device_selection() {
    auto factory = std::make_shared<FakeFactory>();
    AudioEngine engine(factory);
    // Startup restores the chosen output before opening the saved track.
    CHECK(engine.select_output_device(BackendType::ASIO, L"saved-device"));
    CHECK(engine.open("recovery-long.wav"));
    CHECK(engine.seek(1500));
    CHECK(engine.position_ms() == 1500);
    CHECK(engine.play());
    CHECK(engine.position_ms() >= 1500);
    engine.stop();
    CHECK(engine.open("recovery-long.wav"));
    CHECK(engine.seek(1000));
    CHECK(engine.select_output_device(BackendType::ASIO, L"changed-before-play"));
    CHECK(engine.seek(2500)); // Latest seek overrides the earlier reopen snapshot.
    CHECK(engine.play());
    CHECK(engine.position_ms() >= 2500);
    engine.stop();
}

static void retry_failed_output_open() {
    auto factory = std::make_shared<FakeFactory>();
    AudioEngine engine(factory);
    CHECK(engine.open("recovery-long.wav"));
    factory->shared->fail_open = true;
    CHECK(!engine.play());
    factory->shared->fail_open = false;
    CHECK(engine.play());
    CHECK(factory->shared->opens == 2);
    until([&] { return engine.position_ms() > 10; });
    engine.stop();
}

static void normal_playback_lifecycle() {
    auto factory = std::make_shared<FakeFactory>();
    AudioEngine engine(factory);
    auto transition = engine.transition_config();
    transition.pause_fade_enabled = false;
    CHECK(engine.set_transition_config(transition));
    CHECK(engine.open("recovery-long.wav"));
    CHECK(engine.seek(500)); CHECK(engine.play());
    until([&] { return engine.position_ms() > 520; });
    CHECK(engine.pause());
    std::this_thread::sleep_for(20ms);
    const double paused = engine.position_ms();
    std::this_thread::sleep_for(20ms);
    CHECK(engine.position_ms() == paused);
    CHECK(engine.seek(1200)); CHECK(engine.state() == EngineState::Paused);
    CHECK(engine.position_ms() == 1200);
    CHECK(engine.play());
    until([&] { return engine.position_ms() > 1220; });
    const double before_switch = engine.position_ms();
    // Reopening restores milliseconds as an integer source frame. Floating-point
    // truncation may move the snapshot back by one frame, never a whole buffer.
    const double frame_tolerance_ms = 1000.0 / engine.track_info().sample_rate + 1e-6;
    CHECK(engine.select_output_device(BackendType::WASAPI_SHARED, L"another-output"));
    CHECK(engine.state() == EngineState::Playing && engine.position_ms() + frame_tolerance_ms >= before_switch);
    const double before_resampler = engine.position_ms();
    CHECK(engine.set_resampler_config(true, 44100, 2));
    CHECK(engine.state() == EngineState::Playing && engine.position_ms() + frame_tolerance_ms >= before_resampler);
    const int opens = factory->shared->opens;
    std::atomic<int> transitions{0};
    engine.set_track_ended_callback([&](const std::string& reason, const std::string&) {
        if (reason == "transition") ++transitions;
    });
    CHECK(engine.set_next_track("recovery-short.wav"));
    CHECK(engine.seek(4700));
    until([&] { return engine.state() == EngineState::Stopped; });
    CHECK(transitions == 1 && factory->shared->opens == opens);
    CHECK(engine.open("recovery-long.wav"));
    CHECK(engine.state() == EngineState::Ready && engine.position_ms() == 0);
    CHECK(engine.play());
    engine.stop(); CHECK(engine.state() == EngineState::Idle);
    CHECK(!factory->shared->overlap);
}

static void resume_after_decoder_eof() {
    // Decode a buffered tail completely before allowing the device to drain it.
    // This reproduces pausing/resuming in the last buffered part of a song.
    std::atomic<int> decoder_stops{0};
    Logger::instance().set_callback([&](LogLevel, const std::string& message) {
        if (message.find("Decoder thread stopped") != std::string::npos) ++decoder_stops;
    });
    {
        auto factory = std::make_shared<FakeFactory>();
        factory->shared->hold_output = true;
        std::atomic<int> transitions{0}, ended{0};
        AudioEngine engine(factory);
        engine.set_track_ended_callback([&](const std::string& reason, const std::string&) {
            if (reason == "transition") ++transitions;
            else if (reason == "eof") ++ended;
        });
        auto config = engine.transition_config();
        config.pause_fade_enabled = false;
        CHECK(engine.set_transition_config(config));
        CHECK(engine.open("recovery-buffered.wav"));
        CHECK(engine.play());
        until([&] { return decoder_stops >= 1; });
        for (int attempt = 0; attempt < 3; ++attempt) {
            CHECK(engine.pause());
            CHECK(engine.play());
            until([&] { return decoder_stops >= attempt + 2; });
            CHECK(engine.state() == EngineState::Playing);
            CHECK(engine.position_ms() == 0);
        }
        // A paused seek must also be able to restart the finished worker.
        CHECK(engine.pause()); CHECK(engine.seek(20)); CHECK(engine.play());
        until([&] { return decoder_stops >= 5; });
        CHECK(engine.position_ms() == 20);
        CHECK(engine.pause());
        CHECK(engine.set_next_track("recovery-short.wav"));
        CHECK(engine.play());
        until([&] { return decoder_stops >= 6; });
        CHECK(factory->shared->opens == 1 && transitions == 0 && ended == 0);
        factory->shared->hold_output = false;
        until([&] { return ended == 1; });
        CHECK(transitions == 1);
        CHECK(engine.state() == EngineState::Stopped);
        engine.stop();
        CHECK(!factory->shared->overlap);
    }
    Logger::instance().set_callback({});
}

int main() {
    // Report fatal worker-lifecycle regressions without opening a system crash dialog.
    std::set_terminate([] {
        std::cerr << "Unexpected std::terminate during playback lifecycle\n";
        std::_Exit(86);
    });
    try {
        wave("recovery-short.wav", 256); wave("recovery-long.wav", 48000 * 5);
        wave("recovery-buffered.wav", 4800);
        eof_device_switch(); reset_and_seek_errors(); render_failure_stops_engine();
        restore_position_after_startup_device_selection();
        retry_failed_output_open(); normal_playback_lifecycle();
        resume_after_decoder_eof();
    } catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
    std::cout << "EOF switch, reset recovery, paused recovery, seek failure and buffered EOF resume passed\n";
}
