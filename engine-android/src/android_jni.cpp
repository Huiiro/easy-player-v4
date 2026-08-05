#include "android_backend_factory.h"
#include "audio_engine.h"
#include "decoder.h"

#include <jni.h>
#include <memory>
#include <mutex>
#include <string>

namespace {
struct AndroidEngineHandle {
    AndroidEngineHandle() : engine(std::make_unique<AudioEngine>(std::make_shared<AndroidAudioBackendFactory>())) {
        engine->set_error_callback([this](int code, const std::string& message) {
            std::lock_guard<std::mutex> lock(error_mutex);
            last_error_code = code;
            last_error = message;
        });
    }
    // Declare the engine last so it is destroyed first, before callback state.
    std::mutex error_mutex;
    int last_error_code = 0;
    std::string last_error;
    std::unique_ptr<AudioEngine> engine;
};

AndroidEngineHandle* handle(jlong value) {
    return reinterpret_cast<AndroidEngineHandle*>(value);
}

std::string to_utf8(JNIEnv* env, jstring value) {
    if (!value) return {};
    const char* chars = env->GetStringUTFChars(value, nullptr);
    if (!chars) return {};
    std::string result(chars);
    env->ReleaseStringUTFChars(value, chars);
    return result;
}
} // namespace

extern "C" JNIEXPORT jlong JNICALL
Java_com_huiiro_easyplayer_engine_NativeAudioEngine_nativeCreate(JNIEnv*, jobject) {
    return reinterpret_cast<jlong>(new AndroidEngineHandle());
}

extern "C" JNIEXPORT void JNICALL
Java_com_huiiro_easyplayer_engine_NativeAudioEngine_nativeDestroy(JNIEnv*, jobject, jlong value) {
    delete handle(value);
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_huiiro_easyplayer_engine_NativeAudioEngine_nativeOpen(JNIEnv* env, jobject, jlong value, jstring path) {
    auto* instance = handle(value);
    return instance && instance->engine->open(to_utf8(env, path));
}

extern "C" JNIEXPORT jboolean JNICALL
Java_com_huiiro_easyplayer_engine_NativeAudioEngine_nativePlay(JNIEnv*, jobject, jlong value) {
    auto* instance = handle(value); return instance && instance->engine->play();
}
extern "C" JNIEXPORT jboolean JNICALL
Java_com_huiiro_easyplayer_engine_NativeAudioEngine_nativePause(JNIEnv*, jobject, jlong value) {
    auto* instance = handle(value); return instance && instance->engine->pause();
}
extern "C" JNIEXPORT jboolean JNICALL
Java_com_huiiro_easyplayer_engine_NativeAudioEngine_nativeStop(JNIEnv*, jobject, jlong value) {
    auto* instance = handle(value); return instance && instance->engine->stop();
}
extern "C" JNIEXPORT jboolean JNICALL
Java_com_huiiro_easyplayer_engine_NativeAudioEngine_nativeSeek(JNIEnv*, jobject, jlong value, jdouble position_ms) {
    auto* instance = handle(value); return instance && instance->engine->seek(position_ms);
}
extern "C" JNIEXPORT void JNICALL
Java_com_huiiro_easyplayer_engine_NativeAudioEngine_nativeSetVolume(JNIEnv*, jobject, jlong value, jfloat volume) {
    auto* instance = handle(value); if (instance) instance->engine->set_volume(volume);
}
extern "C" JNIEXPORT jint JNICALL
Java_com_huiiro_easyplayer_engine_NativeAudioEngine_nativeGetState(JNIEnv*, jobject, jlong value) {
    auto* instance = handle(value); return instance ? static_cast<jint>(instance->engine->state()) : -1;
}
extern "C" JNIEXPORT jdouble JNICALL
Java_com_huiiro_easyplayer_engine_NativeAudioEngine_nativeGetPositionMs(JNIEnv*, jobject, jlong value) {
    auto* instance = handle(value); return instance ? instance->engine->position_ms() : 0.0;
}
extern "C" JNIEXPORT jdouble JNICALL
Java_com_huiiro_easyplayer_engine_NativeAudioEngine_nativeGetDurationMs(JNIEnv*, jobject, jlong value) {
    auto* instance = handle(value); return instance ? instance->engine->duration_ms() : 0.0;
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_huiiro_easyplayer_engine_NativeAudioEngine_nativeGetLastError(JNIEnv* env, jobject, jlong value) {
    auto* instance = handle(value);
    if (!instance) return nullptr;
    std::lock_guard<std::mutex> lock(instance->error_mutex);
    return instance->last_error.empty() ? nullptr : env->NewStringUTF(instance->last_error.c_str());
}

extern "C" JNIEXPORT jstring JNICALL
Java_com_huiiro_easyplayer_engine_NativeAudioEngine_nativeReadEmbeddedLyrics(
    JNIEnv* env, jobject, jstring path) {
    Decoder decoder;
    if (!decoder.open(to_utf8(env, path))) return nullptr;
    const auto& lyrics = decoder.track_info().metadata.lyrics;
    return lyrics.empty() ? nullptr : env->NewStringUTF(lyrics.c_str());
}
