#include "audio_engine.h"
#include "logger.h"
#include <napi.h>
#include <memory>
#include <string>
#define NOMINMAX
#include <windows.h>

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
            InstanceMethod("setPreamp", &AudioEngineWrapper::SetPreamp),
            InstanceMethod("setReplayGain", &AudioEngineWrapper::SetReplayGain),
            InstanceMethod("getReplayGain", &AudioEngineWrapper::GetReplayGain),
            InstanceMethod("setPlaybackSpeed", &AudioEngineWrapper::SetPlaybackSpeed),
            InstanceMethod("getPlaybackSpeed", &AudioEngineWrapper::GetPlaybackSpeed),
            InstanceMethod("setEqBands", &AudioEngineWrapper::SetEqBands),
            InstanceMethod("getEqBands", &AudioEngineWrapper::GetEqBands),
            InstanceMethod("setResamplerConfig", &AudioEngineWrapper::SetResamplerConfig),
            InstanceMethod("getResamplerConfig", &AudioEngineWrapper::GetResamplerConfig),
            InstanceMethod("setDopEnabled", &AudioEngineWrapper::SetDopEnabled),
            InstanceMethod("getDopEnabled", &AudioEngineWrapper::GetDopEnabled),
            InstanceMethod("setDspNodes", &AudioEngineWrapper::SetDspNodes),
            InstanceMethod("getDspNodes", &AudioEngineWrapper::GetDspNodes),
            InstanceMethod("setCompressorConfig", &AudioEngineWrapper::SetCompressorConfig),
            InstanceMethod("getCompressorConfig", &AudioEngineWrapper::GetCompressorConfig),
            InstanceMethod("setDelayConfig", &AudioEngineWrapper::SetDelayConfig),
            InstanceMethod("getDelayConfig", &AudioEngineWrapper::GetDelayConfig),
            InstanceMethod("setReverbConfig", &AudioEngineWrapper::SetReverbConfig),
            InstanceMethod("getReverbConfig", &AudioEngineWrapper::GetReverbConfig),
            InstanceMethod("setChorusConfig", &AudioEngineWrapper::SetChorusConfig),
            InstanceMethod("getChorusConfig", &AudioEngineWrapper::GetChorusConfig),
            InstanceMethod("setNoiseGateConfig", &AudioEngineWrapper::SetNoiseGateConfig),
            InstanceMethod("getNoiseGateConfig", &AudioEngineWrapper::GetNoiseGateConfig),
            InstanceMethod("setPhaserConfig", &AudioEngineWrapper::SetPhaserConfig),
            InstanceMethod("getPhaserConfig", &AudioEngineWrapper::GetPhaserConfig),
            InstanceMethod("setChannelMatrixConfig", &AudioEngineWrapper::SetChannelMatrixConfig),
            InstanceMethod("getChannelMatrixConfig", &AudioEngineWrapper::GetChannelMatrixConfig),
            InstanceMethod("setLimiter", &AudioEngineWrapper::SetLimiter),
            InstanceMethod("getLimiter", &AudioEngineWrapper::GetLimiter),
            InstanceMethod("setTransitionConfig", &AudioEngineWrapper::SetTransitionConfig),
            InstanceMethod("getTransitionConfig", &AudioEngineWrapper::GetTransitionConfig),
            InstanceMethod("enumerateDevices", &AudioEngineWrapper::EnumerateDevices),
            InstanceMethod("setDevice", &AudioEngineWrapper::SetDevice),
            InstanceMethod("setBackend", &AudioEngineWrapper::SetBackend),
            InstanceMethod("selectOutputDevice", &AudioEngineWrapper::SelectOutputDevice),
            InstanceMethod("getStatus", &AudioEngineWrapper::GetStatus),
            InstanceMethod("getAudioChain", &AudioEngineWrapper::GetAudioChain),
            InstanceMethod("getAudioAnalysis", &AudioEngineWrapper::GetAudioAnalysis),
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

    Napi::Value SetPreamp(const Napi::CallbackInfo& info) {
        const float db = info[0].As<Napi::Number>().FloatValue();
        const bool enabled = info[1].As<Napi::Boolean>().Value();
        engine_->set_preamp_db(db, enabled);
        return info.Env().Undefined();
    }
    Napi::Value SetReplayGain(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return Napi::Boolean::New(info.Env(), false);
        const auto v = info[0].As<Napi::Object>();
        const std::string mode = v.Get("mode").ToString().Utf8Value();
        engine_->set_replay_gain_mode(mode == "track" ? 1 : mode == "album" ? 2 : 0, v.Get("preventClipping").ToBoolean().Value());
        return Napi::Boolean::New(info.Env(), true);
    }
    Napi::Value GetReplayGain(const Napi::CallbackInfo& info) {
        const auto c = engine_->replay_gain_config(); auto v = Napi::Object::New(info.Env());
        v.Set("mode", Napi::String::New(info.Env(), engine_->replay_gain_mode() == 1 ? "track" : engine_->replay_gain_mode() == 2 ? "album" : "off"));
        v.Set("preventClipping", Napi::Boolean::New(info.Env(), engine_->replay_gain_prevent_clipping()));
        v.Set("active", Napi::Boolean::New(info.Env(), c.enabled)); v.Set("appliedGainDb", Napi::Number::New(info.Env(), c.gain_db));
        return v;
    }
    Napi::Value SetPlaybackSpeed(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return Napi::Boolean::New(info.Env(), false);
        const auto v = info[0].As<Napi::Object>();
        return Napi::Boolean::New(info.Env(), engine_->set_playback_speed_config({v.Get("enabled").ToBoolean().Value(), v.Get("speed").ToNumber().FloatValue()}));
    }
    Napi::Value GetPlaybackSpeed(const Napi::CallbackInfo& info) {
        const auto c = engine_->playback_speed_config(); auto v = Napi::Object::New(info.Env());
        v.Set("enabled", Napi::Boolean::New(info.Env(), c.enabled)); v.Set("speed", Napi::Number::New(info.Env(), c.speed)); return v;
    }

    Napi::Value SetEqBands(const Napi::CallbackInfo& info) {
        if (!info[0].IsArray()) {
            LOG_WARN("N-API setEqBands rejected: payload is not an array");
            return Napi::Boolean::New(info.Env(), false);
        }
        auto values = info[0].As<Napi::Array>();
        if (values.Length() != kEqBandCount) {
            LOG_WARN("N-API setEqBands rejected: expected " +
                     std::to_string(kEqBandCount) + " bands, got " +
                     std::to_string(values.Length()));
            return Napi::Boolean::New(info.Env(), false);
        }

        LOG_INFO("N-API setEqBands received: 20 bands");

        std::array<EqBand, kEqBandCount> bands;
        for (int i = 0; i < kEqBandCount; ++i) {
            auto value = values.Get(i);
            if (!value.IsObject()) {
                LOG_WARN("N-API setEqBands rejected: band " + std::to_string(i) + " is not an object");
                return Napi::Boolean::New(info.Env(), false);
            }
            auto band = value.As<Napi::Object>();
            bands[i].enabled = band.Get("enabled").ToBoolean().Value();
            bands[i].frequency_hz = band.Get("frequencyHz").ToNumber().FloatValue();
            bands[i].gain_db = band.Get("gainDb").ToNumber().FloatValue();
            bands[i].q = band.Get("q").ToNumber().FloatValue();
        }
        return Napi::Boolean::New(info.Env(), engine_->set_eq_bands(bands));
    }

    Napi::Value GetEqBands(const Napi::CallbackInfo& info) {
        const auto bands = engine_->eq_bands();
        auto values = Napi::Array::New(info.Env(), kEqBandCount);
        for (int i = 0; i < kEqBandCount; ++i) {
            auto band = Napi::Object::New(info.Env());
            band.Set("enabled", Napi::Boolean::New(info.Env(), bands[i].enabled));
            band.Set("frequencyHz", Napi::Number::New(info.Env(), bands[i].frequency_hz));
            band.Set("gainDb", Napi::Number::New(info.Env(), bands[i].gain_db));
            band.Set("q", Napi::Number::New(info.Env(), bands[i].q));
            values.Set(i, band);
        }
        return values;
    }

    Napi::Value SetResamplerConfig(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return Napi::Boolean::New(info.Env(), false);
        const auto config = info[0].As<Napi::Object>();
        const bool force = config.Get("forceOutputRate").ToBoolean().Value();
        const int rate = config.Get("targetSampleRate").ToNumber().Int32Value();
        const std::string quality = config.Get("quality").ToString().Utf8Value();
        const int quality_value = quality == "medium" ? 1 : quality == "fast" ? 2 : 0;
        return Napi::Boolean::New(info.Env(),
                                  engine_->set_resampler_config(force, rate, quality_value));
    }

    Napi::Value GetResamplerConfig(const Napi::CallbackInfo& info) {
        auto config = Napi::Object::New(info.Env());
        config.Set("forceOutputRate", Napi::Boolean::New(info.Env(), engine_->force_output_rate()));
        config.Set("targetSampleRate", Napi::Number::New(info.Env(), engine_->target_sample_rate()));
        const int quality = engine_->resampler_quality();
        config.Set("quality", Napi::String::New(info.Env(),
            quality == 1 ? "medium" : quality == 2 ? "fast" : "best"));
        return config;
    }

    Napi::Value SetDopEnabled(const Napi::CallbackInfo& info) {
        if (!info[0].IsBoolean()) return Napi::Boolean::New(info.Env(), false);
        engine_->set_dop_enabled(info[0].As<Napi::Boolean>().Value());
        return Napi::Boolean::New(info.Env(), true);
    }

    Napi::Value GetDopEnabled(const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), engine_->dop_enabled());
    }

    Napi::Value SetDspNodes(const Napi::CallbackInfo& info) {
        if (!info[0].IsArray()) return Napi::Boolean::New(info.Env(), false);
        const auto values = info[0].As<Napi::Array>();
        std::vector<DspNodeConfig> nodes;
        nodes.reserve(values.Length());
        for (uint32_t i = 0; i < values.Length(); ++i) {
            const auto value = values.Get(i);
            if (!value.IsObject()) return Napi::Boolean::New(info.Env(), false);
            const auto node = value.As<Napi::Object>();
            nodes.push_back({node.Get("id").ToString().Utf8Value(),
                             node.Get("enabled").ToBoolean().Value()});
        }
        return Napi::Boolean::New(info.Env(), engine_->set_dsp_nodes(nodes));
    }

    Napi::Value GetDspNodes(const Napi::CallbackInfo& info) {
        const auto nodes = engine_->dsp_nodes();
        auto values = Napi::Array::New(info.Env(), nodes.size());
        for (size_t i = 0; i < nodes.size(); ++i) {
            auto node = Napi::Object::New(info.Env());
            node.Set("id", Napi::String::New(info.Env(), nodes[i].id));
            node.Set("enabled", Napi::Boolean::New(info.Env(), nodes[i].enabled));
            values.Set(i, node);
        }
        return values;
    }

    Napi::Value SetCompressorConfig(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return Napi::Boolean::New(info.Env(), false);
        const auto value = info[0].As<Napi::Object>();
        CompressorConfig config;
        config.threshold_db = value.Get("thresholdDb").ToNumber().FloatValue();
        config.ratio = value.Get("ratio").ToNumber().FloatValue();
        config.attack_ms = value.Get("attackMs").ToNumber().FloatValue();
        config.release_ms = value.Get("releaseMs").ToNumber().FloatValue();
        config.makeup_db = value.Get("makeupDb").ToNumber().FloatValue();
        return Napi::Boolean::New(info.Env(), engine_->set_compressor_config(config));
    }

    Napi::Value GetCompressorConfig(const Napi::CallbackInfo& info) {
        const auto config = engine_->compressor_config();
        auto value = Napi::Object::New(info.Env());
        value.Set("thresholdDb", Napi::Number::New(info.Env(), config.threshold_db));
        value.Set("ratio", Napi::Number::New(info.Env(), config.ratio));
        value.Set("attackMs", Napi::Number::New(info.Env(), config.attack_ms));
        value.Set("releaseMs", Napi::Number::New(info.Env(), config.release_ms));
        value.Set("makeupDb", Napi::Number::New(info.Env(), config.makeup_db));
        return value;
    }

    Napi::Value SetDelayConfig(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return Napi::Boolean::New(info.Env(), false);
        const auto value = info[0].As<Napi::Object>();
        DelayConfig config;
        config.delay_ms = value.Get("delayMs").ToNumber().FloatValue();
        config.feedback = value.Get("feedback").ToNumber().FloatValue();
        config.mix = value.Get("mix").ToNumber().FloatValue();
        return Napi::Boolean::New(info.Env(), engine_->set_delay_config(config));
    }

    Napi::Value GetDelayConfig(const Napi::CallbackInfo& info) {
        const auto config = engine_->delay_config(); auto value = Napi::Object::New(info.Env());
        value.Set("delayMs", Napi::Number::New(info.Env(), config.delay_ms));
        value.Set("feedback", Napi::Number::New(info.Env(), config.feedback));
        value.Set("mix", Napi::Number::New(info.Env(), config.mix)); return value;
    }
    Napi::Value SetReverbConfig(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return Napi::Boolean::New(info.Env(), false);
        const auto v = info[0].As<Napi::Object>();
        return Napi::Boolean::New(info.Env(), engine_->set_reverb_config({
            v.Get("roomSize").ToNumber().FloatValue(), v.Get("decay").ToNumber().FloatValue(),
            v.Get("mix").ToNumber().FloatValue()}));
    }
    Napi::Value GetReverbConfig(const Napi::CallbackInfo& info) {
        const auto c = engine_->reverb_config(); auto v = Napi::Object::New(info.Env());
        v.Set("roomSize", Napi::Number::New(info.Env(), c.room_size)); v.Set("decay", Napi::Number::New(info.Env(), c.decay));
        v.Set("mix", Napi::Number::New(info.Env(), c.mix)); return v;
    }
    Napi::Value SetChorusConfig(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return Napi::Boolean::New(info.Env(), false);
        const auto v = info[0].As<Napi::Object>();
        return Napi::Boolean::New(info.Env(), engine_->set_chorus_config({
            v.Get("rateHz").ToNumber().FloatValue(), v.Get("depthMs").ToNumber().FloatValue(),
            v.Get("mix").ToNumber().FloatValue()}));
    }
    Napi::Value GetChorusConfig(const Napi::CallbackInfo& info) {
        const auto c = engine_->chorus_config(); auto v = Napi::Object::New(info.Env());
        v.Set("rateHz", Napi::Number::New(info.Env(), c.rate_hz)); v.Set("depthMs", Napi::Number::New(info.Env(), c.depth_ms));
        v.Set("mix", Napi::Number::New(info.Env(), c.mix)); return v;
    }
    Napi::Value SetNoiseGateConfig(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return Napi::Boolean::New(info.Env(), false);
        const auto v = info[0].As<Napi::Object>();
        return Napi::Boolean::New(info.Env(), engine_->set_noise_gate_config({
            v.Get("thresholdDb").ToNumber().FloatValue(), v.Get("attackMs").ToNumber().FloatValue(),
            v.Get("holdMs").ToNumber().FloatValue(), v.Get("releaseMs").ToNumber().FloatValue(),
            v.Get("rangeDb").ToNumber().FloatValue()}));
    }
    Napi::Value GetNoiseGateConfig(const Napi::CallbackInfo& info) {
        const auto c = engine_->noise_gate_config(); auto v = Napi::Object::New(info.Env());
        v.Set("thresholdDb", Napi::Number::New(info.Env(), c.threshold_db)); v.Set("attackMs", Napi::Number::New(info.Env(), c.attack_ms));
        v.Set("holdMs", Napi::Number::New(info.Env(), c.hold_ms)); v.Set("releaseMs", Napi::Number::New(info.Env(), c.release_ms));
        v.Set("rangeDb", Napi::Number::New(info.Env(), c.range_db)); return v;
    }
    Napi::Value SetPhaserConfig(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return Napi::Boolean::New(info.Env(), false);
        const auto v = info[0].As<Napi::Object>();
        return Napi::Boolean::New(info.Env(), engine_->set_phaser_config({
            v.Get("rateHz").ToNumber().FloatValue(), v.Get("depth").ToNumber().FloatValue(),
            v.Get("centerHz").ToNumber().FloatValue(), v.Get("feedback").ToNumber().FloatValue(),
            v.Get("mix").ToNumber().FloatValue()}));
    }
    Napi::Value GetPhaserConfig(const Napi::CallbackInfo& info) {
        const auto c = engine_->phaser_config(); auto v = Napi::Object::New(info.Env());
        v.Set("rateHz", Napi::Number::New(info.Env(), c.rate_hz)); v.Set("depth", Napi::Number::New(info.Env(), c.depth));
        v.Set("centerHz", Napi::Number::New(info.Env(), c.center_hz)); v.Set("feedback", Napi::Number::New(info.Env(), c.feedback));
        v.Set("mix", Napi::Number::New(info.Env(), c.mix)); return v;
    }
    Napi::Value SetChannelMatrixConfig(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return Napi::Boolean::New(info.Env(), false);
        const auto v = info[0].As<Napi::Object>();
        ChannelMatrixConfig config{};
        config.enabled = v.Get("enabled").ToBoolean().Value(); config.balance = v.Get("balance").ToNumber().FloatValue();
        config.swap_stereo = v.Get("swapStereo").ToBoolean().Value(); config.mono_downmix = v.Get("monoDownmix").ToBoolean().Value();
        const auto gains = v.Get("outputGains");
        if (gains.IsArray()) { const auto values = gains.As<Napi::Array>(); for (uint32_t i = 0; i < std::min<uint32_t>(values.Length(), kMaxAudioChannels); ++i) config.output_gains[i] = values.Get(i).ToNumber().FloatValue(); }
        return Napi::Boolean::New(info.Env(), engine_->set_channel_matrix_config(config));
    }
    Napi::Value GetChannelMatrixConfig(const Napi::CallbackInfo& info) {
        const auto c = engine_->channel_matrix_config(); auto v = Napi::Object::New(info.Env());
        v.Set("enabled", Napi::Boolean::New(info.Env(), c.enabled)); v.Set("balance", Napi::Number::New(info.Env(), c.balance));
        v.Set("swapStereo", Napi::Boolean::New(info.Env(), c.swap_stereo)); v.Set("monoDownmix", Napi::Boolean::New(info.Env(), c.mono_downmix));
        auto gains = Napi::Array::New(info.Env(), kMaxAudioChannels); for (uint32_t i = 0; i < kMaxAudioChannels; ++i) gains.Set(i, Napi::Number::New(info.Env(), c.output_gains[i])); v.Set("outputGains", gains); return v;
    }
    Napi::Value SetLimiter(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return Napi::Boolean::New(info.Env(), false);
        const auto v = info[0].As<Napi::Object>(); engine_->set_limiter_enabled(v.Get("enabled").ToBoolean().Value());
        return Napi::Boolean::New(info.Env(), engine_->set_limiter_config({v.Get("ceilingDb").ToNumber().FloatValue(), v.Get("releaseMs").ToNumber().FloatValue()}));
    }
    Napi::Value GetLimiter(const Napi::CallbackInfo& info) {
        const auto c = engine_->limiter_config(); auto v=Napi::Object::New(info.Env());
        v.Set("enabled", Napi::Boolean::New(info.Env(), engine_->limiter_enabled())); v.Set("ceilingDb", Napi::Number::New(info.Env(), c.ceiling_db)); v.Set("releaseMs", Napi::Number::New(info.Env(), c.release_ms)); return v;
    }
    Napi::Value SetTransitionConfig(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return Napi::Boolean::New(info.Env(), false);
        const auto v = info[0].As<Napi::Object>();
        return Napi::Boolean::New(info.Env(), engine_->set_transition_config({
            v.Get("gaplessEnabled").ToBoolean().Value(),
            v.Get("crossfadeEnabled").ToBoolean().Value(),
            v.Get("crossfadeMs").ToNumber().Int32Value()
        }));
    }
    Napi::Value GetTransitionConfig(const Napi::CallbackInfo& info) {
        const auto c = engine_->transition_config(); auto v = Napi::Object::New(info.Env());
        v.Set("gaplessEnabled", Napi::Boolean::New(info.Env(), c.gapless_enabled));
        v.Set("crossfadeEnabled", Napi::Boolean::New(info.Env(), c.crossfade_enabled));
        v.Set("crossfadeMs", Napi::Number::New(info.Env(), c.crossfade_ms)); return v;
    }

    Napi::Value EnumerateDevices(const Napi::CallbackInfo& info) {
        auto devices = engine_->enumerate_devices();
        auto arr = Napi::Array::New(info.Env(), devices.size());

        for (size_t i = 0; i < devices.size(); ++i) {
            auto obj = Napi::Object::New(info.Env());

            // Convert wide strings to UTF-8 (fixes CJK encoding)
            auto wide_to_utf8 = [](const std::wstring& ws) -> std::string {
                if (ws.empty()) return {};
                int len = WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), -1,
                                              nullptr, 0, nullptr, nullptr);
                if (len <= 0) return {};
                std::string result(len - 1, '\0');
                WideCharToMultiByte(CP_UTF8, 0, ws.c_str(), -1,
                                    &result[0], len, nullptr, nullptr);
                return result;
            };

            obj.Set("id", Napi::String::New(info.Env(),
                        wide_to_utf8(devices[i].id)));
            obj.Set("name", Napi::String::New(info.Env(),
                        wide_to_utf8(devices[i].name)));
            // Map BackendType enum to string
            const char* backend_str = "directsound";
            switch (devices[i].backend) {
                case BackendType::WASAPI_SHARED:    backend_str = "wasapi_shared"; break;
                case BackendType::WASAPI_EXCLUSIVE: backend_str = "wasapi_exclusive"; break;
                case BackendType::ASIO:             backend_str = "asio"; break;
                default:                            backend_str = "directsound"; break;
            }
            obj.Set("backend", Napi::String::New(info.Env(), backend_str));
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
        std::string backend = info[0].As<Napi::String>().Utf8Value();
        BackendType type;
        if (backend == "wasapi_shared")      type = BackendType::WASAPI_SHARED;
        else if (backend == "wasapi_exclusive") type = BackendType::WASAPI_EXCLUSIVE;
        else if (backend == "asio")             type = BackendType::ASIO;
        else                                    type = BackendType::DIRECTSOUND;
        bool ok = engine_->set_backend(type);
        return Napi::Boolean::New(info.Env(), ok);
    }

    Napi::Value SelectOutputDevice(const Napi::CallbackInfo& info) {
        std::string backend = info[0].As<Napi::String>().Utf8Value();
        std::string id = info[1].As<Napi::String>().Utf8Value();
        BackendType type;
        if (backend == "wasapi_shared")      type = BackendType::WASAPI_SHARED;
        else if (backend == "wasapi_exclusive") type = BackendType::WASAPI_EXCLUSIVE;
        else if (backend == "asio")             type = BackendType::ASIO;
        else                                      type = BackendType::DIRECTSOUND;
        return Napi::Boolean::New(info.Env(), engine_->select_output_device(
            type, std::wstring(id.begin(), id.end())));
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
        tiObj.Set("isDsd", Napi::Boolean::New(info.Env(), ti.is_dsd));
        tiObj.Set("dsdSampleRate", Napi::Number::New(info.Env(), ti.dsd_sample_rate));
        tiObj.Set("dsdTransport", Napi::String::New(info.Env(), ti.dsd_transport));
        obj.Set("trackInfo", tiObj);

        return obj;
    }

    Napi::Value GetGlitchCount(const Napi::CallbackInfo& info) {
        return Napi::Number::New(info.Env(), engine_->glitch_count());
    }

    Napi::Value GetAudioChain(const Napi::CallbackInfo& info) {
        const auto chain = engine_->audio_chain_status();
        const auto make_format = [&info](const AudioFormat& format) {
            auto obj = Napi::Object::New(info.Env());
            obj.Set("sampleRate", Napi::Number::New(info.Env(), format.sample_rate));
            obj.Set("bitDepth", Napi::Number::New(info.Env(), format.bit_depth));
            obj.Set("channels", Napi::Number::New(info.Env(), format.channels));
            return obj;
        };
        const auto make_strings = [&info](const std::vector<std::string>& values) {
            auto arr = Napi::Array::New(info.Env(), values.size());
            for (size_t i = 0; i < values.size(); ++i) {
                arr.Set(i, Napi::String::New(info.Env(), values[i]));
            }
            return arr;
        };

        auto obj = Napi::Object::New(info.Env());
        obj.Set("sourceFormat", make_format(chain.source_format));
        obj.Set("backendFormat", make_format(chain.backend_format));
        obj.Set("activeNodes", make_strings(chain.active_nodes));
        obj.Set("bypassedNodes", make_strings(chain.bypassed_nodes));
        obj.Set("bitPerfectBlockers", make_strings(chain.bit_perfect_blockers));
        obj.Set("isBitPerfectEligible", Napi::Boolean::New(info.Env(), chain.is_bit_perfect_eligible));
        obj.Set("bitPerfectVerificationState", Napi::String::New(info.Env(), chain.bit_perfect_verification_state));
        obj.Set("isBitPerfect", Napi::Boolean::New(info.Env(), chain.is_bit_perfect));
        return obj;
    }
    Napi::Value GetAudioAnalysis(const Napi::CallbackInfo& info) {
        const auto value = engine_->audio_analysis_snapshot(); auto obj = Napi::Object::New(info.Env());
        obj.Set("outputTimeMs", Napi::Number::New(info.Env(), value.output_time_ms)); obj.Set("analysisTimeMs", Napi::Number::New(info.Env(), value.analysis_time_ms)); obj.Set("analysisLatencyMs", Napi::Number::New(info.Env(), value.analysis_latency_ms)); obj.Set("rms", Napi::Number::New(info.Env(), value.rms));
        obj.Set("lowEnergy", Napi::Number::New(info.Env(), value.low_energy)); obj.Set("onsetStrength", Napi::Number::New(info.Env(), value.onset_strength));
        obj.Set("droppedFrames", Napi::Number::New(info.Env(), static_cast<double>(value.dropped_frames)));
        obj.Set("beatSequence", Napi::Number::New(info.Env(), static_cast<double>(value.beat_sequence)));
        obj.Set("bpm", Napi::Number::New(info.Env(), value.bpm));
        obj.Set("momentaryLufs", Napi::Number::New(info.Env(), value.momentary_lufs));
        obj.Set("shortTermLufs", Napi::Number::New(info.Env(), value.short_term_lufs));
        obj.Set("integratedLufs", Napi::Number::New(info.Env(), value.integrated_lufs));
        auto spectrum = Napi::Array::New(info.Env(), value.spectrum.size()); for (size_t i = 0; i < value.spectrum.size(); ++i) spectrum.Set(i, Napi::Number::New(info.Env(), value.spectrum[i])); obj.Set("spectrum", spectrum); return obj;
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
        state_tsfn_->NonBlockingCall([s](Napi::Env env, Napi::Function jsCallback) {
            jsCallback.Call({Napi::Number::New(env, s)});
        });
    }

    void NotifyPosition(double pos_ms, double dur_ms) {
        if (!pos_tsfn_) return;
        double p = pos_ms, d = dur_ms;
        pos_tsfn_->NonBlockingCall([p, d](Napi::Env env, Napi::Function jsCallback) {
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
        error_tsfn_->NonBlockingCall([c, m](Napi::Env env, Napi::Function jsCallback) {
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
        log_tsfn_->NonBlockingCall([lv, m](Napi::Env env, Napi::Function jsCallback) {
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
