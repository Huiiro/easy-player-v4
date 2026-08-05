#include "android_aaudio_backend.h"

#include "logger.h"
#include <aaudio/AAudio.h>
#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cstring>

struct AndroidAAudioBackend::Impl {
    AAudioStream* stream = nullptr;
    AudioCallback callback;
    AudioFormat format{};
    int32_t buffer_size_frames = 0;
};

AndroidAAudioBackend::AndroidAAudioBackend() : impl_(std::make_unique<Impl>()) {}

AndroidAAudioBackend::~AndroidAAudioBackend() {
    close();
}

std::vector<DeviceInfo> AndroidAAudioBackend::enumerate_devices() {
    // AAudio does not provide output-device enumeration. Device routing is
    // handled by Android; AudioManager may select a Bluetooth/USB endpoint.
    return {{L"default", L"Default Android output", BackendType::DIRECTSOUND, true,
             2, {44100, 48000}, {32}, false, false}};
}

AudioFormat AndroidAAudioBackend::open(const std::wstring& device_id,
                                       const AudioFormat& requested_format,
                                       AudioCallback callback) {
    close();

    AAudioStreamBuilder* builder = nullptr;
    if (AAudio_createStreamBuilder(&builder) != AAUDIO_OK || !builder) {
        LOG_ERROR("AAudio: failed to create stream builder");
        return {};
    }

    AAudioStreamBuilder_setDirection(builder, AAUDIO_DIRECTION_OUTPUT);
    AAudioStreamBuilder_setFormat(builder, AAUDIO_FORMAT_PCM_FLOAT);
    AAudioStreamBuilder_setChannelCount(builder, std::max(1, requested_format.channels));
    if (requested_format.sample_rate > 0) {
        AAudioStreamBuilder_setSampleRate(builder, requested_format.sample_rate);
    }
    AAudioStreamBuilder_setPerformanceMode(builder, AAUDIO_PERFORMANCE_MODE_LOW_LATENCY);
    // Exclusive is a request, not a guarantee. Android may transparently use
    // shared output when another app/device prevents exclusive access.
    AAudioStreamBuilder_setSharingMode(builder, AAUDIO_SHARING_MODE_EXCLUSIVE);
    AAudioStreamBuilder_setDataCallback(builder, data_callback, this);
    AAudioStreamBuilder_setErrorCallback(builder, error_callback, this);

    if (device_id != L"default") {
        wchar_t* end = nullptr;
        const long id = std::wcstol(device_id.c_str(), &end, 10);
        if (end && *end == L'\0' && id > 0) AAudioStreamBuilder_setDeviceId(builder, id);
    }

    const aaudio_result_t result = AAudioStreamBuilder_openStream(builder, &impl_->stream);
    AAudioStreamBuilder_delete(builder);
    if (result != AAUDIO_OK || !impl_->stream) {
        LOG_ERROR(std::string("AAudio: open failed: ") + AAudio_convertResultToText(result));
        impl_->stream = nullptr;
        return {};
    }
    if (AAudioStream_getFormat(impl_->stream) != AAUDIO_FORMAT_PCM_FLOAT) {
        LOG_ERROR("AAudio: device rejected float PCM output");
        close();
        return {};
    }

    impl_->callback = std::move(callback);
    impl_->format = {AAudioStream_getSampleRate(impl_->stream), 32,
                     AAudioStream_getChannelCount(impl_->stream)};
    impl_->buffer_size_frames = AAudioStream_getBufferSizeInFrames(impl_->stream);
    LOG_INFO("AAudio opened: " + std::to_string(impl_->format.sample_rate) + "Hz/" +
             std::to_string(impl_->format.channels) + "ch");
    return impl_->format;
}

bool AndroidAAudioBackend::start() {
    if (!impl_->stream) return false;
    const aaudio_result_t result = AAudioStream_requestStart(impl_->stream);
    active_.store(result == AAUDIO_OK, std::memory_order_release);
    return result == AAUDIO_OK;
}

bool AndroidAAudioBackend::stop() {
    if (!impl_->stream) return true;
    const aaudio_result_t result = AAudioStream_requestStop(impl_->stream);
    active_.store(false, std::memory_order_release);
    return result == AAUDIO_OK;
}

void AndroidAAudioBackend::close() {
    active_.store(false, std::memory_order_release);
    if (impl_->stream) {
        AAudioStream_requestStop(impl_->stream);
        AAudioStream_close(impl_->stream);
        impl_->stream = nullptr;
    }
    impl_->callback = nullptr;
    impl_->format = {};
    impl_->buffer_size_frames = 0;
}

AudioFormat AndroidAAudioBackend::current_format() const {
    return impl_->format;
}

int AndroidAAudioBackend::buffer_size_frames() const {
    return impl_->buffer_size_frames;
}

double AndroidAAudioBackend::latency_ms() const {
    return impl_->format.sample_rate > 0
        ? static_cast<double>(impl_->buffer_size_frames) * 1000.0 / impl_->format.sample_rate
        : 0.0;
}

void AndroidAAudioBackend::flush() {
    if (!impl_->stream) return;
    const bool resume = active_.exchange(false, std::memory_order_acq_rel);
    if (resume) AAudioStream_requestPause(impl_->stream);
    AAudioStream_requestFlush(impl_->stream);
    if (resume) start();
}

aaudio_data_callback_result_t AndroidAAudioBackend::data_callback(AAudioStream*, void* user_data,
                                                                  void* audio_data, int32_t num_frames) {
    auto* backend = static_cast<AndroidAAudioBackend*>(user_data);
    auto* output = static_cast<float*>(audio_data);
    const int channels = backend->impl_->format.channels;
    int written = 0;
    if (backend->active_.load(std::memory_order_acquire) && backend->impl_->callback) {
        written = backend->impl_->callback(output, num_frames, channels);
    }
    written = std::max(0, std::min(written, num_frames));
    if (written < num_frames) {
        std::memset(output + static_cast<size_t>(written) * channels, 0,
                    static_cast<size_t>(num_frames - written) * channels * sizeof(float));
    }
    return AAUDIO_CALLBACK_RESULT_CONTINUE;
}

void AndroidAAudioBackend::error_callback(AAudioStream*, void* user_data, aaudio_result_t error) {
    auto* backend = static_cast<AndroidAAudioBackend*>(user_data);
    backend->active_.store(false, std::memory_order_release);
    LOG_ERROR(std::string("AAudio stream error: ") + AAudio_convertResultToText(error));
}
