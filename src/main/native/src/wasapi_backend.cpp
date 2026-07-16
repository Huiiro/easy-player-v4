#include "wasapi_backend.h"
#include "logger.h"

#include <algorithm>
#include <atomic>
#include <cstdint>
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
    // The render thread must not emit IPC-backed logs.  It records the first
    // fatal HRESULT here and the control thread reports it after joining.
    std::atomic<HRESULT> thread_error{S_OK};

    // Format
    WAVEFORMATEX* wave_format = nullptr;
    UINT32  buffer_frames = 0;
    int     bytes_per_frame = 0;   // nBlockAlign
    double  latency_ms = 0.0;
    bool    is_f32 = true;         // whether the buffer expects float32 samples
    int     pcm_bits = 0;          // 16/24/32 when the exclusive buffer is PCM
    int     pcm_valid_bits = 0;    // permits 24 valid bits in a 32-bit container
    bool    exclusive = false;     // exclusive vs shared mode

    // Callback
    AudioCallback callback;
    RawAudioCallback raw_callback;
    bool raw_transport = false;

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

    // COM for this thread.  Do not call CoUninitialize unless this invocation
    // actually acquired a COM initialisation reference.
    const HRESULT com_hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    const bool com_initialized = SUCCEEDED(com_hr);
    if (FAILED(com_hr) && com_hr != RPC_E_CHANGED_MODE) {
        impl->thread_error.store(com_hr, std::memory_order_release);
        impl->running.store(false, std::memory_order_release);
        if (mmcssHandle && pAvRevertMmThread) pAvRevertMmThread(mmcssHandle);
        return 0;
    }

    int channels   = impl->wave_format->nChannels;
    int frame_size = impl->bytes_per_frame;

    HRESULT hr = impl->audio_client->Start();
    if (FAILED(hr)) {
        impl->thread_error.store(hr, std::memory_order_release);
        impl->running.store(false, std::memory_order_release);
    }

    while (impl->running.load(std::memory_order_acquire)) {
        DWORD result = WaitForSingleObject(impl->event_handle, INFINITE);
        if (!impl->running.load(std::memory_order_acquire)) break;
        if (result != WAIT_OBJECT_0) {
            const HRESULT wait_hr = result == WAIT_FAILED
                ? HRESULT_FROM_WIN32(GetLastError()) : E_FAIL;
            impl->thread_error.store(wait_hr, std::memory_order_release);
            impl->running.store(false, std::memory_order_release);
            break;
        }

        UINT32 available;
        if (impl->exclusive) {
            // Exclusive mode: we own the entire buffer. Always fill it.
            available = impl->buffer_frames;
        } else {
            // Shared mode: fill only the space not yet consumed by the engine.
            UINT32 padding = 0;
            hr = impl->audio_client->GetCurrentPadding(&padding);
            if (FAILED(hr)) {
                impl->thread_error.store(hr, std::memory_order_release);
                impl->running.store(false, std::memory_order_release);
                break;
            }
            available = impl->buffer_frames - padding;
        }
        if (available == 0) continue;

        BYTE* data = nullptr;
        hr = impl->render_client->GetBuffer(available, &data);
        if (FAILED(hr)) {
            impl->thread_error.store(hr, std::memory_order_release);
            impl->running.store(false, std::memory_order_release);
            break;
        }

        if (impl->raw_transport) {
            const int rendered = std::clamp(
                impl->raw_callback ? impl->raw_callback(data, static_cast<int>(available), channels) : 0,
                0, static_cast<int>(available));
            if (rendered < static_cast<int>(available)) {
                std::memset(data + rendered * frame_size, 0,
                            (static_cast<int>(available) - rendered) * frame_size);
            }
        } else if (impl->is_f32) {
            // Direct f32 write — WASAPI Shared mix format, or Exclusive f32
            float* f32_data = reinterpret_cast<float*>(data);
            const int rendered = std::clamp(impl->callback(f32_data, (int)available, channels),
                                            0, static_cast<int>(available));
            if (rendered < (int)available) {
                std::memset(f32_data + rendered * channels, 0,
                            ((int)available - rendered) * channels * sizeof(float));
            }
        } else {
            // Exclusive integer PCM fallback — convert from f32.
            int total_samples = (int)available * channels;
            const int rendered = std::clamp(impl->callback(impl->scratch.data(), (int)available, channels),
                                            0, static_cast<int>(available));
            if (rendered < (int)available) {
                std::memset(impl->scratch.data() + rendered * channels, 0,
                            ((int)available - rendered) * channels * sizeof(float));
            }
            for (int i = 0; i < total_samples; ++i) {
                const float s = std::max(-1.0f, std::min(1.0f, impl->scratch[i]));
                if (impl->pcm_valid_bits == 24 && impl->pcm_bits == 24) {
                    const int value = static_cast<int>(s * 8388607.0f);
                    data[i * 3] = static_cast<BYTE>(value & 0xFF);
                    data[i * 3 + 1] = static_cast<BYTE>((value >> 8) & 0xFF);
                    data[i * 3 + 2] = static_cast<BYTE>((value >> 16) & 0xFF);
                } else if (impl->pcm_valid_bits == 24 && impl->pcm_bits == 32) {
                    reinterpret_cast<int32_t*>(data)[i] = static_cast<int32_t>(static_cast<int>(s * 8388607.0f) << 8);
                } else if (impl->pcm_bits == 32) {
                    reinterpret_cast<int32_t*>(data)[i] = static_cast<int32_t>(s * 2147483647.0f);
                } else {
                    reinterpret_cast<int16_t*>(data)[i] = static_cast<int16_t>(s * 32767.0f);
                }
            }
        }

        hr = impl->render_client->ReleaseBuffer(available, 0);
        if (FAILED(hr)) {
            impl->thread_error.store(hr, std::memory_order_release);
            impl->running.store(false, std::memory_order_release);
            break;
        }
    }

    hr = impl->audio_client->Stop();
    if (FAILED(hr) && SUCCEEDED(impl->thread_error.load(std::memory_order_acquire))) {
        impl->thread_error.store(hr, std::memory_order_release);
    }
    if (com_initialized) CoUninitialize();

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
    if (!preparing_dop_open_) {
        impl_->raw_callback = {};
        impl_->raw_transport = false;
    }
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
        // One exact encoding per open attempt. AudioEngine retries f32,
        // packed PCM24 and PCM16 at a rate before it lowers that rate.
        const bool request_f32 = requested_format.bit_depth == 32;
        const bool request_pcm24_in_32 = requested_format.bit_depth == 25;
        const int requested_pcm_bits = request_f32 ? 32 : (request_pcm24_in_32 ? 32 : (requested_format.bit_depth == 24 ? 24 : 16));
        const int requested_valid_bits = request_pcm24_in_32 ? 24 : requested_pcm_bits;
        impl_->is_f32 = request_f32;
        impl_->pcm_bits = request_f32 ? 0 : requested_pcm_bits;
        impl_->pcm_valid_bits = request_f32 ? 0 : requested_valid_bits;
        WAVEFORMATEXTENSIBLE wfext = {};
        wfext.Format.wFormatTag      = WAVE_FORMAT_EXTENSIBLE;
        wfext.Format.nChannels       = (WORD)channels;
        wfext.Format.nSamplesPerSec  = (DWORD)sample_rate;
        wfext.Format.wBitsPerSample  = (WORD)requested_pcm_bits;
        wfext.Format.nBlockAlign     = (WORD)(channels * (requested_pcm_bits / 8));
        wfext.Format.nAvgBytesPerSec = (DWORD)(sample_rate * wfext.Format.nBlockAlign);
        wfext.Format.cbSize          = sizeof(WAVEFORMATEXTENSIBLE) -
                                       sizeof(WAVEFORMATEX);
        wfext.Samples.wValidBitsPerSample = (WORD)requested_valid_bits;
        wfext.dwChannelMask = channels == 1 ? KSAUDIO_SPEAKER_MONO
                                              : KSAUDIO_SPEAKER_STEREO;
        wfext.SubFormat = request_f32 ? KSDATAFORMAT_SUBTYPE_IEEE_FLOAT : KSDATAFORMAT_SUBTYPE_PCM;

        // Ask whether this format (f32) is supported
        WAVEFORMATEX* closest = nullptr;
        hr = client->IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE,
                                        &wfext.Format, &closest);
        if (hr != S_OK) {
            if (closest) CoTaskMemFree(closest);
            LOG_WARN("WASAPI Exclusive: requested encoding unsupported at " +
                     std::to_string(sample_rate) + "Hz (" +
                     std::to_string(requested_valid_bits) + " valid / " +
                     std::to_string(requested_pcm_bits) + " container bits)");
            return {};
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
        if (hr == AUDCLNT_E_BUFFER_SIZE_NOT_ALIGNED) {
            // A device period can fall between two frame boundaries at this
            // exact sample rate. WASAPI reports the aligned size after the
            // failed call; use it for one fresh-client retry.
            UINT32 aligned_frames = 0;
            const HRESULT size_hr = client->GetBufferSize(&aligned_frames);
            client->Release();
            client = nullptr;
            impl_->audio_client = nullptr;

            if (SUCCEEDED(size_hr) && aligned_frames > 0 &&
                SUCCEEDED(dev->Activate(IID_IAudioClient, CLSCTX_ALL, nullptr,
                                        reinterpret_cast<void**>(&client)))) {
                impl_->audio_client = client;
                hnsPeriod = static_cast<REFERENCE_TIME>(
                    (10000000.0 * static_cast<double>(aligned_frames)) /
                    static_cast<double>(sample_rate));
                LOG_INFO("WASAPI Exclusive: retrying aligned buffer " +
                         std::to_string(aligned_frames) + "f (" +
                         std::to_string(hnsPeriod / 10000.0) + "ms)");
                hr = client->Initialize(AUDCLNT_SHAREMODE_EXCLUSIVE,
                                         AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                                         hnsPeriod, hnsPeriod, fmt, nullptr);
            }
        }
        if (FAILED(hr)) {
            // The caller can retry a different PCM rate. Treat this as a
            // candidate rejection; it becomes a terminal error only after
            // every candidate fails in AudioEngine.
            LOG_WARN("WASAPI Exclusive: Initialize rejected requested format: 0x" +
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
    // Integer PCM callbacks must never allocate on the MMCSS render thread.
    impl_->scratch.assign(static_cast<size_t>(impl_->buffer_frames) * fmt->nChannels, 0.0f);

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
    // Report PCM precision rather than transport container width. In
    // particular, PCM24-in-32 (requested as 25) is format-matched with a
    // 24-bit source; treating its 32-bit container as a conversion made the
    // bit-perfect assessment reject a valid exclusive-mode negotiation.
    current_format_.bit_depth   = impl_->is_f32 ? fmt->wBitsPerSample :
        (impl_->pcm_valid_bits > 0 ? impl_->pcm_valid_bits : fmt->wBitsPerSample);
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

AudioFormat WasapiBackend::open_dop(
    const std::wstring& device_id,
    const AudioFormat& requested_format,
    RawAudioCallback callback)
{
    if (!exclusive_ || requested_format.bit_depth != 24 || !callback) {
        LOG_WARN("WASAPI DoP requires Exclusive PCM24 and a raw callback");
        return {};
    }
    impl_->raw_callback = std::move(callback);
    impl_->raw_transport = true;
    preparing_dop_open_ = true;
    const AudioFormat actual = open(device_id, requested_format,
        [](float*, int, int) { return 0; });
    preparing_dop_open_ = false;
    if (actual.sample_rate == 0) {
        impl_->raw_callback = {};
        impl_->raw_transport = false;
        return {};
    }
    LOG_INFO("WASAPI Exclusive DoP transport opened: " +
             std::to_string(actual.sample_rate) + "Hz, " +
             std::to_string(actual.channels) + "ch, PCM24 carrier");
    return actual;
}

// ── start ─────────────────────────────────────────────────

bool WasapiBackend::start() {
    if (!impl_->audio_client || active_) return false;

    impl_->thread_error.store(S_OK, std::memory_order_release);
    impl_->running.store(true, std::memory_order_release);
    impl_->thread_handle = (HANDLE)_beginthreadex(
        nullptr, 0, wasapi_thread_proc, impl_.get(), 0, nullptr);

    if (!impl_->thread_handle) {
        impl_->running.store(false, std::memory_order_release);
        LOG_ERROR("WasapiBackend could not create render thread");
        return false;
    }

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
        WaitForSingleObject(impl_->thread_handle, INFINITE);
        CloseHandle(impl_->thread_handle);
        impl_->thread_handle = nullptr;
    }

    const HRESULT thread_error = impl_->thread_error.load(std::memory_order_acquire);
    if (FAILED(thread_error)) {
        LOG_ERROR("WasapiBackend render thread stopped: hr=0x" + std::to_string(thread_error));
    }

    active_ = false;
    LOG_INFO("WasapiBackend stopped");
    return true;
}

// ── flush ─────────────────────────────────────────────────

void WasapiBackend::flush() {
    if (!impl_->audio_client)
        return;

    // Resetting IAudioClient while its event thread owns a render buffer is
    // racy. Stop/join first, then reset and start a fresh render thread.
    const bool restart = active_;
    if (restart) stop();
    HRESULT hr = impl_->audio_client->Stop();
    if (FAILED(hr)) LOG_WARN("WasapiBackend flush Stop failed: hr=0x" + std::to_string(hr));
    hr = impl_->audio_client->Reset();
    if (FAILED(hr)) {
        LOG_ERROR("WasapiBackend flush Reset failed: hr=0x" + std::to_string(hr));
        return;
    }
    if (restart) start();
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
