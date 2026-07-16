#include "dsound_backend.h"
#include "logger.h"

#include <algorithm>
#include <atomic>
#include <mutex>
#include <vector>
#define NOMINMAX
#include <windows.h>
#include <dsound.h>
#include <mmreg.h>
#include <process.h>

#pragma comment(lib, "dsound.lib")
#pragma comment(lib, "winmm.lib")

// ──────────────────────────────────────────────────────────
// Internal implementation (pimpl to avoid COM header leakage)
// ──────────────────────────────────────────────────────────

struct DSoundBackend::Impl {
    IDirectSound8* ds8 = nullptr;
    IDirectSoundBuffer* primary = nullptr;    // primary buffer: sets output format only
    IDirectSoundBuffer* secondary = nullptr;  // secondary buffer: actual playback
    IDirectSoundNotify8* notify = nullptr;
    HANDLE notify_events[2] = {nullptr, nullptr};
    HANDLE thread_handle = nullptr;
    std::atomic<bool> running{false};
    std::atomic<HRESULT> thread_error{S_OK};
    std::mutex buffer_mutex;
    WAVEFORMATEX wave_format = {};
    int buffer_frames = 0;
    int buffer_bytes = 0;
    int write_cursor = 0;
    std::vector<float> scratch;
    AudioCallback callback;
};

// ──────────────────────────────────────────────────────────
// Audio thread function
// ──────────────────────────────────────────────────────────

unsigned __stdcall dsound_thread_proc(void* param) {
    auto* impl = static_cast<DSoundBackend::Impl*>(param);

    // Set thread priority to highest (Pro Audio equivalent)
    SetThreadPriority(GetCurrentThread(), THREAD_PRIORITY_TIME_CRITICAL);

    HRESULT hr = impl->secondary->Play(0, 0, DSBPLAY_LOOPING);
    if (FAILED(hr)) {
        impl->thread_error.store(hr, std::memory_order_release);
        impl->running.store(false, std::memory_order_release);
        return 0;
    }

    while (impl->running.load(std::memory_order_acquire)) {
        DWORD result = WaitForMultipleObjects(2, impl->notify_events, FALSE, INFINITE);

        if (!impl->running.load(std::memory_order_acquire)) break;
        if (result != WAIT_OBJECT_0 && result != WAIT_OBJECT_0 + 1) {
            const HRESULT wait_hr = result == WAIT_FAILED
                ? HRESULT_FROM_WIN32(GetLastError()) : E_FAIL;
            impl->thread_error.store(wait_hr, std::memory_order_release);
            impl->running.store(false, std::memory_order_release);
            break;
        }

        int offset, lock_size;
        int channels = impl->wave_format.nChannels;
        int half_bytes = impl->buffer_bytes / 2;

        // Normal: fill the half that was just played
        int half = (result == WAIT_OBJECT_0) ? 1 : 0;
        offset = half * half_bytes;
        lock_size = half_bytes;

        void* ptr1 = nullptr;
        DWORD bytes1 = 0;
        void* ptr2 = nullptr;
        DWORD bytes2 = 0;

        std::lock_guard<std::mutex> guard(impl->buffer_mutex);

        hr = impl->secondary->Lock(offset, lock_size, &ptr1, &bytes1, &ptr2, &bytes2, 0);
        if (FAILED(hr)) {
            impl->thread_error.store(hr, std::memory_order_release);
            impl->running.store(false, std::memory_order_release);
            break;
        }

        int frames = lock_size / (channels * sizeof(short));
        if (frames <= 0) { impl->secondary->Unlock(ptr1, bytes1, ptr2, bytes2); continue; }

        float* f32_output = impl->scratch.data();
        const int rendered = std::clamp(impl->callback(f32_output, frames, channels), 0, frames);

        // Convert f32 → s16
        short* s16_ptr1 = static_cast<short*>(ptr1);
        int samples1 = bytes1 / sizeof(short);
        int total_samples = rendered * channels;
        for (int i = 0; i < samples1 && i < total_samples; ++i) {
            float sample = f32_output[i];
            s16_ptr1[i] = static_cast<short>(std::max(-1.0f, std::min(1.0f, sample)) * 32767.0f);
        }

        if (ptr2) {
            short* s16_ptr2 = static_cast<short*>(ptr2);
            int samples2 = bytes2 / sizeof(short);
            int offset_samples = samples1;
            for (int i = 0; i < samples2 && (offset_samples + i) < total_samples; ++i) {
                float sample = f32_output[offset_samples + i];
                s16_ptr2[i] = static_cast<short>(std::max(-1.0f, std::min(1.0f, sample)) * 32767.0f);
            }
        }

        hr = impl->secondary->Unlock(ptr1, bytes1, ptr2, bytes2);
        if (FAILED(hr)) {
            impl->thread_error.store(hr, std::memory_order_release);
            impl->running.store(false, std::memory_order_release);
            break;
        }
    }

    hr = impl->secondary->Stop();
    if (FAILED(hr) && SUCCEEDED(impl->thread_error.load(std::memory_order_acquire))) {
        impl->thread_error.store(hr, std::memory_order_release);
    }
    return 0;
}

// ──────────────────────────────────────────────────────────
// DSoundBackend implementation
// ──────────────────────────────────────────────────────────

DSoundBackend::DSoundBackend() : impl_(std::make_unique<Impl>()) {}

DSoundBackend::~DSoundBackend() {
    close();
}

std::vector<DeviceInfo> DSoundBackend::enumerate_devices() {
    std::vector<DeviceInfo> devices;

    // Enumerate DirectSound devices via DirectSoundEnumerate
    auto enum_callback = [](LPGUID guid, LPCWSTR desc, LPCWSTR /*module*/,
                            LPVOID context) -> BOOL {
        auto* list = static_cast<std::vector<DeviceInfo>*>(context);
        DeviceInfo info;
        info.name = desc ? desc : L"Primary Sound Driver";
        info.backend = BackendType::DIRECTSOUND;
        info.sample_rates = {44100, 48000};
        info.bit_depths = {16};
        info.max_channels = 2;
        info.supports_exclusive = false;
        info.supports_dsd = false;
        info.is_default = (guid == nullptr);

        if (guid) {
            wchar_t guid_str[64];
            StringFromGUID2(*guid, guid_str, 64);
            info.id = guid_str;
        } else {
            info.id = L"default";
        }

        list->push_back(info);
        return TRUE;
    };

    DirectSoundEnumerateW(enum_callback, &devices);
    return devices;
}

AudioFormat DSoundBackend::open(
    const std::wstring& device_id,
    const AudioFormat& requested_format,
    AudioCallback callback)
{
    close();
    impl_->callback = std::move(callback);
    HRESULT hr;

    // Create DirectSound8
    IDirectSound8* ds8 = nullptr;
    hr = DirectSoundCreate8(nullptr, &ds8, nullptr);
    if (FAILED(hr)) {
        LOG_ERROR("DirectSoundCreate8 failed: hr=0x" + std::to_string(hr));
        return {};
    }
    impl_->ds8 = ds8;

    // Set cooperative level
    HWND hwnd = GetForegroundWindow();
    hr = ds8->SetCooperativeLevel(hwnd, DSSCL_PRIORITY);
    if (FAILED(hr)) {
        LOG_WARN("SetCooperativeLevel failed, trying NORMAL");
        hr = ds8->SetCooperativeLevel(hwnd, DSSCL_NORMAL);
    }

    // Setup WAVEFORMATEX
    auto& fmt = impl_->wave_format;
    ZeroMemory(&fmt, sizeof(fmt));
    fmt.wFormatTag = WAVE_FORMAT_PCM;
    fmt.nChannels = static_cast<WORD>(std::min(requested_format.channels, 2));
    fmt.nSamplesPerSec = requested_format.sample_rate > 0 ? requested_format.sample_rate : 44100;
    fmt.wBitsPerSample = 16;
    fmt.nBlockAlign = fmt.nChannels * fmt.wBitsPerSample / 8;
    fmt.nAvgBytesPerSec = fmt.nSamplesPerSec * fmt.nBlockAlign;

    // ── Step 1: Create primary buffer (sets output format) ──
    DSBUFFERDESC desc = {};
    desc.dwSize = sizeof(DSBUFFERDESC);
    desc.dwFlags = DSBCAPS_PRIMARYBUFFER;
    desc.dwBufferBytes = 0; // Must be 0 for primary buffer

    IDirectSoundBuffer* primary = nullptr;
    hr = ds8->CreateSoundBuffer(&desc, &primary, nullptr);
    if (FAILED(hr)) {
        LOG_ERROR("CreateSoundBuffer (primary) failed: hr=0x" + std::to_string(hr));
        return {};
    }
    impl_->primary = primary;

    // Set primary buffer format — this controls hardware output format
    hr = primary->SetFormat(&fmt);
    if (FAILED(hr)) {
        LOG_WARN("SetFormat on primary buffer failed, continuing anyway");
    }

    // ── Step 2: Create secondary streaming buffer ──
    // Double-buffered: each half = 100ms, total = 200ms
    // Notification at 0% and 50% to fill the just-played half
    int half_frames = fmt.nSamplesPerSec / 10;                  // 100ms worth of frames
    impl_->buffer_frames = half_frames;
    impl_->buffer_bytes = half_frames * fmt.nBlockAlign * 2;     // total buffer = 2 halves
    // The streaming callback fills one half, while flush() may fill both.
    impl_->scratch.assign(static_cast<size_t>(half_frames) * 2 * fmt.nChannels, 0.0f);
    impl_->write_cursor = 0;

    DSBUFFERDESC desc2 = {};
    desc2.dwSize = sizeof(DSBUFFERDESC);
    desc2.dwFlags = DSBCAPS_GLOBALFOCUS | DSBCAPS_CTRLPOSITIONNOTIFY | DSBCAPS_GETCURRENTPOSITION2;
    desc2.dwBufferBytes = impl_->buffer_bytes;
    desc2.lpwfxFormat = &fmt;

    IDirectSoundBuffer* secondary = nullptr;
    hr = ds8->CreateSoundBuffer(&desc2, &secondary, nullptr);
    if (FAILED(hr)) {
        LOG_ERROR("CreateSoundBuffer (secondary) failed: hr=0x" + std::to_string(hr));
        return {};
    }
    impl_->secondary = secondary;

    current_format_.sample_rate = fmt.nSamplesPerSec;
    current_format_.bit_depth = fmt.wBitsPerSample;
    current_format_.channels = fmt.nChannels;

    buffer_frames_ = half_frames; // half buffer = 100ms
    latency_ms_ = (double)(half_frames * 2) / fmt.nSamplesPerSec * 1000.0; // total 200ms

    LOG_INFO("DSoundBackend opened: " + std::to_string(fmt.nSamplesPerSec) + "Hz, " +
             std::to_string(fmt.nChannels) + "ch, " +
             std::to_string(half_frames) + "f/half × 2, " +
             std::to_string(latency_ms_) + "ms total latency");

    return current_format_;
}

bool DSoundBackend::start() {
    if (!impl_->secondary || active_) return false;

    // ── Pre-fill the first half of the buffer with audio ──
    // (the second half gets filled on the first notification)
    {
        void* ptr1 = nullptr;
        DWORD bytes1 = 0;
        void* ptr2 = nullptr;
        DWORD bytes2 = 0;
        int half_bytes = impl_->buffer_bytes / 2;
        HRESULT hr = impl_->secondary->Lock(0, half_bytes, &ptr1, &bytes1, &ptr2, &bytes2, 0);
        if (SUCCEEDED(hr)) {
            int frames = half_bytes / (impl_->wave_format.nChannels * sizeof(short));
            float* f32_buf = impl_->scratch.data();
            impl_->callback(f32_buf, frames, impl_->wave_format.nChannels);
            short* s16_ptr1 = static_cast<short*>(ptr1);
            int samples1 = bytes1 / sizeof(short);
            for (int i = 0; i < samples1 && i < frames * impl_->wave_format.nChannels; ++i) {
                float sample = f32_buf[i];
                s16_ptr1[i] = static_cast<short>(std::max(-1.0f, std::min(1.0f, sample)) * 32767.0f);
            }
            if (ptr2) std::memset(ptr2, 0, bytes2);
            hr = impl_->secondary->Unlock(ptr1, bytes1, ptr2, bytes2);
            if (FAILED(hr)) {
                LOG_ERROR("DSoundBackend prefill Unlock failed: hr=0x" + std::to_string(hr));
                return false;
            }
        } else {
            LOG_ERROR("DSoundBackend prefill Lock failed: hr=0x" + std::to_string(hr));
            return false;
        }
    }

    // Create notify events
    impl_->notify_events[0] = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    impl_->notify_events[1] = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!impl_->notify_events[0] || !impl_->notify_events[1]) {
        LOG_ERROR("DSoundBackend could not create notification events: error=" + std::to_string(GetLastError()));
        return false;
    }

    // Set up notifications at 0% and 50% of the secondary buffer
    IDirectSoundNotify8* notify = nullptr;
    HRESULT hr = impl_->secondary->QueryInterface(IID_IDirectSoundNotify8,
                                                   (void**)&notify);
    if (FAILED(hr) || !notify) {
        LOG_ERROR("DSoundBackend QueryInterface(IDirectSoundNotify8) failed: hr=0x" + std::to_string(hr));
        return false;
    }
    impl_->notify = notify;
    DSBPOSITIONNOTIFY positions[2];
    positions[0].dwOffset = 0;
    positions[0].hEventNotify = impl_->notify_events[0];
    positions[1].dwOffset = impl_->buffer_bytes / 2;
    positions[1].hEventNotify = impl_->notify_events[1];
    hr = notify->SetNotificationPositions(2, positions);
    if (FAILED(hr)) {
        LOG_ERROR("DSoundBackend SetNotificationPositions failed: hr=0x" + std::to_string(hr));
        return false;
    }

    impl_->thread_error.store(S_OK, std::memory_order_release);
    impl_->running.store(true, std::memory_order_release);
    impl_->thread_handle = (HANDLE)_beginthreadex(
        nullptr, 0, dsound_thread_proc, impl_.get(), 0, nullptr);

    if (!impl_->thread_handle) {
        impl_->running.store(false, std::memory_order_release);
        LOG_ERROR("DSoundBackend could not create render thread");
        return false;
    }

    active_ = true;
    LOG_INFO("DSoundBackend started (" + std::to_string(impl_->buffer_bytes) + " bytes buffer)");
    return true;
}

bool DSoundBackend::stop() {
    if (!active_) return false;

    impl_->running.store(false, std::memory_order_release);

    // Wake up the thread
    if (impl_->notify_events[0]) SetEvent(impl_->notify_events[0]);

    if (impl_->thread_handle) {
        WaitForSingleObject(impl_->thread_handle, INFINITE);
        CloseHandle(impl_->thread_handle);
        impl_->thread_handle = nullptr;
    }

    const HRESULT thread_error = impl_->thread_error.load(std::memory_order_acquire);
    if (FAILED(thread_error)) {
        LOG_ERROR("DSoundBackend render thread stopped: hr=0x" + std::to_string(thread_error));
    }

    active_ = false;
    LOG_INFO("DSoundBackend stopped");
    return true;
}

void DSoundBackend::flush() {
    if (!impl_->secondary || !impl_->running.load(std::memory_order_acquire)) return;

    std::lock_guard<std::mutex> guard(impl_->buffer_mutex);

    impl_->secondary->Stop();
    impl_->secondary->SetCurrentPosition(0);

    void* ptr1 = nullptr;
    DWORD bytes1 = 0;
    void* ptr2 = nullptr;
    DWORD bytes2 = 0;

    HRESULT hr = impl_->secondary->Lock(0, impl_->buffer_bytes, &ptr1, &bytes1, &ptr2, &bytes2, 0);
    if (SUCCEEDED(hr)) {
        int channels = impl_->wave_format.nChannels;
        int frames = impl_->buffer_bytes / (channels * sizeof(short));
        float* f32_output = impl_->scratch.data();
        int rendered = impl_->callback(f32_output, frames, channels);
        int total_samples = rendered * channels;

        short* s16_ptr1 = static_cast<short*>(ptr1);
        int samples1 = bytes1 / sizeof(short);
        for (int i = 0; i < samples1; ++i) {
            if (i < total_samples) {
                float sample = f32_output[i];
                s16_ptr1[i] = static_cast<short>(std::max(-1.0f, std::min(1.0f, sample)) * 32767.0f);
            } else {
                s16_ptr1[i] = 0;
            }
        }

        if (ptr2) {
            short* s16_ptr2 = static_cast<short*>(ptr2);
            int samples2 = bytes2 / sizeof(short);
            int offset_samples = samples1;
            for (int i = 0; i < samples2; ++i) {
                int sample_index = offset_samples + i;
                if (sample_index < total_samples) {
                    float sample = f32_output[sample_index];
                    s16_ptr2[i] = static_cast<short>(std::max(-1.0f, std::min(1.0f, sample)) * 32767.0f);
                } else {
                    s16_ptr2[i] = 0;
                }
            }
        }

        impl_->secondary->Unlock(ptr1, bytes1, ptr2, bytes2);
    }

    impl_->secondary->Play(0, 0, DSBPLAY_LOOPING);

    // Wake the audio thread so normal half-buffer refills resume promptly.
    if (impl_->notify_events[0]) SetEvent(impl_->notify_events[0]);
    LOG_INFO("DSoundBackend flushed");
}

void DSoundBackend::close() {
    if (active_) stop();

    if (impl_->notify) {
        impl_->notify->Release();
        impl_->notify = nullptr;
    }
    for (auto& ev : impl_->notify_events) {
        if (ev) { CloseHandle(ev); ev = nullptr; }
    }
    if (impl_->secondary) {
        impl_->secondary->Stop();
        impl_->secondary->Release();
        impl_->secondary = nullptr;
    }
    if (impl_->primary) {
        impl_->primary->Release();
        impl_->primary = nullptr;
    }
    if (impl_->ds8) {
        impl_->ds8->Release();
        impl_->ds8 = nullptr;
    }
    LOG_INFO("DSoundBackend closed");
}
