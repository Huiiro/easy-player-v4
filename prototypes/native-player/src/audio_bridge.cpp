#include "audio_engine.h"
#include "windows_backend_factory.h"

extern "C" {
struct PlaybackSnapshot {
    double position_ms;
    double duration_ms;
    int playing;
    int stopped;
    int glitches;
};

AudioEngine* ep_create(float volume) noexcept {
    try {
        auto engine = std::make_unique<AudioEngine>(std::make_shared<WindowsAudioBackendFactory>());
        if (!engine->set_backend(BackendType::WASAPI_SHARED)) return nullptr;
        engine->set_volume(volume);
        engine->set_analysis_enabled(false);
        return engine.release();
    } catch (...) { return nullptr; }
}

void ep_destroy(AudioEngine* engine) noexcept {
    delete engine;
}

int ep_open(AudioEngine* engine, const char* path) noexcept {
    try { return engine->open(path); } catch (...) { return 0; }
}

int ep_set_playing(AudioEngine* engine, int playing) noexcept {
    try { return playing ? engine->play() : engine->pause(); } catch (...) { return 0; }
}

int ep_seek(AudioEngine* engine, double ms) noexcept {
    try { return engine->seek(ms); } catch (...) { return 0; }
}

void ep_snapshot(AudioEngine* engine, PlaybackSnapshot* snapshot, int service_device) noexcept {
    try {
        if (service_device) engine->service_backend_events();
        const auto state = engine->state();
        *snapshot = {
            engine->position_ms(), engine->duration_ms(), state == EngineState::Playing,
            state == EngineState::Stopped, engine->glitch_count()
        };
    } catch (...) {}
}
}
