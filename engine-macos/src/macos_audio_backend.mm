#include "macos_audio_backend.h"

#include "logger.h"
#import <AudioToolbox/AudioToolbox.h>

#include <algorithm>
#include <cstring>
#include <vector>

struct MacOSAudioBackend::Impl {
    std::atomic<AudioQueueRef> queue{nullptr};
    AudioCallback callback;
    AudioFormat format{};
    int buffer_frames = 0;
    std::vector<AudioQueueBufferRef> buffers;
};

MacOSAudioBackend::MacOSAudioBackend() : impl_(std::make_unique<Impl>()) {}

MacOSAudioBackend::~MacOSAudioBackend() {
    close();
}

std::vector<DeviceInfo> MacOSAudioBackend::enumerate_devices() {
    return {{L"default", L"System Default Output", BackendType::DIRECTSOUND, true,
             2, {44100, 48000, 88200, 96000}, {32}, false, false}};
}

AudioFormat MacOSAudioBackend::open(const std::wstring&, const AudioFormat& requested_format,
                                    AudioCallback callback) {
    close();

    const int sample_rate = requested_format.sample_rate > 0 ? requested_format.sample_rate : 44100;
    const int channels = std::clamp(requested_format.channels, 1, 8);
    AudioStreamBasicDescription format{};
    format.mSampleRate = sample_rate;
    format.mFormatID = kAudioFormatLinearPCM;
    format.mFormatFlags = kAudioFormatFlagIsFloat | kAudioFormatFlagIsPacked;
    format.mBitsPerChannel = 32;
    format.mChannelsPerFrame = static_cast<UInt32>(channels);
    format.mFramesPerPacket = 1;
    format.mBytesPerFrame = static_cast<UInt32>(channels * sizeof(float));
    format.mBytesPerPacket = format.mBytesPerFrame;

    AudioQueueRef queue = nullptr;
    const OSStatus status = AudioQueueNewOutput(
        &format,
        reinterpret_cast<AudioQueueOutputCallback>(output_callback),
        this,
        nullptr,
        nullptr,
        0,
        &queue);
    if (status != noErr || !queue) {
        LOG_ERROR("CoreAudio: AudioQueueNewOutput failed: " + std::to_string(status));
        return {};
    }
    impl_->queue.store(queue, std::memory_order_release);

    impl_->callback = std::move(callback);
    impl_->format = {sample_rate, 32, channels};
    // About 20 ms, clamped to a safe lower bound. Triple buffering avoids
    // scheduling gaps without adding noticeable latency.
    impl_->buffer_frames = std::max(256, sample_rate / 50);
    const UInt32 buffer_bytes = static_cast<UInt32>(impl_->buffer_frames * format.mBytesPerFrame);
    for (int i = 0; i < 3; ++i) {
        AudioQueueBufferRef buffer = nullptr;
        if (AudioQueueAllocateBuffer(queue, buffer_bytes, &buffer) != noErr || !buffer) {
            LOG_ERROR("CoreAudio: AudioQueueAllocateBuffer failed");
            close();
            return {};
        }
        std::memset(buffer->mAudioData, 0, buffer_bytes);
        buffer->mAudioDataByteSize = buffer_bytes;
        if (AudioQueueEnqueueBuffer(queue, buffer, 0, nullptr) != noErr) {
            LOG_ERROR("CoreAudio: AudioQueueEnqueueBuffer failed");
            close();
            return {};
        }
        impl_->buffers.push_back(buffer);
    }
    LOG_INFO("CoreAudio opened: " + std::to_string(sample_rate) + "Hz/" +
             std::to_string(channels) + "ch float PCM");
    return impl_->format;
}

bool MacOSAudioBackend::start() {
    const auto queue = impl_->queue.load(std::memory_order_acquire);
    if (!queue || closing_.load(std::memory_order_acquire)) return false;
    active_.store(true, std::memory_order_release);
    const OSStatus status = AudioQueueStart(queue, nullptr);
    if (status != noErr) {
        active_.store(false, std::memory_order_release);
        LOG_ERROR("CoreAudio: AudioQueueStart failed: " + std::to_string(status));
        return false;
    }
    return true;
}

bool MacOSAudioBackend::stop() {
    active_.store(false, std::memory_order_release);
    const auto queue = impl_->queue.load(std::memory_order_acquire);
    if (!queue) return true;
    const OSStatus status = AudioQueuePause(queue);
    return status == noErr;
}

void MacOSAudioBackend::close() {
    active_.store(false, std::memory_order_release);
    closing_.store(true, std::memory_order_release);
    const auto queue = impl_->queue.exchange(nullptr, std::memory_order_acq_rel);
    if (queue) {
        LOG_INFO("CoreAudio: stopping output queue");
        AudioQueueStop(queue, true);
        AudioQueueDispose(queue, true);
        LOG_INFO("CoreAudio: output queue disposed");
    }
    impl_->buffers.clear();
    impl_->callback = nullptr;
    impl_->format = {};
    impl_->buffer_frames = 0;
    closing_.store(false, std::memory_order_release);
}

AudioFormat MacOSAudioBackend::current_format() const { return impl_->format; }
int MacOSAudioBackend::buffer_size_frames() const { return impl_->buffer_frames; }
double MacOSAudioBackend::latency_ms() const {
    return impl_->format.sample_rate > 0
        ? static_cast<double>(impl_->buffer_frames * 3) * 1000.0 / impl_->format.sample_rate
        : 0.0;
}

void MacOSAudioBackend::flush() {
    const auto queue = impl_->queue.load(std::memory_order_acquire);
    if (!queue || closing_.load(std::memory_order_acquire)) return;
    AudioQueueFlush(queue);
}

void MacOSAudioBackend::output_callback(void* user_data, void* callback_queue, void* queue_buffer) {
    auto* backend = static_cast<MacOSAudioBackend*>(user_data);
    auto* queue = static_cast<AudioQueueRef>(callback_queue);
    auto* buffer = static_cast<AudioQueueBufferRef>(queue_buffer);
    if (backend->closing_.load(std::memory_order_acquire)) return;
    const int frames = backend->impl_->buffer_frames;
    const int channels = backend->impl_->format.channels;
    if (frames <= 0 || channels <= 0) return;
    int written = 0;
    if (backend->active_.load(std::memory_order_acquire) && backend->impl_->callback) {
        written = backend->impl_->callback(static_cast<float*>(buffer->mAudioData), frames, channels);
    }
    written = std::clamp(written, 0, frames);
    if (written < frames) {
        std::memset(static_cast<float*>(buffer->mAudioData) + static_cast<size_t>(written) * channels,
                    0, static_cast<size_t>(frames - written) * channels * sizeof(float));
    }
    buffer->mAudioDataByteSize = static_cast<UInt32>(frames * channels * sizeof(float));
    const auto current_queue = backend->impl_->queue.load(std::memory_order_acquire);
    if (current_queue != queue || backend->closing_.load(std::memory_order_acquire)) return;
    AudioQueueEnqueueBuffer(queue, buffer, 0, nullptr);
}
