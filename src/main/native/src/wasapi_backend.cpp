#include "wasapi_backend.h"
#include "logger.h"

#include <atomic>
#include <vector>
#define NOMINMAX
#include <windows.h>
#include <initguid.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <functiondiscoverykeys_devpkey.h>
#include <process.h>

#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "uuid.lib")

// ──────────────────────────────────────────────────────────
// MMCSS helpers (dynamically loaded — avrt.dll may not exist on Server SKUs)
// ──────────────────────────────────────────────────────────

typedef HANDLE (WINAPI *PFN_AvSetMmThreadCharacteristicsW)(LPCWSTR, LPDWORD);
typedef BOOL  (WINAPI *PFN_AvRevertMmThreadCharacteristics)(HANDLE);

static PFN_AvSetMmThreadCharacteristicsW  pAvSetMmThread = nullptr;
static PFN_AvRevertMmThreadCharacteristics pAvRevertMmThread = nullptr;

// ──────────────────────────────────────────────────────────
// Define WASAPI IIDs (some SDK configurations don't expose
// these via a default .lib; we provide them here explicitly).
// ──────────────────────────────────────────────────────────
DEFINE_GUID(IID_IAudioClient,
    0x1CB9AD4C, 0xDBFA, 0x4c32, 0xB1, 0x78, 0xC2, 0xF5, 0x68, 0xA7, 0x03, 0xB2);
DEFINE_GUID(IID_IAudioRenderClient,
    0xF294ACFC, 0x3146, 0x4483, 0xA7, 0xBF, 0xAD, 0xDC, 0xA7, 0xC2, 0x60, 0xE2);

// ──────────────────────────────────────────────────────────
// MMCSS helpers (dynamically loaded — avrt.dll may not exist on Server SKUs)
// ──────────────────────────────────────────────────────────

static void load_mmcss() {
    static bool tried = false;
    if (tried) return;
    tried = true;
    HMODULE avrt = LoadLibraryW(L"avrt.dll");
    if (!avrt) return;
    pAvSetMmThread    = (PFN_AvSetMmThreadCharacteristicsW)
                         GetProcAddress(avrt, "AvSetMmThreadCharacteristicsW");
    pAvRevertMmThread = (PFN_AvRevertMmThreadCharacteristics)
                         GetProcAddress(avrt, "AvRevertMmThreadCharacteristics");
}

// ──────────────────────────────────────────────────────────
// COM guard — initialises COM on the calling thread if not
// already done, and uninitialises only when we were the first.
// ──────────────────────────────────────────────────────────

struct ComGuard {
    bool need_uninit = false;
    ComGuard() {
        HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
        if (SUCCEEDED(hr)) {
            need_uninit = true;
        } else if (hr == RPC_E_CHANGED_MODE) {
            // Host (Electron) already initialised COM with a different
            // concurrency model — we can still use COM, but must not
            // uninitialise on this thread.
        }
        // Any other error is fatal for COM usage.
    }
    ~ComGuard() {
        if (need_uninit) CoUninitialize();
    }
};

// ──────────────────────────────────────────────────────────
// Internal implementation
// ──────────────────────────────────────────────────────────

struct WasapiBackend::Impl {
    // COM objects
    IMMDeviceEnumerator* enumerator = nullptr;
    IMMDevice*           device      = nullptr;
    IAudioClient*        audio_client = nullptr;
    IAudioRenderClient*  render_client = nullptr;

    // Thread
    HANDLE event_handle  = nullptr;
    HANDLE thread_handle = nullptr;
    std::atomic<bool> running{false};

    // Format
    WAVEFORMATEX* wave_format = nullptr;
    UINT32  buffer_frames = 0;
    int     bytes_per_frame = 0;   // nBlockAlign
    double  latency_ms = 0.0;
    bool    is_f32 = true;         // whether the buffer expects float32 samples
    bool    exclusive = false;     // exclusive vs shared mode

    // Callback
    AudioCallback callback;

    // f32→s16 scratch buffer (only used in exclusive s16 fallback)
    std::vector<float> scratch;
};

// ──────────────────────────────────────────────────────────
// Audio thread procedure
// ──────────────────────────────────────────────────────────

static unsigned __stdcall wasapi_thread_proc(void* param) {
    auto* impl = static_cast<WasapiBackend::Impl*>(param);

    // MMCSS Pro Audio
    load_mmcss();
    DWORD  mmcssTask  = 0;
    HANDLE mmcssHandle = nullptr;
    if (pAvSetMmThread) {
        mmcssHandle = pAvSetMmThread(L"Pro Audio", &mmcssTask);
    }

    // COM for this thread
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);

    int channels   = impl->wave_format->nChannels;
    int frame_size = impl->bytes_per_frame;

    impl->audio_client->Start();

    while (impl->running.load(std::memory_order_acquire)) {
        DWORD result = WaitForSingleObject(impl->event_handle, INFINITE);
        if (!impl->running.load(std::memory_order_acquire)) break;

        UINT32 available;
        if (impl->exclusive) {
            // Exclusive mode: we own the entire buffer. Always fill it.
            available = impl->buffer_frames;
        } else {
            // Shared mode: fill only the space not yet consumed by the engine.
            UINT32 padding = 0;
            impl->audio_client->GetCurrentPadding(&padding);
            available = impl->buffer_frames - padding;
        }
        if (available == 0) continue;

        BYTE* data = nullptr;
        HRESULT hr = impl->render_client->GetBuffer(available, &data);
        if (FAILED(hr)) continue;

        if (impl->is_f32) {
            // Direct f32 write — WASAPI Shared mix format, or Exclusive f32
            float* f32_data = reinterpret_cast<float*>(data);
            int rendered = impl->callback(f32_data, (int)available, channels);
            if (rendered < (int)available) {
                std::memset(f32_data + rendered * channels, 0,
                            ((int)available - rendered) * channels * sizeof(float));
            }
        } else {
            // Exclusive s16 fallback — convert from f32
            int total_samples = (int)available * channels;
            impl->scratch.resize(total_samples);
            int rendered = impl->callback(impl->scratch.data(), (int)available, channels);
            if (rendered < (int)available) {
                std::memset(impl->scratch.data() + rendered * channels, 0,
                            ((int)available - rendered) * channels * sizeof(float));
            }
            short* s16_data = reinterpret_cast<short*>(data);
            for (int i = 0; i < total_samples; ++i) {
                float s = impl->scratch[i];
                if (s > 1.0f) s = 1.0f; else if (s < -1.0f) s = -1.0f;
                s16_data[i] = static_cast<short>(s * 32767.0f);
            }
        }

        impl->render_client->ReleaseBuffer(available, 0);
    }

    impl->audio_client->Stop();
    CoUninitialize();

    if (mmcssHandle && pAvRevertMmThread) {
        pAvRevertMmThread(mmcssHandle);
    }

    return 0;
}

// ──────────────────────────────────────────────────────────
// Helper: create an IMMDeviceEnumerator (once)
// ──────────────────────────────────────────────────────────

static IMMDeviceEnumerator* get_enumerator() {
    IMMDeviceEnumerator* en = nullptr;
    HRESULT hr = CoCreateInstance(
        __uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
        IID_PPV_ARGS(&en));
    if (FAILED(hr)) {
        LOG_ERROR("CoCreateInstance(MMDeviceEnumerator) failed: 0x" +
                  std::to_string(hr));
    }
    return en;
}

// ──────────────────────────────────────────────────────────
// WasapiBackend implementation
// ──────────────────────────────────────────────────────────

WasapiBackend::WasapiBackend(bool exclusive)
    : exclusive_(exclusive)
    , impl_(std::make_unique<Impl>())
{
    impl_->exclusive = exclusive;
    LOG_INFO(std::string("WasapiBackend created (") +
             (exclusive ? "Exclusive" : "Shared") + ")");
}

WasapiBackend::~WasapiBackend() {
    close();
}

// ── enumerate_devices ─────────────────────────────────────

std::vector<DeviceInfo> WasapiBackend::enumerate_devices() {
    std::vector<DeviceInfo> devices;
    ComGuard com;

    IMMDeviceEnumerator* en = get_enumerator();
    if (!en) return devices;

    IMMDeviceCollection* collection = nullptr;
    HRESULT hr = en->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &collection);
    if (FAILED(hr)) {
        en->Release();
        return devices;
    }

    UINT count = 0;
    collection->GetCount(&count);

    for (UINT i = 0; i < count; ++i) {
        IMMDevice* dev = nullptr;
        if (FAILED(collection->Item(i, &dev))) continue;

        // Device ID
        LPWSTR id = nullptr;
        dev->GetId(&id);

        // Friendly name via property store
        std::wstring name = L"Unknown Device";
        IPropertyStore* props = nullptr;
        if (SUCCEEDED(dev->OpenPropertyStore(STGM_READ, &props))) {
            PROPVARIANT var;
            PropVariantInit(&var);
            if (SUCCEEDED(props->GetValue(PKEY_Device_FriendlyName, &var)) &&
                var.pwszVal) {
                name = var.pwszVal;
            }
            PropVariantClear(&var);
            props->Release();
        }

        DeviceInfo info;
        info.id         = id ? id : L"";
        info.name       = name;
        info.backend    = exclusive_ ? BackendType::WASAPI_EXCLUSIVE
                                     : BackendType::WASAPI_SHARED;
        info.is_default = (i == 0);  // first device is the default render endpoint
        info.max_channels     = 8;
        info.sample_rates     = {44100, 48000, 88200, 96000, 176400, 192000};
        info.bit_depths       = {16, 24, 32};
        info.supports_exclusive = true;
        info.supports_dsd     = false;

        devices.push_back(info);

        if (id) CoTaskMemFree(id);
        dev->Release();
    }

    collection->Release();
    en->Release();
    return devices;
}

// ── open ──────────────────────────────────────────────────

AudioFormat WasapiBackend::open(
    const std::wstring& device_id,
    const AudioFormat& requested_format,
    AudioCallback callback)
{
    close();
    impl_->callback = std::move(callback);
    ComGuard com;

    IMMDeviceEnumerator* en = get_enumerator();
    if (!en) return {};

    IMMDevice* dev = nullptr;
    HRESULT hr;

    if (device_id.empty() || device_id == L"default") {
        hr = en->GetDefaultAudioEndpoint(eRender, eConsole, &dev);
    } else {
        hr = en->GetDevice(device_id.c_str(), &dev);
    }
    en->Release();
    if (FAILED(hr) || !dev) {
        LOG_ERROR("WASAPI: failed to get audio endpoint (id=" +
                  std::string(device_id.begin(), device_id.end()) +
                  ") hr=0x" + std::to_string(hr));
        return {};
    }
    impl_->device = dev;

    // Activate IAudioClient
    IAudioClient* client = nullptr;
    hr = dev->Activate(IID_IAudioClient, CLSCTX_ALL, nullptr,
                        (void**)&client);
    if (FAILED(hr)) {
        LOG_ERROR("WASAPI: Activate(IAudioClient) failed: 0x" +
                  std::to_string(hr));
        return {};
    }
    impl_->audio_client = client;

    int sample_rate = requested_format.sample_rate > 0
                          ? requested_format.sample_rate : 44100;
    int channels    = std::min(std::max(requested_format.channels, 1), 8);

    WAVEFORMATEX* fmt = nullptr;

    if (exclusive_) {
        // ── Exclusive mode ────────────────────────────────
        // Build WAVEFORMATEXTENSIBLE for f32
        WAVEFORMATEXTENSIBLE wfext = {};
        wfext.Format.wFormatTag      = WAVE_FORMAT_EXTENSIBLE;
        wfext.Format.nChannels       = (WORD)channels;
        wfext.Format.nSamplesPerSec  = (DWORD)sample_rate;
        wfext.Format.wBitsPerSample  = 32;
        wfext.Format.nBlockAlign     = (WORD)(channels * 4);
        wfext.Format.nAvgBytesPerSec = (DWORD)(sample_rate * channels * 4);
        wfext.Format.cbSize          = sizeof(WAVEFORMATEXTENSIBLE) -
                                       sizeof(WAVEFORMATEX);
        wfext.Samples.wValidBitsPerSample = 32;
        wfext.dwChannelMask = channels == 1 ? KSAUDIO_SPEAKER_MONO
                                              : KSAUDIO_SPEAKER_STEREO;
        wfext.SubFormat = KSDATAFORMAT_SUBTYPE_IEEE_FLOAT;

        // Ask whether this format (f32) is supported
        WAVEFORMATEX* closest = nullptr;
        hr = client->IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE,
                                        &wfext.Format, &closest);
        if (hr == AUDCLNT_E_UNSUPPORTED_FORMAT) {
            LOG_WARN("WASAPI Exclusive: f32 not supported, trying s16");
            // Build a s16 format
            ZeroMemory(&wfext, sizeof(wfext));
            wfext.Format.wFormatTag      = WAVE_FORMAT_EXTENSIBLE;
            wfext.Format.nChannels       = (WORD)channels;
            wfext.Format.nSamplesPerSec  = (DWORD)sample_rate;
            wfext.Format.wBitsPerSample  = 16;
            wfext.Format.nBlockAlign     = (WORD)(channels * 2);
            wfext.Format.nAvgBytesPerSec = (DWORD)(sample_rate * channels * 2);
            wfext.Format.cbSize          = sizeof(WAVEFORMATEXTENSIBLE) -
                                           sizeof(WAVEFORMATEX);
            wfext.Samples.wValidBitsPerSample = 16;
            wfext.dwChannelMask = channels == 1 ? KSAUDIO_SPEAKER_MONO
                                                : KSAUDIO_SPEAKER_STEREO;
            wfext.SubFormat = KSDATAFORMAT_SUBTYPE_PCM;

            hr = client->IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE,
                                            &wfext.Format, &closest);
            if (FAILED(hr)) {
                LOG_ERROR("WASAPI Exclusive: s16 also unsupported");
                return {};
            }
            impl_->is_f32 = false;
        } else if (hr == S_FALSE && closest) {
            // Engine offered a closest match — use it
            fmt = closest;
            impl_->is_f32 = (closest->wBitsPerSample == 32 &&
                             (closest->wFormatTag == WAVE_FORMAT_EXTENSIBLE ||
                              closest->wFormatTag == WAVE_FORMAT_IEEE_FLOAT));
        }

        if (!fmt) {
            fmt = (WAVEFORMATEX*)CoTaskMemAlloc(sizeof(WAVEFORMATEXTENSIBLE));
            memcpy(fmt, &wfext, sizeof(wfext));
        }

        // For exclusive mode, hnsBufferDuration and hnsPeriodicity
        // must be equal (AUDCLNT_E_BUFDURATION_PERIOD_NOT_EQUAL otherwise).
        // Query the device's default period and use that.
        REFERENCE_TIME hnsDefault = 0, hnsMin = 0;
        client->GetDevicePeriod(&hnsDefault, &hnsMin);
        REFERENCE_TIME hnsPeriod = hnsDefault > 0 ? hnsDefault : 100000;

        hr = client->Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE,
                                 AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                                 hnsPeriod,   // must equal hnsPeriodicity
                                 hnsPeriod,
                                 fmt,
                                 nullptr);
        if (FAILED(hr)) {
            LOG_ERROR("WASAPI Exclusive: Initialize failed: 0x" +
                      std::to_string(hr) + " (period=" +
                      std::to_string(hnsPeriod / 10000.0) + "ms)");
            CoTaskMemFree(fmt);
            return {};
        }
    } else {
        // ── Shared mode ───────────────────────────────────
        WAVEFORMATEX* mix_fmt = nullptr;
        hr = client->GetMixFormat(&mix_fmt);
        if (FAILED(hr)) {
            LOG_ERROR("WASAPI Shared: GetMixFormat failed: 0x" +
                      std::to_string(hr));
            return {};
        }

        // Modify to match requested format (but keep wBitsPerSample/wFormatTag
        // from the mix format so the engine can accept it)
        mix_fmt->nChannels      = (WORD)channels;
        mix_fmt->nSamplesPerSec = (DWORD)sample_rate;
        mix_fmt->nBlockAlign    = mix_fmt->nChannels * mix_fmt->wBitsPerSample / 8;
        mix_fmt->nAvgBytesPerSec = mix_fmt->nSamplesPerSec * mix_fmt->nBlockAlign;

        fmt = mix_fmt; // ownership transferred; will be freed below
        impl_->is_f32 = (fmt->wBitsPerSample == 32);

        hr = client->Initialize(AUDCLNT_SHAREMODE_SHARED,
                                 AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                                 0,   // engine chooses buffer duration
                                 0,   // must be 0 for shared mode
                                 fmt,
                                 nullptr);
        if (FAILED(hr)) {
            LOG_ERROR("WASAPI Shared: Initialize failed: 0x" +
                      std::to_string(hr));
            CoTaskMemFree(fmt);
            return {};
        }
    }

    impl_->wave_format = fmt;

    // Get buffer size (frames)
    hr = client->GetBufferSize(&impl_->buffer_frames);
    if (FAILED(hr)) {
        CoTaskMemFree(fmt);
        impl_->wave_format = nullptr;
        return {};
    }

    impl_->bytes_per_frame = fmt->nBlockAlign;

    // Calculate latency
    REFERENCE_TIME period = 0;
    client->GetDevicePeriod(nullptr, &period);
    if (period > 0) {
        impl_->latency_ms = (double)period / 10000.0; // hns → ms
    } else {
        impl_->latency_ms = (double)impl_->buffer_frames /
                            (double)fmt->nSamplesPerSec * 1000.0;
    }

    // Create event handle (must be AFTER Initialize)
    impl_->event_handle = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    if (!impl_->event_handle) {
        LOG_ERROR("WASAPI: CreateEvent failed");
        return {};
    }
    hr = client->SetEventHandle(impl_->event_handle);
    if (FAILED(hr)) {
        LOG_ERROR("WASAPI: SetEventHandle failed: 0x" + std::to_string(hr));
        return {};
    }

    // Get render client
    IAudioRenderClient* rc = nullptr;
    hr = client->GetService(IID_IAudioRenderClient, (void**)&rc);
    if (FAILED(hr)) {
        LOG_ERROR("WASAPI: GetService(IAudioRenderClient) failed: 0x" +
                  std::to_string(hr));
        return {};
    }
    impl_->render_client = rc;

    current_format_.sample_rate = fmt->nSamplesPerSec;
    current_format_.bit_depth   = fmt->wBitsPerSample;
    current_format_.channels    = fmt->nChannels;
    buffer_frames_ = (int)impl_->buffer_frames;
    latency_ms_    = impl_->latency_ms;

    LOG_INFO(std::string("WasapiBackend opened (") +
             (exclusive_ ? "Exclusive" : "Shared") + "): " +
             std::to_string(fmt->nSamplesPerSec) + "Hz, " +
             std::to_string(fmt->nChannels) + "ch, " +
             std::to_string(fmt->wBitsPerSample) + "bit, " +
             std::to_string(impl_->buffer_frames) + "f buffer, " +
             std::to_string(impl_->latency_ms) + "ms latency");

    return current_format_;
}

// ── start ─────────────────────────────────────────────────

bool WasapiBackend::start() {
    if (!impl_->audio_client || active_) return false;

    impl_->running.store(true, std::memory_order_release);
    impl_->thread_handle = (HANDLE)_beginthreadex(
        nullptr, 0, wasapi_thread_proc, impl_.get(), 0, nullptr);

    active_ = true;
    LOG_INFO("WasapiBackend started");
    return true;
}

// ── stop ──────────────────────────────────────────────────

bool WasapiBackend::stop() {
    if (!active_) return false;

    impl_->running.store(false, std::memory_order_release);

    // Wake up the thread
    if (impl_->event_handle) SetEvent(impl_->event_handle);

    if (impl_->thread_handle) {
        WaitForSingleObject(impl_->thread_handle, 5000);
        CloseHandle(impl_->thread_handle);
        impl_->thread_handle = nullptr;
    }

    active_ = false;
    LOG_INFO("WasapiBackend stopped");
    return true;
}

// ── flush ─────────────────────────────────────────────────

void WasapiBackend::flush() {
    if (!impl_->audio_client || !impl_->running.load(std::memory_order_acquire))
        return;

    impl_->audio_client->Stop();
    impl_->audio_client->Reset();
    // Clear the scratch buffer to avoid leaking stale converted samples
    impl_->scratch.clear();
    impl_->audio_client->Start();
    LOG_INFO("WasapiBackend flushed");
}

// ── close ─────────────────────────────────────────────────

void WasapiBackend::close() {
    if (active_) stop();

    if (impl_->render_client) {
        impl_->render_client->Release();
        impl_->render_client = nullptr;
    }
    if (impl_->audio_client) {
        impl_->audio_client->Release();
        impl_->audio_client = nullptr;
    }
    if (impl_->device) {
        impl_->device->Release();
        impl_->device = nullptr;
    }
    if (impl_->event_handle) {
        CloseHandle(impl_->event_handle);
        impl_->event_handle = nullptr;
    }
    if (impl_->wave_format) {
        CoTaskMemFree(impl_->wave_format);
        impl_->wave_format = nullptr;
    }
    LOG_INFO("WasapiBackend closed");
}
