#include "audio_engine.h"
#include "logger.h"
#include "ffmpeg_logging.h"
#ifdef EASY_PLAYER_MACOS
#include "macos_backend_factory.h"
using PlatformAudioBackendFactory = MacOSAudioBackendFactory;
#else
#include "windows_backend_factory.h"
using PlatformAudioBackendFactory = WindowsAudioBackendFactory;
#include <windows.h>
#endif
#include <napi.h>
#include <memory>
#include <mutex>
#include <string>
#include <filesystem>
#include <map>
#include <exception>
#include <system_error>
#include <chrono>
#include <initializer_list>
#include <sstream>
extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/dict.h>
}

static const char* state_name(EngineState state) {
    switch (state) {
        case EngineState::Idle: return "idle";
        case EngineState::Loading: return "loading";
        case EngineState::Ready: return "ready";
        case EngineState::Playing: return "playing";
        case EngineState::Paused: return "paused";
        case EngineState::Stopped: return "stopped";
    }
    return "unknown";
}

static std::string format_params(std::initializer_list<std::pair<const char*, double>> values) {
    std::ostringstream output;
    for (const auto& value : values) {
        if (output.tellp() > 0) output << ", ";
        output << value.first << "=" << value.second;
    }
    return output.str();
}

// Describe scalar arguments without serializing arbitrary objects or invoking
// getters. Setters replace this summary with the values they actually parse.
static std::string describe_arguments(const Napi::CallbackInfo& info) {
    if (info.Length() == 0) return "no arguments";
    std::ostringstream output;
    for (size_t i = 0; i < info.Length(); ++i) {
        if (i) output << ", ";
        output << "arg" << i << "=";
        const auto value = info[i];
        if (value.IsString()) {
            const auto text = value.As<Napi::String>().Utf8Value();
            output << '"' << text.substr(0, 512) << (text.size() > 512 ? "..." : "") << '"';
        } else if (value.IsNumber()) output << value.As<Napi::Number>().DoubleValue();
        else if (value.IsBoolean()) output << (value.As<Napi::Boolean>().Value() ? "true" : "false");
        else if (value.IsArray()) output << "array(length=" << value.As<Napi::Array>().Length() << ")";
        else if (value.IsNull()) output << "null";
        else if (value.IsUndefined()) output << "undefined";
        else output << "object";
    }
    return output.str();
}

// Set the field before invoking a JS getter or coercion, so exceptions identify
// the property that failed without evaluating the object's other properties.
static Napi::Value read_property(const Napi::Object& object, const char* field,
                                 std::string& parameters) {
    parameters += "; reading_field=" + std::string(field);
    return object.Get(field);
}

static bool rewrite_metadata(const std::string& source, const std::map<std::string, std::string>& tags, const std::string& cover_path, std::string& error) {
    ScopedFFmpegLogContext log_context(source, "rewrite-metadata");
    AVFormatContext* input = nullptr;
    AVFormatContext* output = nullptr;
    AVFormatContext* cover = nullptr;
    int cover_stream = -1;
    int cover_output_stream = -1;
    std::error_code rename_error;
    const std::filesystem::path source_path(source);
    const auto temporary = (source_path.parent_path() / (source_path.stem().string() + ".easy-player-meta-tmp" + source_path.extension().string())).string();
    if (avformat_open_input(&input, source.c_str(), nullptr, nullptr) < 0 || avformat_find_stream_info(input, nullptr) < 0) { error = "Unable to open media file"; goto done; }
    if (!cover_path.empty()) { if (avformat_open_input(&cover, cover_path.c_str(), nullptr, nullptr) < 0 || avformat_find_stream_info(cover, nullptr) < 0) { error = "Unable to open cover image"; goto done; } cover_stream = av_find_best_stream(cover, AVMEDIA_TYPE_VIDEO, -1, -1, nullptr, 0); if (cover_stream < 0) { error = "Cover image has no video stream"; goto done; } }
    if (avformat_alloc_output_context2(&output, nullptr, nullptr, temporary.c_str()) < 0 || !output) { error = "Unable to create output container"; goto done; }
    av_dict_copy(&output->metadata, input->metadata, 0);
    for (const auto& [key, value] : tags) { if (value.empty()) av_dict_set(&output->metadata, key.c_str(), nullptr, 0); else av_dict_set(&output->metadata, key.c_str(), value.c_str(), 0); }
    for (unsigned i = 0; i < input->nb_streams; ++i) { AVStream* in = input->streams[i]; if (!cover_path.empty() && in->codecpar->codec_type == AVMEDIA_TYPE_VIDEO && (in->disposition & AV_DISPOSITION_ATTACHED_PIC)) continue; AVStream* out = avformat_new_stream(output, nullptr); if (!out || avcodec_parameters_copy(out->codecpar, in->codecpar) < 0) { error = "Unable to copy media stream"; goto done; } out->time_base = in->time_base; av_dict_copy(&out->metadata, in->metadata, 0); }
    if (cover_stream >= 0) { AVStream* in = cover->streams[cover_stream]; AVStream* out = avformat_new_stream(output, nullptr); if (!out || avcodec_parameters_copy(out->codecpar, in->codecpar) < 0) { error = "Unable to copy cover stream"; goto done; } out->time_base = in->time_base; out->disposition |= AV_DISPOSITION_ATTACHED_PIC; cover_output_stream = out->index; }
    if (!(output->oformat->flags & AVFMT_NOFILE) && avio_open(&output->pb, temporary.c_str(), AVIO_FLAG_WRITE) < 0) { error = "Unable to create temporary file"; goto done; }
    if (avformat_write_header(output, nullptr) < 0) { error = "Unable to write metadata header"; goto done; }
    if (cover_stream >= 0) { AVPacket packet; av_init_packet(&packet); while (av_read_frame(cover, &packet) >= 0) { if (packet.stream_index == cover_stream) { AVStream* in = cover->streams[cover_stream]; AVStream* out = output->streams[cover_output_stream]; packet.stream_index = cover_output_stream; av_packet_rescale_ts(&packet, in->time_base, out->time_base); const int result = av_interleaved_write_frame(output, &packet); av_packet_unref(&packet); if (result < 0) { error = "Unable to write cover image"; goto done; } break; } av_packet_unref(&packet); } }
    { AVPacket packet; av_init_packet(&packet); while (av_read_frame(input, &packet) >= 0) { AVStream* in = input->streams[packet.stream_index]; if (!cover_path.empty() && in->codecpar->codec_type == AVMEDIA_TYPE_VIDEO && (in->disposition & AV_DISPOSITION_ATTACHED_PIC)) { av_packet_unref(&packet); continue; } AVStream* out = output->streams[packet.stream_index]; av_packet_rescale_ts(&packet, in->time_base, out->time_base); int result = av_interleaved_write_frame(output, &packet); av_packet_unref(&packet); if (result < 0) { error = "Unable to write media packet"; goto done; } } }
    av_write_trailer(output);
    avformat_close_input(&input); if (cover) avformat_close_input(&cover); if (!(output->oformat->flags & AVFMT_NOFILE)) avio_closep(&output->pb); avformat_free_context(output); output = nullptr;
    std::filesystem::rename(temporary, source_path, rename_error);
    if (rename_error) {
        error = "Unable to replace media file: " + rename_error.message();
        std::error_code cleanup_error;
        std::filesystem::remove(temporary, cleanup_error);
        return false;
    }
    return true;
done:
    if (input) avformat_close_input(&input); if (cover) avformat_close_input(&cover); if (output) { if (!(output->oformat->flags & AVFMT_NOFILE)) avio_closep(&output->pb); avformat_free_context(output); } std::error_code ec; std::filesystem::remove(temporary, ec); return false;
}

static Napi::Value WriteMetadata(const Napi::CallbackInfo& info) {
    if (!info[0].IsString() || !info[1].IsObject()) {
        LOG_WARN("N-API writeMetadata rejected: expected a path and metadata object");
        return Napi::Boolean::New(info.Env(), false);
    }
    std::string source;
    try {
        source = info[0].As<Napi::String>().Utf8Value();
        const auto values = info[1].As<Napi::Object>(); std::map<std::string, std::string> tags;
        const std::pair<const char*, const char*> names[] = {{"title","title"},{"artist","artist"},{"album","album"},{"albumArtist","album_artist"},{"year","date"},{"genre","genre"},{"trackNumber","track"},{"discNumber","disc"},{"composer","composer"},{"lyricist","writer"},{"lyrics","lyrics"}};
        for (const auto& [js, ff] : names) { const auto v = values.Get(js); if (v.IsString() || v.IsNumber()) tags[ff] = v.ToString().Utf8Value(); }
        const auto cover = values.Get("coverPath"); const std::string cover_path = cover.IsString() ? cover.ToString().Utf8Value() : "";
        LOG_DEBUG("N-API writeMetadata begin: path=" + source + ", fields=" +
                  std::to_string(tags.size()) + ", cover=" + (cover_path.empty() ? "unchanged" : cover_path));
        std::string error; const bool ok = rewrite_metadata(source, tags, cover_path, error);
        if (!ok) {
            LOG_ERROR("N-API writeMetadata failed: path=" + source + ", error=" + error);
            Napi::Error::New(info.Env(), error).ThrowAsJavaScriptException();
        } else {
            LOG_DEBUG("N-API writeMetadata completed: path=" + source);
        }
        return Napi::Boolean::New(info.Env(), ok);
    } catch (const std::exception& error) {
        LOG_ERROR("N-API writeMetadata exception: path=" + source + ", error=" + error.what());
        Napi::Error::New(info.Env(), error.what()).ThrowAsJavaScriptException();
    } catch (...) {
        LOG_ERROR("N-API writeMetadata unknown exception: path=" + source);
        Napi::Error::New(info.Env(), "Native metadata operation failed").ThrowAsJavaScriptException();
    }
    return info.Env().Undefined();
}

// ──────────────────────────────────────────────────────────
// N-API wrapper for AudioEngine
// ──────────────────────────────────────────────────────────

class AudioEngineWrapper : public Napi::ObjectWrap<AudioEngineWrapper> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "AudioEngine", {
            InstanceMethod("open", &AudioEngineWrapper::Open),
            InstanceMethod("openAsync", &AudioEngineWrapper::OpenAsync),
            InstanceMethod("play", &AudioEngineWrapper::Play),
            InstanceMethod("pause", &AudioEngineWrapper::Pause),
            InstanceMethod("stop", &AudioEngineWrapper::Stop),
            InstanceMethod("stopAsync", &AudioEngineWrapper::StopAsync),
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
            InstanceMethod("setNextTrack", &AudioEngineWrapper::SetNextTrack),
            InstanceMethod("getTransitionConfig", &AudioEngineWrapper::GetTransitionConfig),
            InstanceMethod("enumerateDevices", &AudioEngineWrapper::EnumerateDevices),
            InstanceMethod("setDevice", &AudioEngineWrapper::SetDevice),
            InstanceMethod("setBackend", &AudioEngineWrapper::SetBackend),
            InstanceMethod("selectOutputDevice", &AudioEngineWrapper::SelectOutputDevice),
            InstanceMethod("getVersion", &AudioEngineWrapper::GetVersion),
            InstanceMethod("getStatus", &AudioEngineWrapper::GetStatus),
            InstanceMethod("getAudioChain", &AudioEngineWrapper::GetAudioChain),
            InstanceMethod("getAudioAnalysis", &AudioEngineWrapper::GetAudioAnalysis),
            InstanceMethod("setLoudnessAnalysisEnabled", &AudioEngineWrapper::SetLoudnessAnalysisEnabled),
            InstanceMethod("setSpectrumAnalysisEnabled", &AudioEngineWrapper::SetSpectrumAnalysisEnabled),
            InstanceMethod("getGlitchCount", &AudioEngineWrapper::GetGlitchCount),
            InstanceMethod("onStateChanged", &AudioEngineWrapper::OnStateChanged),
            InstanceMethod("onPositionChanged", &AudioEngineWrapper::OnPositionChanged),
            InstanceMethod("onTrackEnded", &AudioEngineWrapper::OnTrackEnded),
            InstanceMethod("onError", &AudioEngineWrapper::OnError),
            InstanceMethod("onLog", &AudioEngineWrapper::OnLog),
        });

        Napi::FunctionReference* constructor = new Napi::FunctionReference();
        *constructor = Napi::Persistent(func);
        env.SetInstanceData(constructor);

        exports.Set("AudioEngine", func);
        exports.Set("writeMetadata", Napi::Function::New(env, WriteMetadata));
        return exports;
    }

    AudioEngineWrapper(const Napi::CallbackInfo& info)
        : Napi::ObjectWrap<AudioEngineWrapper>(info)
        , engine_(std::make_unique<AudioEngine>(std::make_shared<PlatformAudioBackendFactory>()))
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
        engine_->set_track_ended_callback([this](const std::string& reason, const std::string& file_path) {
            NotifyTrackEnded(reason, file_path);
        });

        // Wire logger to JS console
        Logger::instance().set_callback([this](LogLevel level, const std::string& msg) {
            NotifyLog(level, msg);
        });
    }

private:
    // ── Commands ──

    Napi::Value RejectCommand(const Napi::CallbackInfo& info, const char* name, const char* expected) {
        LOG_WARN(std::string("N-API ") + name + " rejected: expected " + expected +
                 " (" + describe_arguments(info) + ")");
        return Napi::Boolean::New(info.Env(), false);
    }

    template <typename Command>
    Napi::Value RunBoolCommand(const Napi::CallbackInfo& info, const char* name, Command&& command,
                               bool warn_on_failure = false) {
        const auto started = std::chrono::steady_clock::now();
        const auto before = engine_->state();
        std::string parameters = "arguments not parsed";
        const auto context = [&] {
            const auto elapsed = std::chrono::duration_cast<std::chrono::milliseconds>(
                std::chrono::steady_clock::now() - started).count();
            return " (" + parameters + "; state=" + state_name(before) + "->" +
                state_name(engine_->state()) + "; elapsed_ms=" + std::to_string(elapsed) + ")";
        };
        try {
            parameters = describe_arguments(info);
            LOG_DEBUG(std::string("N-API ") + name + " begin" + context());
            const bool ok = command(parameters);
            if (ok) {
                LOG_DEBUG(std::string("N-API ") + name + " completed" + context());
            } else {
                const std::string message = std::string("N-API ") + name + " returned false" + context();
                if (warn_on_failure) LOG_WARN(message);
                else LOG_DEBUG(message);
            }
            return Napi::Boolean::New(info.Env(), ok);
        } catch (const std::exception& error) {
            LOG_ERROR(std::string("N-API ") + name + " exception: " + error.what() + context());
            return Napi::Boolean::New(info.Env(), false);
        } catch (...) {
            LOG_ERROR(std::string("N-API ") + name + " unknown exception" + context());
            return Napi::Boolean::New(info.Env(), false);
        }
    }

    class EngineCommandWorker final : public Napi::AsyncWorker {
    public:
        EngineCommandWorker(AudioEngineWrapper* owner, std::string path, bool open)
            : Napi::AsyncWorker(owner->Env())
            , owner_(owner)
            , path_(std::move(path))
            , open_(open)
            , deferred_(Napi::Promise::Deferred::New(owner->Env())) {}

        Napi::Promise Promise() const { return deferred_.Promise(); }

        void Execute() override {
            const auto started = std::chrono::steady_clock::now();
            const auto before = owner_->engine_->state();
            const auto context = [&] {
                return std::string("N-API ") + (open_ ? "openAsync" : "stopAsync") +
                    " (path=" + path_ + "; state=" + state_name(before) + "->" +
                    state_name(owner_->engine_->state()) + "; elapsed_ms=" +
                    std::to_string(std::chrono::duration_cast<std::chrono::milliseconds>(
                        std::chrono::steady_clock::now() - started).count()) + ")";
            };
            try {
                LOG_DEBUG(context() + " begin");
                std::lock_guard<std::mutex> lock(owner_->operation_mutex_);
                result_ = open_ ? owner_->engine_->open(path_) : owner_->engine_->stop();
                if (result_) LOG_DEBUG(context() + " completed");
                else if (open_) LOG_WARN(context() + " returned false");
                else LOG_DEBUG(context() + " returned false");
            } catch (const std::exception& error) {
                LOG_ERROR(context() + " exception: " + error.what());
                SetError(error.what());
            } catch (...) {
                LOG_ERROR(context() + " unknown exception");
                SetError("Unknown native audio engine exception");
            }
        }

        void OnOK() override {
            deferred_.Resolve(Napi::Boolean::New(Env(), result_));
            owner_->Unref();
        }

        void OnError(const Napi::Error& error) override {
            deferred_.Reject(error.Value());
            owner_->Unref();
        }

    private:
        AudioEngineWrapper* owner_;
        std::string path_;
        bool open_;
        bool result_ = false;
        Napi::Promise::Deferred deferred_;
    };

    Napi::Value OpenAsync(const Napi::CallbackInfo& info) {
        if (!info[0].IsString()) {
            LOG_WARN("N-API openAsync rejected: path must be a string");
            auto deferred = Napi::Promise::Deferred::New(info.Env());
            deferred.Resolve(Napi::Boolean::New(info.Env(), false));
            return deferred.Promise();
        }
        Ref();
        auto* worker = new EngineCommandWorker(this, info[0].As<Napi::String>().Utf8Value(), true);
        const auto promise = worker->Promise();
        worker->Queue();
        return promise;
    }

    Napi::Value Open(const Napi::CallbackInfo& info) {
        if (!info[0].IsString()) {
            LOG_WARN("N-API open rejected: path must be a string");
            return Napi::Boolean::New(info.Env(), false);
        }
        return RunBoolCommand(info, "open", [&](std::string& parameters) {
            std::string path = info[0].As<Napi::String>().Utf8Value();
            parameters = "path=" + path;
            std::lock_guard<std::mutex> lock(operation_mutex_);
            return engine_->open(path);
        }, true);
    }

    Napi::Value Play(const Napi::CallbackInfo& info) {
        return RunBoolCommand(info, "play", [&](std::string& parameters) { return engine_->play(); });
    }

    Napi::Value Pause(const Napi::CallbackInfo& info) {
        return RunBoolCommand(info, "pause", [&](std::string& parameters) { return engine_->pause(); });
    }

    Napi::Value Stop(const Napi::CallbackInfo& info) {
        return RunBoolCommand(info, "stop", [&](std::string& parameters) {
            std::lock_guard<std::mutex> lock(operation_mutex_);
            return engine_->stop();
        });
    }

    Napi::Value StopAsync(const Napi::CallbackInfo& info) {
        Ref();
        auto* worker = new EngineCommandWorker(this, "", false);
        const auto promise = worker->Promise();
        worker->Queue();
        return promise;
    }

    Napi::Value Seek(const Napi::CallbackInfo& info) {
        if (!info[0].IsNumber()) {
            LOG_WARN("N-API seek rejected: position must be a number");
            return Napi::Boolean::New(info.Env(), false);
        }
        double ms = info[0].As<Napi::Number>().DoubleValue();
        return RunBoolCommand(info, "seek", [&](std::string& parameters) {
            parameters = "position_ms=" + std::to_string(ms);
            return engine_->seek(ms);
        });
    }

    Napi::Value SetVolume(const Napi::CallbackInfo& info) {
        if (!info[0].IsNumber()) {
            LOG_WARN("N-API setVolume rejected: volume must be a number");
            return info.Env().Undefined();
        }
        float vol = info[0].As<Napi::Number>().FloatValue();
        try {
            LOG_DEBUG("N-API setVolume: volume=" + std::to_string(vol));
            engine_->set_volume(vol);
        } catch (const std::exception& error) {
            LOG_ERROR(std::string("N-API setVolume exception: ") + error.what() + ", volume=" + std::to_string(vol));
        } catch (...) {
            LOG_ERROR("N-API setVolume unknown exception: volume=" + std::to_string(vol));
        }
        return info.Env().Undefined();
    }

    Napi::Value SetPreamp(const Napi::CallbackInfo& info) {
        if (!info[0].IsNumber() || !info[1].IsBoolean()) {
            LOG_WARN("N-API setPreamp rejected: expected gain and enabled flag");
            return info.Env().Undefined();
        }
        const float db = info[0].As<Napi::Number>().FloatValue();
        const bool enabled = info[1].As<Napi::Boolean>().Value();
        try {
            LOG_DEBUG("N-API setPreamp: " + format_params({{"gainDb", db}, {"enabled", enabled}}));
            engine_->set_preamp_db(db, enabled);
        } catch (const std::exception& error) {
            LOG_ERROR(std::string("N-API setPreamp exception: ") + error.what() +
                      " (" + format_params({{"gainDb", db}, {"enabled", enabled}}) + ")");
        } catch (...) {
            LOG_ERROR("N-API setPreamp unknown exception (" + format_params({{"gainDb", db}, {"enabled", enabled}}) + ")");
        }
        return info.Env().Undefined();
    }
    Napi::Value SetReplayGain(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return RejectCommand(info, "setReplayGain", "object");
        return RunBoolCommand(info, "setReplayGain", [&](std::string& parameters) {
            const auto v = info[0].As<Napi::Object>();
            const std::string mode = read_property(v, "mode", parameters).ToString().Utf8Value();
            const bool prevent_clipping = read_property(v, "preventClipping", parameters).ToBoolean().Value();
            parameters = "mode=" + mode + ", preventClipping=" + (prevent_clipping ? "true" : "false");
            engine_->set_replay_gain_mode(mode == "track" ? 1 : mode == "album" ? 2 : 0, prevent_clipping);
            return true;
        });
    }
    Napi::Value GetReplayGain(const Napi::CallbackInfo& info) {
        const auto c = engine_->replay_gain_config(); auto v = Napi::Object::New(info.Env());
        v.Set("mode", Napi::String::New(info.Env(), engine_->replay_gain_mode() == 1 ? "track" : engine_->replay_gain_mode() == 2 ? "album" : "off"));
        v.Set("preventClipping", Napi::Boolean::New(info.Env(), engine_->replay_gain_prevent_clipping()));
        v.Set("active", Napi::Boolean::New(info.Env(), c.enabled)); v.Set("appliedGainDb", Napi::Number::New(info.Env(), c.gain_db));
        return v;
    }
    Napi::Value SetPlaybackSpeed(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return RejectCommand(info, "setPlaybackSpeed", "object");
        return RunBoolCommand(info, "setPlaybackSpeed", [&](std::string& parameters) {
            const auto v = info[0].As<Napi::Object>();
            const PlaybackSpeedConfig config{read_property(v, "enabled", parameters).ToBoolean().Value(), read_property(v, "speed", parameters).ToNumber().FloatValue()};
            parameters = format_params({{"enabled", config.enabled}, {"speed", config.speed}});
            return engine_->set_playback_speed_config(config);
        }, true);
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

        return RunBoolCommand(info, "setEqBands", [&](std::string& parameters) {
            std::array<EqBand, kEqBandCount> bands;
            std::ostringstream details;
            for (int i = 0; i < kEqBandCount; ++i) {
                parameters = "bands=" + std::to_string(kEqBandCount) + ", parsing_index=" + std::to_string(i) + details.str();
                auto value = values.Get(i);
                if (!value.IsObject()) {
                    LOG_WARN("N-API setEqBands rejected: band " + std::to_string(i) + " is not an object");
                    return false;
                }
                auto band = value.As<Napi::Object>();
                bands[i].enabled = read_property(band, "enabled", parameters).ToBoolean().Value();
                bands[i].frequency_hz = read_property(band, "frequencyHz", parameters).ToNumber().FloatValue();
                bands[i].gain_db = read_property(band, "gainDb", parameters).ToNumber().FloatValue();
                bands[i].q = read_property(band, "q", parameters).ToNumber().FloatValue();
                details << " [" << i << ": enabled=" << bands[i].enabled << ", frequencyHz="
                        << bands[i].frequency_hz << ", gainDb=" << bands[i].gain_db << ", Q=" << bands[i].q << "]";
                parameters = "bands=" + std::to_string(kEqBandCount) + details.str();
            }
            return engine_->set_eq_bands(bands);
        }, true);
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
        if (!info[0].IsObject()) return RejectCommand(info, "setResamplerConfig", "object");
        return RunBoolCommand(info, "setResamplerConfig", [&](std::string& parameters) {
            const auto config = info[0].As<Napi::Object>();
            const bool force = read_property(config, "forceOutputRate", parameters).ToBoolean().Value();
            const int rate = read_property(config, "targetSampleRate", parameters).ToNumber().Int32Value();
            const std::string quality = read_property(config, "quality", parameters).ToString().Utf8Value();
            const int quality_value = quality == "medium" ? 1 : quality == "fast" ? 2 : 0;
            parameters = format_params({{"forceOutputRate", force}, {"targetSampleRate", rate}}) + ", quality=" + quality;
            return engine_->set_resampler_config(force, rate, quality_value);
        }, true);
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
        if (!info[0].IsBoolean()) return RejectCommand(info, "setDopEnabled", "boolean");
        return RunBoolCommand(info, "setDopEnabled", [&](std::string& parameters) {
            engine_->set_dop_enabled(info[0].As<Napi::Boolean>().Value());
            return true;
        });
    }

    Napi::Value GetDopEnabled(const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), engine_->dop_enabled());
    }

    Napi::Value SetDspNodes(const Napi::CallbackInfo& info) {
        if (!info[0].IsArray()) return RejectCommand(info, "setDspNodes", "array");
        return RunBoolCommand(info, "setDspNodes", [&](std::string& parameters) {
            const auto values = info[0].As<Napi::Array>();
            std::vector<DspNodeConfig> nodes;
            nodes.reserve(values.Length());
            for (uint32_t i = 0; i < values.Length(); ++i) {
                parameters = "nodes=" + std::to_string(values.Length()) + ", parsing_index=" + std::to_string(i);
                const auto value = values.Get(i);
                if (!value.IsObject()) return false;
                const auto node = value.As<Napi::Object>();
                nodes.push_back({read_property(node, "id", parameters).ToString().Utf8Value(),
                                 read_property(node, "enabled", parameters).ToBoolean().Value()});
            }
            parameters = "nodes=" + std::to_string(nodes.size());
            for (size_t i = 0; i < std::min<size_t>(nodes.size(), 32); ++i) {
                parameters += " [id=" + nodes[i].id.substr(0, 128) + ", enabled=" + (nodes[i].enabled ? "true" : "false") + "]";
            }
            if (nodes.size() > 32) parameters += " ...";
            return engine_->set_dsp_nodes(nodes);
        }, true);
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
        if (!info[0].IsObject()) return RejectCommand(info, "setCompressorConfig", "object");
        return RunBoolCommand(info, "setCompressorConfig", [&](std::string& parameters) {
            const auto value = info[0].As<Napi::Object>();
            CompressorConfig config;
            config.threshold_db = read_property(value, "thresholdDb", parameters).ToNumber().FloatValue();
            config.ratio = read_property(value, "ratio", parameters).ToNumber().FloatValue();
            config.attack_ms = read_property(value, "attackMs", parameters).ToNumber().FloatValue();
            config.release_ms = read_property(value, "releaseMs", parameters).ToNumber().FloatValue();
            config.makeup_db = read_property(value, "makeupDb", parameters).ToNumber().FloatValue();
            parameters = format_params({{"thresholdDb", config.threshold_db}, {"ratio", config.ratio},
                {"attackMs", config.attack_ms}, {"releaseMs", config.release_ms}, {"makeupDb", config.makeup_db}});
            return engine_->set_compressor_config(config);
        }, true);
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
        if (!info[0].IsObject()) return RejectCommand(info, "setDelayConfig", "object");
        return RunBoolCommand(info, "setDelayConfig", [&](std::string& parameters) {
            const auto value = info[0].As<Napi::Object>();
            DelayConfig config;
            config.delay_ms = read_property(value, "delayMs", parameters).ToNumber().FloatValue();
            config.feedback = read_property(value, "feedback", parameters).ToNumber().FloatValue();
            config.mix = read_property(value, "mix", parameters).ToNumber().FloatValue();
            parameters = format_params({{"delayMs", config.delay_ms}, {"feedback", config.feedback}, {"mix", config.mix}});
            return engine_->set_delay_config(config);
        }, true);
    }

    Napi::Value GetDelayConfig(const Napi::CallbackInfo& info) {
        const auto config = engine_->delay_config(); auto value = Napi::Object::New(info.Env());
        value.Set("delayMs", Napi::Number::New(info.Env(), config.delay_ms));
        value.Set("feedback", Napi::Number::New(info.Env(), config.feedback));
        value.Set("mix", Napi::Number::New(info.Env(), config.mix)); return value;
    }
    Napi::Value SetReverbConfig(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return RejectCommand(info, "setReverbConfig", "object");
        return RunBoolCommand(info, "setReverbConfig", [&](std::string& parameters) {
            const auto v = info[0].As<Napi::Object>();
            const ReverbConfig config{read_property(v, "roomSize", parameters).ToNumber().FloatValue(),
                read_property(v, "decay", parameters).ToNumber().FloatValue(), read_property(v, "mix", parameters).ToNumber().FloatValue()};
            parameters = format_params({{"roomSize", config.room_size}, {"decay", config.decay}, {"mix", config.mix}});
            return engine_->set_reverb_config(config);
        }, true);
    }
    Napi::Value GetReverbConfig(const Napi::CallbackInfo& info) {
        const auto c = engine_->reverb_config(); auto v = Napi::Object::New(info.Env());
        v.Set("roomSize", Napi::Number::New(info.Env(), c.room_size)); v.Set("decay", Napi::Number::New(info.Env(), c.decay));
        v.Set("mix", Napi::Number::New(info.Env(), c.mix)); return v;
    }
    Napi::Value SetChorusConfig(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return RejectCommand(info, "setChorusConfig", "object");
        return RunBoolCommand(info, "setChorusConfig", [&](std::string& parameters) {
            const auto v = info[0].As<Napi::Object>();
            const ChorusConfig config{read_property(v, "rateHz", parameters).ToNumber().FloatValue(),
                read_property(v, "depthMs", parameters).ToNumber().FloatValue(), read_property(v, "mix", parameters).ToNumber().FloatValue()};
            parameters = format_params({{"rateHz", config.rate_hz}, {"depthMs", config.depth_ms}, {"mix", config.mix}});
            return engine_->set_chorus_config(config);
        }, true);
    }
    Napi::Value GetChorusConfig(const Napi::CallbackInfo& info) {
        const auto c = engine_->chorus_config(); auto v = Napi::Object::New(info.Env());
        v.Set("rateHz", Napi::Number::New(info.Env(), c.rate_hz)); v.Set("depthMs", Napi::Number::New(info.Env(), c.depth_ms));
        v.Set("mix", Napi::Number::New(info.Env(), c.mix)); return v;
    }
    Napi::Value SetNoiseGateConfig(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return RejectCommand(info, "setNoiseGateConfig", "object");
        return RunBoolCommand(info, "setNoiseGateConfig", [&](std::string& parameters) {
            const auto v = info[0].As<Napi::Object>();
            const NoiseGateConfig config{read_property(v, "thresholdDb", parameters).ToNumber().FloatValue(),
                read_property(v, "attackMs", parameters).ToNumber().FloatValue(), read_property(v, "holdMs", parameters).ToNumber().FloatValue(),
                read_property(v, "releaseMs", parameters).ToNumber().FloatValue(), read_property(v, "rangeDb", parameters).ToNumber().FloatValue()};
            parameters = format_params({{"thresholdDb", config.threshold_db}, {"attackMs", config.attack_ms},
                {"holdMs", config.hold_ms}, {"releaseMs", config.release_ms}, {"rangeDb", config.range_db}});
            return engine_->set_noise_gate_config(config);
        }, true);
    }
    Napi::Value GetNoiseGateConfig(const Napi::CallbackInfo& info) {
        const auto c = engine_->noise_gate_config(); auto v = Napi::Object::New(info.Env());
        v.Set("thresholdDb", Napi::Number::New(info.Env(), c.threshold_db)); v.Set("attackMs", Napi::Number::New(info.Env(), c.attack_ms));
        v.Set("holdMs", Napi::Number::New(info.Env(), c.hold_ms)); v.Set("releaseMs", Napi::Number::New(info.Env(), c.release_ms));
        v.Set("rangeDb", Napi::Number::New(info.Env(), c.range_db)); return v;
    }
    Napi::Value SetPhaserConfig(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return RejectCommand(info, "setPhaserConfig", "object");
        return RunBoolCommand(info, "setPhaserConfig", [&](std::string& parameters) {
            const auto v = info[0].As<Napi::Object>();
            const PhaserConfig config{read_property(v, "rateHz", parameters).ToNumber().FloatValue(),
                read_property(v, "depth", parameters).ToNumber().FloatValue(), read_property(v, "centerHz", parameters).ToNumber().FloatValue(),
                read_property(v, "feedback", parameters).ToNumber().FloatValue(), read_property(v, "mix", parameters).ToNumber().FloatValue()};
            parameters = format_params({{"rateHz", config.rate_hz}, {"depth", config.depth},
                {"centerHz", config.center_hz}, {"feedback", config.feedback}, {"mix", config.mix}});
            return engine_->set_phaser_config(config);
        }, true);
    }
    Napi::Value GetPhaserConfig(const Napi::CallbackInfo& info) {
        const auto c = engine_->phaser_config(); auto v = Napi::Object::New(info.Env());
        v.Set("rateHz", Napi::Number::New(info.Env(), c.rate_hz)); v.Set("depth", Napi::Number::New(info.Env(), c.depth));
        v.Set("centerHz", Napi::Number::New(info.Env(), c.center_hz)); v.Set("feedback", Napi::Number::New(info.Env(), c.feedback));
        v.Set("mix", Napi::Number::New(info.Env(), c.mix)); return v;
    }
    Napi::Value SetChannelMatrixConfig(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return RejectCommand(info, "setChannelMatrixConfig", "object");
        return RunBoolCommand(info, "setChannelMatrixConfig", [&](std::string& parameters) {
            const auto v = info[0].As<Napi::Object>();
            ChannelMatrixConfig config{};
            config.enabled = read_property(v, "enabled", parameters).ToBoolean().Value(); config.balance = read_property(v, "balance", parameters).ToNumber().FloatValue();
            config.swap_stereo = read_property(v, "swapStereo", parameters).ToBoolean().Value(); config.mono_downmix = read_property(v, "monoDownmix", parameters).ToBoolean().Value();
            const auto gains = read_property(v, "outputGains", parameters);
            if (gains.IsArray()) { const auto values = gains.As<Napi::Array>(); for (uint32_t i = 0; i < std::min<uint32_t>(values.Length(), kMaxAudioChannels); ++i) config.output_gains[i] = values.Get(i).ToNumber().FloatValue(); }
            parameters = format_params({{"enabled", config.enabled}, {"balance", config.balance},
                {"swapStereo", config.swap_stereo}, {"monoDownmix", config.mono_downmix}}) + ", outputGains=";
            for (const auto gain : config.output_gains) parameters += std::to_string(gain) + " ";
            return engine_->set_channel_matrix_config(config);
        }, true);
    }
    Napi::Value GetChannelMatrixConfig(const Napi::CallbackInfo& info) {
        const auto c = engine_->channel_matrix_config(); auto v = Napi::Object::New(info.Env());
        v.Set("enabled", Napi::Boolean::New(info.Env(), c.enabled)); v.Set("balance", Napi::Number::New(info.Env(), c.balance));
        v.Set("swapStereo", Napi::Boolean::New(info.Env(), c.swap_stereo)); v.Set("monoDownmix", Napi::Boolean::New(info.Env(), c.mono_downmix));
        auto gains = Napi::Array::New(info.Env(), kMaxAudioChannels); for (uint32_t i = 0; i < kMaxAudioChannels; ++i) gains.Set(i, Napi::Number::New(info.Env(), c.output_gains[i])); v.Set("outputGains", gains); return v;
    }
    Napi::Value SetLimiter(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return RejectCommand(info, "setLimiter", "object");
        return RunBoolCommand(info, "setLimiter", [&](std::string& parameters) {
            const auto v = info[0].As<Napi::Object>();
            engine_->set_limiter_enabled(read_property(v, "enabled", parameters).ToBoolean().Value());
            const LimiterConfig config{read_property(v, "ceilingDb", parameters).ToNumber().FloatValue(), read_property(v, "releaseMs", parameters).ToNumber().FloatValue()};
            parameters = format_params({{"enabled", engine_->limiter_enabled()}, {"ceilingDb", config.ceiling_db}, {"releaseMs", config.release_ms}});
            return engine_->set_limiter_config(config);
        }, true);
    }
    Napi::Value GetLimiter(const Napi::CallbackInfo& info) {
        const auto c = engine_->limiter_config(); auto v=Napi::Object::New(info.Env());
        v.Set("enabled", Napi::Boolean::New(info.Env(), engine_->limiter_enabled())); v.Set("ceilingDb", Napi::Number::New(info.Env(), c.ceiling_db)); v.Set("releaseMs", Napi::Number::New(info.Env(), c.release_ms)); return v;
    }
    Napi::Value SetTransitionConfig(const Napi::CallbackInfo& info) {
        if (!info[0].IsObject()) return RejectCommand(info, "setTransitionConfig", "object");
        return RunBoolCommand(info, "setTransitionConfig", [&](std::string& parameters) {
            const auto v = info[0].As<Napi::Object>();
            const auto auto_value = read_property(v, "crossfadeAuto", parameters);
            const TransitionConfig config{read_property(v, "gaplessEnabled", parameters).ToBoolean().Value(),
                read_property(v, "crossfadeEnabled", parameters).ToBoolean().Value(), read_property(v, "crossfadeMs", parameters).ToNumber().Int32Value(),
                auto_value.IsBoolean() && auto_value.As<Napi::Boolean>().Value()};
            parameters = format_params({{"gaplessEnabled", config.gapless_enabled}, {"crossfadeEnabled", config.crossfade_enabled},
                {"crossfadeMs", config.crossfade_ms}, {"crossfadeAuto", config.crossfade_auto}});
            return engine_->set_transition_config(config);
        }, true);
    }
    Napi::Value GetTransitionConfig(const Napi::CallbackInfo& info) {
        const auto c = engine_->transition_config(); auto v = Napi::Object::New(info.Env());
        v.Set("gaplessEnabled", Napi::Boolean::New(info.Env(), c.gapless_enabled));
        v.Set("crossfadeEnabled", Napi::Boolean::New(info.Env(), c.crossfade_enabled));
        v.Set("crossfadeMs", Napi::Number::New(info.Env(), c.crossfade_ms));
        v.Set("crossfadeAuto", Napi::Boolean::New(info.Env(), c.crossfade_auto)); return v;
    }

    Napi::Value EnumerateDevices(const Napi::CallbackInfo& info) {
        std::vector<DeviceInfo> devices;
        try {
            devices = engine_->enumerate_devices();
        } catch (const std::exception& error) {
            LOG_ERROR(std::string("N-API enumerateDevices exception: ") + error.what());
            return Napi::Array::New(info.Env());
        } catch (...) {
            LOG_ERROR("N-API enumerateDevices unknown exception");
            return Napi::Array::New(info.Env());
        }
        LOG_DEBUG("N-API enumerateDevices found " + std::to_string(devices.size()) + " device(s)");
        auto arr = Napi::Array::New(info.Env(), devices.size());

        for (size_t i = 0; i < devices.size(); ++i) {
            auto obj = Napi::Object::New(info.Env());

            // Convert wide strings to UTF-8 (fixes CJK encoding)
            auto wide_to_utf8 = [](const std::wstring& ws) -> std::string {
                if (ws.empty()) return {};
#ifdef EASY_PLAYER_MACOS
                std::string result;
                result.reserve(ws.size());
                for (wchar_t ch : ws) {
                    if (ch >= 0 && ch <= 0x7f) result.push_back(static_cast<char>(ch));
                    else result.push_back('?');
                }
                return result;
#else
                int len = WideCharToMultiByte(CP_UTF8, 0, ws.data(), static_cast<int>(ws.size()),
                                              nullptr, 0, nullptr, nullptr);
                if (len <= 0) return {};
                std::string result(len, '\0');
                WideCharToMultiByte(CP_UTF8, 0, ws.data(), static_cast<int>(ws.size()),
                                    result.data(), len, nullptr, nullptr);
                return result;
#endif
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
            LOG_DEBUG("Audio device: backend=" + std::string(backend_str) + ", id=" + log_wide(devices[i].id) +
                      ", name=" + wide_to_utf8(devices[i].name) + ", max_channels=" + std::to_string(devices[i].max_channels) +
                      ", default=" + std::to_string(devices[i].is_default) + ", exclusive=" + std::to_string(devices[i].supports_exclusive));
            arr.Set(i, obj);
        }
        return arr;
    }

    Napi::Value SetDevice(const Napi::CallbackInfo& info) {
        if (!info[0].IsString()) {
            LOG_WARN("N-API setDevice rejected: device ID must be a string");
            return Napi::Boolean::New(info.Env(), false);
        }
        return RunBoolCommand(info, "setDevice", [&](std::string& parameters) {
            std::string id = info[0].As<Napi::String>().Utf8Value();
            parameters = "device_id=" + id;
            return engine_->set_device(std::wstring(id.begin(), id.end()));
        }, true);
    }
    Napi::Value SetNextTrack(const Napi::CallbackInfo& info) {
        if (!info[0].IsString()) return RejectCommand(info, "setNextTrack", "string");
        return RunBoolCommand(info, "setNextTrack", [&](std::string& parameters) {
            return engine_->set_next_track(info[0].As<Napi::String>().Utf8Value());
        });
    }

    Napi::Value SetBackend(const Napi::CallbackInfo& info) {
        if (!info[0].IsString()) {
            LOG_WARN("N-API setBackend rejected: backend must be a string");
            return Napi::Boolean::New(info.Env(), false);
        }
        return RunBoolCommand(info, "setBackend", [&](std::string& parameters) {
            std::string backend = info[0].As<Napi::String>().Utf8Value();
            parameters = "backend=" + backend;
            BackendType type;
            if (backend == "wasapi_shared")      type = BackendType::WASAPI_SHARED;
            else if (backend == "wasapi_exclusive") type = BackendType::WASAPI_EXCLUSIVE;
            else if (backend == "asio")             type = BackendType::ASIO;
            else                                    type = BackendType::DIRECTSOUND;
            return engine_->set_backend(type);
        }, true);
    }

    Napi::Value SelectOutputDevice(const Napi::CallbackInfo& info) {
        if (!info[0].IsString() || !info[1].IsString()) {
            LOG_WARN("N-API selectOutputDevice rejected: expected backend and device ID");
            return Napi::Boolean::New(info.Env(), false);
        }
        return RunBoolCommand(info, "selectOutputDevice", [&](std::string& parameters) {
            std::string backend = info[0].As<Napi::String>().Utf8Value();
            std::string id = info[1].As<Napi::String>().Utf8Value();
            parameters = "backend=" + backend + ", device_id=" + id;
            BackendType type;
            if (backend == "wasapi_shared")      type = BackendType::WASAPI_SHARED;
            else if (backend == "wasapi_exclusive") type = BackendType::WASAPI_EXCLUSIVE;
            else if (backend == "asio")             type = BackendType::ASIO;
            else                                      type = BackendType::DIRECTSOUND;
            return engine_->select_output_device(type, std::wstring(id.begin(), id.end()));
        }, true);
    }

    Napi::Value GetVersion(const Napi::CallbackInfo& info) {
        return Napi::String::New(info.Env(), engine_->version());
    }

    Napi::Value GetStatus(const Napi::CallbackInfo& info) {
        auto obj = Napi::Object::New(info.Env());
        obj.Set("state", Napi::Number::New(info.Env(), (int)engine_->state()));
        obj.Set("positionMs", Napi::Number::New(info.Env(), engine_->position_ms()));
        obj.Set("durationMs", Napi::Number::New(info.Env(), engine_->duration_ms()));
        obj.Set("volume", Napi::Number::New(info.Env(), engine_->volume()));
        obj.Set("glitchCount", Napi::Number::New(info.Env(), engine_->glitch_count()));

        const auto ti = engine_->track_info();
        auto tiObj = Napi::Object::New(info.Env());
        tiObj.Set("filePath", Napi::String::New(info.Env(), ti.file_path));
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
        const bool include_spectrum = info.Length() > 0 && info[0].IsBoolean() && info[0].As<Napi::Boolean>().Value();
        if (include_spectrum) {
            auto spectrum = Napi::Array::New(info.Env(), value.spectrum.size());
            for (size_t i = 0; i < value.spectrum.size(); ++i) spectrum.Set(i, Napi::Number::New(info.Env(), value.spectrum[i]));
            obj.Set("spectrum", spectrum);
        }
        return obj;
    }
    Napi::Value SetLoudnessAnalysisEnabled(const Napi::CallbackInfo& info) {
        const bool enabled = info.Length() > 0 && info[0].IsBoolean() && info[0].As<Napi::Boolean>().Value();
        return RunBoolCommand(info, "setLoudnessAnalysisEnabled", [&](std::string& parameters) {
            engine_->set_loudness_analysis_enabled(enabled);
            return true;
        });
    }
    Napi::Value SetSpectrumAnalysisEnabled(const Napi::CallbackInfo& info) {
        const bool enabled = info.Length() > 0 && info[0].IsBoolean() && info[0].As<Napi::Boolean>().Value();
        return RunBoolCommand(info, "setSpectrumAnalysisEnabled", [&](std::string& parameters) {
            engine_->set_spectrum_analysis_enabled(enabled);
            return true;
        });
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

    Napi::Value OnTrackEnded(const Napi::CallbackInfo& info) {
        auto tsfn = Napi::ThreadSafeFunction::New(
            info.Env(), info[0].As<Napi::Function>(),
            "TrackEnded", 0, 1);
        track_ended_tsfn_ = std::make_unique<Napi::ThreadSafeFunction>(std::move(tsfn));
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

    void NotifyTrackEnded(const std::string& reason, const std::string& file_path) {
        if (!track_ended_tsfn_) return;
        track_ended_tsfn_->NonBlockingCall([reason, file_path](Napi::Env env, Napi::Function jsCallback) {
            jsCallback.Call({Napi::String::New(env, reason), Napi::String::New(env, file_path)});
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
    // `open` and `stop` can synchronously probe media, close CoreAudio and
    // join decoder threads. IPC runs them through AsyncWorker; this mutex also
    // keeps the synchronous shutdown path from racing that worker.
    std::mutex operation_mutex_;

    std::unique_ptr<Napi::ThreadSafeFunction> state_tsfn_;
    std::unique_ptr<Napi::ThreadSafeFunction> pos_tsfn_;
    std::unique_ptr<Napi::ThreadSafeFunction> track_ended_tsfn_;
    std::unique_ptr<Napi::ThreadSafeFunction> error_tsfn_;
    std::unique_ptr<Napi::ThreadSafeFunction> log_tsfn_;
};

// ── Module registration ──
Napi::Object InitModule(Napi::Env env, Napi::Object exports) {
    return AudioEngineWrapper::Init(env, exports);
}

NODE_API_MODULE(easy_player_native, InitModule)
