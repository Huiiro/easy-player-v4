#include "audio_engine.h"
#include "logger.h"
#include <napi.h>
#include <memory>
#include <string>

// ──────────────────────────────────────────────────────────
// N-API wrapper for AudioEngine
// ──────────────────────────────────────────────────────────

class AudioEngineWrapper : public Napi::ObjectWrap<AudioEngineWrapper> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "AudioEngine", {
            InstanceMethod("open", &AudioEngineWrapper::Open),
            InstanceMethod("play", &AudioEngineWrapper::Play),
            InstanceMethod("pause", &AudioEngineWrapper::Pause),
            InstanceMethod("stop", &AudioEngineWrapper::Stop),
            InstanceMethod("seek", &AudioEngineWrapper::Seek),
            InstanceMethod("setVolume", &AudioEngineWrapper::SetVolume),
            InstanceMethod("enumerateDevices", &AudioEngineWrapper::EnumerateDevices),
            InstanceMethod("setDevice", &AudioEngineWrapper::SetDevice),
            InstanceMethod("setBackend", &AudioEngineWrapper::SetBackend),
            InstanceMethod("getStatus", &AudioEngineWrapper::GetStatus),
            InstanceMethod("getGlitchCount", &AudioEngineWrapper::GetGlitchCount),
            InstanceMethod("onStateChanged", &AudioEngineWrapper::OnStateChanged),
            InstanceMethod("onPositionChanged", &AudioEngineWrapper::OnPositionChanged),
            InstanceMethod("onError", &AudioEngineWrapper::OnError),
            InstanceMethod("onLog", &AudioEngineWrapper::OnLog),
        });

        Napi::FunctionReference* constructor = new Napi::FunctionReference();
        *constructor = Napi::Persistent(func);
        env.SetInstanceData(constructor);

        exports.Set("AudioEngine", func);
        return exports;
    }

    AudioEngineWrapper(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<AudioEngineWrapper>(info)
        , engine_(std::make_unique<AudioEngine>())
    {
        // Wire engine callbacks to JS
        engine_->set_state_callback([this](EngineState state) {
            NotifyState(state);
        });
        engine_->set_position_callback([this](double pos_ms, double dur_ms) {
            NotifyPosition(pos_ms, dur_ms);
        });
        engine_->set_error_callback([this](int code, const std::string& msg) {
            NotifyError(code, msg);
        });

        // Wire logger to JS console
        Logger::instance().set_callback([this](LogLevel level, const std::string& msg) {
            NotifyLog(level, msg);
        });
    }

private:
    // ── Commands ──

    Napi::Value Open(const Napi::CallbackInfo& info) {
        std::string path = info[0].As<Napi::String>().Utf8Value();
        bool ok = engine_->open(path);
        return Napi::Boolean::New(info.Env(), ok);
    }

    Napi::Value Play(const Napi::CallbackInfo& info) {
        bool ok = engine_->play();
        return Napi::Boolean::New(info.Env(), ok);
    }

    Napi::Value Pause(const Napi::CallbackInfo& info) {
        bool ok = engine_->pause();
        return Napi::Boolean::New(info.Env(), ok);
    }

    Napi::Value Stop(const Napi::CallbackInfo& info) {
        bool ok = engine_->stop();
        return Napi::Boolean::New(info.Env(), ok);
    }

    Napi::Value Seek(const Napi::CallbackInfo& info) {
        double ms = info[0].As<Napi::Number>().DoubleValue();
        bool ok = engine_->seek(ms);
        return Napi::Boolean::New(info.Env(), ok);
    }

    Napi::Value SetVolume(const Napi::CallbackInfo& info) {
        float vol = info[0].As<Napi::Number>().FloatValue();
        engine_->set_volume(vol);
        return info.Env().Undefined();
    }

    Napi::Value EnumerateDevices(const Napi::CallbackInfo& info) {
        auto devices = engine_->enumerate_devices();
        auto arr = Napi::Array::New(info.Env(), devices.size());

        for (size_t i = 0; i < devices.size(); ++i) {
            auto obj = Napi::Object::New(info.Env());
            obj.Set("id", Napi::String::New(info.Env(),
                        std::string(devices[i].id.begin(), devices[i].id.end())));
            obj.Set("name", Napi::String::New(info.Env(),
                        std::string(devices[i].name.begin(), devices[i].name.end())));
            obj.Set("backend", Napi::String::New(info.Env(), "directsound"));
            obj.Set("isDefault", Napi::Boolean::New(info.Env(), devices[i].is_default));
            obj.Set("maxChannels", Napi::Number::New(info.Env(), devices[i].max_channels));
            arr.Set(i, obj);
        }
        return arr;
    }

    Napi::Value SetDevice(const Napi::CallbackInfo& info) {
        std::string id = info[0].As<Napi::String>().Utf8Value();
        engine_->set_device(std::wstring(id.begin(), id.end()));
        return info.Env().Undefined();
    }

    Napi::Value SetBackend(const Napi::CallbackInfo& info) {
        // Phase 0: only directsound available
        return info.Env().Undefined();
    }

    Napi::Value GetStatus(const Napi::CallbackInfo& info) {
        auto obj = Napi::Object::New(info.Env());
        obj.Set("state", Napi::Number::New(info.Env(), (int)engine_->state()));
        obj.Set("positionMs", Napi::Number::New(info.Env(), engine_->position_ms()));
        obj.Set("durationMs", Napi::Number::New(info.Env(), engine_->duration_ms()));
        obj.Set("volume", Napi::Number::New(info.Env(), engine_->volume()));
        obj.Set("glitchCount", Napi::Number::New(info.Env(), engine_->glitch_count()));

        auto& ti = engine_->track_info();
        auto tiObj = Napi::Object::New(info.Env());
        tiObj.Set("format", Napi::String::New(info.Env(), ti.format));
        tiObj.Set("sampleRate", Napi::Number::New(info.Env(), ti.sample_rate));
        tiObj.Set("bitDepth", Napi::Number::New(info.Env(), ti.bit_depth));
        tiObj.Set("channels", Napi::Number::New(info.Env(), ti.channels));
        tiObj.Set("durationMs", Napi::Number::New(info.Env(), ti.duration_ms));
        tiObj.Set("codecName", Napi::String::New(info.Env(), ti.codec_name));
        obj.Set("trackInfo", tiObj);

        return obj;
    }

    Napi::Value GetGlitchCount(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), engine_->glitch_count());
    }

    // ── Callback registration ──

    Napi::Value OnStateChanged(const Napi::CallbackInfo& info) {
        auto tsfn = Napi::ThreadSafeFunction::New(
            info.Env(), info[0].As<Napi::Function>(),
            "StateChanged", 0, 1);
        state_tsfn_ = std::make_unique<Napi::ThreadSafeFunction>(std::move(tsfn));
        return info.Env().Undefined();
    }

    Napi::Value OnPositionChanged(const Napi::CallbackInfo& info) {
        auto tsfn = Napi::ThreadSafeFunction::New(
            info.Env(), info[0].As<Napi::Function>(),
            "PositionChanged", 0, 1);
        pos_tsfn_ = std::make_unique<Napi::ThreadSafeFunction>(std::move(tsfn));
        return info.Env().Undefined();
    }

    Napi::Value OnError(const Napi::CallbackInfo& info) {
        auto tsfn = Napi::ThreadSafeFunction::New(
            info.Env(), info[0].As<Napi::Function>(),
            "Error", 0, 1);
        error_tsfn_ = std::make_unique<Napi::ThreadSafeFunction>(std::move(tsfn));
        return info.Env().Undefined();
    }

    Napi::Value OnLog(const Napi::CallbackInfo& info) {
        auto tsfn = Napi::ThreadSafeFunction::New(
            info.Env(), info[0].As<Napi::Function>(),
            "Log", 0, 1);
        log_tsfn_ = std::make_unique<Napi::ThreadSafeFunction>(std::move(tsfn));
        return info.Env().Undefined();
    }

    // ── Notification helpers (called from engine threads) ──

    void NotifyState(EngineState state) {
        if (!state_tsfn_) return;
        int s = (int)state;
        state_tsfn_->BlockingCall([s](Napi::Env env, Napi::Function jsCallback) {
            jsCallback.Call({Napi::Number::New(env, s)});
        });
    }

    void NotifyPosition(double pos_ms, double dur_ms) {
        if (!pos_tsfn_) return;
        double p = pos_ms, d = dur_ms;
        pos_tsfn_->BlockingCall([p, d](Napi::Env env, Napi::Function jsCallback) {
            jsCallback.Call({
                Napi::Number::New(env, p),
                Napi::Number::New(env, d)
            });
        });
    }

    void NotifyError(int code, const std::string& msg) {
        if (!error_tsfn_) return;
        int c = code;
        std::string m = msg;
        error_tsfn_->BlockingCall([c, m](Napi::Env env, Napi::Function jsCallback) {
            jsCallback.Call({
                Napi::Number::New(env, c),
                Napi::String::New(env, m)
            });
        });
    }

    void NotifyLog(LogLevel level, const std::string& msg) {
        if (!log_tsfn_) return;
        int lv = (int)level;
        std::string m = msg;
        log_tsfn_->BlockingCall([lv, m](Napi::Env env, Napi::Function jsCallback) {
            jsCallback.Call({
                Napi::Number::New(env, lv),
                Napi::String::New(env, m)
            });
        });
    }

    // ── Members ──
    std::unique_ptr<AudioEngine> engine_;

    std::unique_ptr<Napi::ThreadSafeFunction> state_tsfn_;
    std::unique_ptr<Napi::ThreadSafeFunction> pos_tsfn_;
    std::unique_ptr<Napi::ThreadSafeFunction> error_tsfn_;
    std::unique_ptr<Napi::ThreadSafeFunction> log_tsfn_;
};

// ── Module registration ──
Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
    return AudioEngineWrapper::Init(env, exports);
}

NODE_API_MODULE(easy_player_native, InitModule)
