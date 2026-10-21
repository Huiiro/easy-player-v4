#include "asio_backend.h"
#include "logger.h"
#include "asio_control_thread.h"
#include <algorithm>
#include <cmath>
#include <limits>

#include <atomic>
#include <cstring>
#include <string>
#include <vector>
#define NOMINMAX
#include <windows.h>
#include <objbase.h>

// Trace calls are used only from the control path.  Keeping them in the
// application's logger avoids silently writing a hard-coded file on D:.
static void tr(const char* msg) { LOG_DEBUG("ASIO: " + std::string(msg)); }

// ── ASIO types (self-declared, no Steinberg SDK) ──────────
typedef long ASIOBool;
enum { ASIOFalse = 0, ASIOTrue = 1 };
typedef long ASIOError;
enum { ASE_OK = 0, ASE_NotPresent = -1000, ASE_HWMalfunction = -999,
       ASE_InvalidParameter = -998, ASE_InvalidMode = -997,
       ASE_SPNotAdvancing = -996, ASE_NoClock = -995, ASE_NoMemory = -994 };
// Values from ASIO SDK 2.x.  The LSB formats begin at 16, not 0.
enum {
    ASIOSTInt16MSB = 0, ASIOSTInt24MSB = 1, ASIOSTInt32MSB = 2,
    ASIOSTFloat32MSB = 3, ASIOSTFloat64MSB = 4,
    ASIOSTInt32MSB16 = 8, ASIOSTInt32MSB18 = 9,
    ASIOSTInt32MSB20 = 10, ASIOSTInt32MSB24 = 11,
    ASIOSTInt16LSB = 16, ASIOSTInt24LSB = 17, ASIOSTInt32LSB = 18,
    ASIOSTFloat32LSB = 19, ASIOSTFloat64LSB = 20,
    ASIOSTInt32LSB16 = 24, ASIOSTInt32LSB18 = 25,
    ASIOSTInt32LSB20 = 26, ASIOSTInt32LSB24 = 27
};
typedef double ASIOSampleRate;
typedef long long ASIOSamples;
typedef struct { long channel; ASIOBool isInput; long isActive;
    long channelGroup; long type; char name[32]; } ASIOChannelInfo;
typedef struct { ASIOBool isInput; long channelNum;
    void* buffers[2]; } ASIOBufferInfo;
typedef struct {
    void (*bufferSwitch)(long, ASIOBool);
    void (*sampleRateDidChange)(ASIOSampleRate);
    long (*asioMessage)(long, long, void*, double*);
    void* (*bufferSwitchTimeInfo)(void*, long, ASIOBool);
} ASIOCallbacks;

// ── Raw vtable function table (extracted at runtime) ──────
struct AsioVTable {
    HRESULT (STDMETHODCALLTYPE *QueryInterface)(IUnknown*, REFIID, void**);
    ULONG   (STDMETHODCALLTYPE *AddRef)(IUnknown*);
    ULONG   (STDMETHODCALLTYPE *Release)(IUnknown*);
    ASIOBool (STDMETHODCALLTYPE *init)(IUnknown*, void*);
    void     (STDMETHODCALLTYPE *getDriverName)(IUnknown*, char*);
    long     (STDMETHODCALLTYPE *getDriverVersion)(IUnknown*);
    void     (STDMETHODCALLTYPE *errorMessage)(IUnknown*, char*);
    ASIOError (STDMETHODCALLTYPE *start)(IUnknown*);
    ASIOError (STDMETHODCALLTYPE *stop)(IUnknown*);
    ASIOError (STDMETHODCALLTYPE *getChannels)(IUnknown*, long*, long*);
    ASIOError (STDMETHODCALLTYPE *getLatencies)(IUnknown*, long*, long*);
    ASIOError (STDMETHODCALLTYPE *getBufferSize)(IUnknown*, long*,long*,long*,long*);
    ASIOError (STDMETHODCALLTYPE *canSampleRate)(IUnknown*, ASIOSampleRate);
    ASIOError (STDMETHODCALLTYPE *getSampleRate)(IUnknown*, ASIOSampleRate*);
    ASIOError (STDMETHODCALLTYPE *setSampleRate)(IUnknown*, ASIOSampleRate);
    ASIOError (STDMETHODCALLTYPE *getClockSources)(IUnknown*, void*, long*);
    ASIOError (STDMETHODCALLTYPE *setClockSource)(IUnknown*, long);
    ASIOError (STDMETHODCALLTYPE *getSamplePosition)(IUnknown*, ASIOSamples*, void*);
    ASIOError (STDMETHODCALLTYPE *getChannelInfo)(IUnknown*, ASIOChannelInfo*);
    ASIOError (STDMETHODCALLTYPE *createBuffers)(IUnknown*, ASIOBufferInfo*, long, long, ASIOCallbacks*);
    ASIOError (STDMETHODCALLTYPE *disposeBuffers)(IUnknown*);
    ASIOError (STDMETHODCALLTYPE *controlPanel)(IUnknown*);
    ASIOError (STDMETHODCALLTYPE *future)(IUnknown*, long, void*);
    ASIOError (STDMETHODCALLTYPE *outputReady)(IUnknown*);
};
static void vt_from_obj(IUnknown* obj, AsioVTable* vt) {
    uintptr_t* v = *(uintptr_t**)obj;
    // IASIO derives from IUnknown. getErrorMessage occupies slot 6;
    // omitting it shifts every following call into the wrong driver method.
    #define V(n, name) vt->name = (decltype(vt->name))v[n]
    V(0, QueryInterface); V(1, AddRef); V(2, Release);
    V(3, init); V(4, getDriverName); V(5, getDriverVersion);
    V(6, errorMessage);
    V(7, start); V(8, stop);
    V(9, getChannels); V(10, getLatencies); V(11, getBufferSize);
    V(12, canSampleRate); V(13, getSampleRate); V(14, setSampleRate);
    V(15, getClockSources); V(16, setClockSource);
    V(17, getSamplePosition); V(18, getChannelInfo);
    V(19, createBuffers); V(20, disposeBuffers);
    V(21, controlPanel); V(22, future); V(23, outputReady);
    #undef V
}

// ── COM guard ─────────────────────────────────────────────
struct ComGuard {
    // ASIO4ALL registers ThreadingModel=Apartment and exposes an IASIO IID
    // without a proxy/stub. Activating it from MTA requires marshaling that
    // cannot succeed (E_NOINTERFACE). Keep it on our message-pumping STA.
    HRESULT result = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
    ~ComGuard() { if (SUCCEEDED(result)) CoUninitialize(); }
};

// ── Impl ──────────────────────────────────────────────────
struct AsioBackend::Impl {
    AsioControlThread control;
    std::unique_ptr<ComGuard> com;
    ASIOCallbacks callbacks{};
    std::atomic<unsigned> events{BackendEventNone};
    std::atomic<double> expected_rate{0};
    IUnknown* obj = nullptr; AsioVTable vt = {};
    std::string driver_name; long buffer_size = 0;
    int output_channels = 0, input_channels = 0; double sample_rate = 0;
    std::vector<ASIOBufferInfo>  buffer_infos;
    std::vector<ASIOChannelInfo> channel_infos;
    std::vector<int> channel_types; std::vector<float> interleaved_buf;
    std::vector<uint8_t> raw_interleaved_buf;
    AudioCallback callback; RawAudioCallback raw_callback; bool raw_transport = false;
    uint8_t dop_marker = 0x05;
    std::atomic<bool> running{false};
    bool buffers_created = false;
};
static std::atomic<void*> g_impl{nullptr};

// ── Deinterleave ──────────────────────────────────────────
static void df_f32(const float* in, void* d, int n, int ch, int ci) {
    float* o = (float*)d; for (int i=0;i<n;++i) o[i]=in[i*ch+ci]; }
static void df_s32(const float* in, void* d, int n, int ch, int ci) {
    int* o = (int*)d; for (int i=0;i<n;++i){float s=in[i*ch+ci];
    if(s>1)s=1;if(s<-1)s=-1;o[i]=(int)(s*2147483647.0);}}
static void df_s16(const float* in, void* d, int n, int ch, int ci) {
    short* o = (short*)d; for (int i=0;i<n;++i){float s=in[i*ch+ci];
    if(s>1)s=1;if(s<-1)s=-1;o[i]=(short)(s*32767.0f);}}
static void df_s24(const float* in, void* d, int n, int ch, int ci) {
    unsigned char* o = (unsigned char*)d; for (int i=0;i<n;++i){
    float s=in[i*ch+ci];if(s>1)s=1;if(s<-1)s=-1;
    int v=(int)(s*8388607.0f);o[i*3]=v&0xFF;o[i*3+1]=(v>>8)&0xFF;o[i*3+2]=(v>>16)&0xFF;}}
static void df_s32_24(const float* in, void* d, int n, int ch, int ci) {
    int* o = (int*)d; for (int i=0;i<n;++i){float s=in[i*ch+ci];
    if(s>1)s=1;if(s<-1)s=-1;o[i]=(int)(s*8388607.0f);}}
static void df_s32_16(const float* in, void* d, int n, int ch, int ci) {
    int* o = (int*)d; for (int i=0;i<n;++i){float s=in[i*ch+ci];
    if(s>1)s=1;if(s<-1)s=-1;o[i]=(int)(s*32767.0f);}}
static void df_s32_18(const float* in, void* d, int n, int ch, int ci) {
    int* o = (int*)d; for (int i=0;i<n;++i){float s=in[i*ch+ci];
    if(s>1)s=1;if(s<-1)s=-1;o[i]=(int)(s*131071.0f);}}
static void df_s32_20(const float* in, void* d, int n, int ch, int ci) {
    int* o = (int*)d; for (int i=0;i<n;++i){float s=in[i*ch+ci];
    if(s>1)s=1;if(s<-1)s=-1;o[i]=(int)(s*524287.0f);}}
typedef void (*DF)(const float*,void*,int,int,int);
static DF get_df(int t){switch(t){case ASIOSTFloat32LSB:return df_f32;
case ASIOSTInt32LSB:return df_s32;case ASIOSTInt16LSB:return df_s16;
case ASIOSTInt24LSB:return df_s24;case ASIOSTInt32LSB16:return df_s32_16;
case ASIOSTInt32LSB18:return df_s32_18;case ASIOSTInt32LSB20:return df_s32_20;
case ASIOSTInt32LSB24:return df_s32_24;
default:return nullptr;}}
static const char* tp_name(int t){switch(t){case ASIOSTInt16LSB:return"Int16LSB";
case ASIOSTInt24LSB:return"Int24LSB";case ASIOSTInt32LSB:return"Int32LSB";
case ASIOSTFloat32LSB:return"Float32LSB";case ASIOSTFloat64LSB:return"Float64LSB";
case ASIOSTInt32LSB16:return"Int32LSB16";case ASIOSTInt32LSB18:return"Int32LSB18";
case ASIOSTInt32LSB20:return"Int32LSB20";case ASIOSTInt32LSB24:return"Int32LSB24";
default:return"unknown";}}
static int tp_valid_bits(int t) {
    switch (t) {
        case ASIOSTInt16LSB: return 16;
        case ASIOSTInt24LSB: case ASIOSTInt32LSB24: return 24;
        case ASIOSTInt32LSB: case ASIOSTFloat32LSB: return 32;
        case ASIOSTInt32LSB16: return 16;
        case ASIOSTInt32LSB18: return 18;
        case ASIOSTInt32LSB20: return 20;
        default: return 0;
    }
}

// ── ASIO callbacks ────────────────────────────────────────
static void buf_switch(long idx, ASIOBool /*direct_process*/) {
    auto* im = (AsioBackend::Impl*)g_impl.load(std::memory_order_acquire);
    if(!im||!im->running.load(std::memory_order_acquire)||idx<0||idx>1)return;
    int ch=im->output_channels, n=(int)im->buffer_size;
    if (im->raw_transport) {
        const int rendered = im->raw_callback ? std::clamp(im->raw_callback(im->raw_interleaved_buf.data(), n, ch), 0, n) : 0;
        // The transport owns marker phase, including startup/pause silence.
        for (int frame = 0; frame < n; ++frame) {
            for (int ci = 0; ci < ch; ++ci) {
                auto* sample = im->raw_interleaved_buf.data() + (static_cast<size_t>(frame) * ch + ci) * 3;
                if (frame >= rendered) sample[0] = sample[1] = 0x69;
                sample[2] = im->dop_marker;
            }
            im->dop_marker = im->dop_marker == 0x05 ? 0xFA : 0x05;
        }
        for(int ci=0;ci<ch;++ci) {
            auto* d = static_cast<uint8_t*>(im->buffer_infos[ci].buffers[idx]);
            for(int frame=0;frame<n;++frame) {
                const size_t offset = static_cast<size_t>(frame * ch + ci) * 3;
                const uint8_t* source = im->raw_interleaved_buf.data() + offset;
                if (im->channel_types[ci] == ASIOSTInt24LSB) {
                    if (source) std::memcpy(d + frame * 3, source, 3);
                    else std::memset(d + frame * 3, 0, 3);
                } else {
                    // ASIOSTInt32LSB24 is a 24-valid-bit PCM word in a
                    // 32-bit little-endian slot. Keep DoP right-aligned and
                    // clear only the unused most-significant padding byte.
                    uint8_t* sample = d + frame * 4;
                    sample[0] = source ? source[0] : 0;
                    sample[1] = source ? source[1] : 0;
                    sample[2] = source ? source[2] : 0;
                    sample[3] = 0;
                }
            }
        }
    } else {
        const int rendered = std::clamp(im->callback(im->interleaved_buf.data(),n,ch), 0, n);
        std::fill(im->interleaved_buf.begin() + static_cast<size_t>(rendered) * ch,
                  im->interleaved_buf.end(), 0.0f);
        for(int ci=0;ci<ch;++ci){void*d=im->buffer_infos[ci].buffers[idx];
        DF f=get_df(im->channel_types[ci]);if(f)f(im->interleaved_buf.data(),d,n,ch,ci);
        else memset(d,0,n*4);}
    }
    // outputReady() is only an optional latency optimisation.  Several
    // third-party/virtual ASIO drivers misbehave when it is called without
    // their host-specific capability negotiation.  bufferSwitch alone is the
    // portable ASIO 2.x output path, so do not call it unconditionally.
}
// ASIO4ALL commonly prefers the ASIO 2 TimeInfo callback path. The player
// does not consume transport timestamps yet, but must advertise and service
// the callback so the driver continues issuing output buffers.
static void* buf_switch_time(void* params, long idx, ASIOBool direct_process) {
    buf_switch(idx, direct_process);
    return params;
}
static void sr_change(ASIOSampleRate rate) {
    auto* im = static_cast<AsioBackend::Impl*>(g_impl.load(std::memory_order_acquire));
    if (im && rate != im->expected_rate.load(std::memory_order_acquire))
        im->events.fetch_or(BackendEventRateChanged, std::memory_order_release);
}
static long asio_msg(long selector, long value, void*, double*) {
    constexpr long supported=1, version=2, reset=3, buffer_change=4;
    constexpr long resync=5, latencies=6, time_info=7;
    if (selector == supported)
        return value == version || value == reset || value == buffer_change ||
               value == resync || value == latencies || value == time_info;
    if (selector == version) return 2;
    if (selector == time_info) return 1;
    auto* im = static_cast<AsioBackend::Impl*>(g_impl.load(std::memory_order_acquire));
    if (!im) return 0;
    unsigned event = BackendEventNone;
    if (selector == reset || selector == buffer_change) event = BackendEventReset;
    if (selector == resync) event = BackendEventResync;
    if (selector == latencies) event = BackendEventLatenciesChanged;
    if (!event) return 0;
    // Recovery is deferred to the host control path, never inside a callback.
    im->events.fetch_or(event, std::memory_order_release);
    return 1;
}

// ── Registry ──────────────────────────────────────────────
static std::wstring rstr(HKEY k, const wchar_t* v) {
    wchar_t b[512]={};DWORD s=sizeof(b),t=0;
    if(RegQueryValueExW(k,v,nullptr,&t,(LPBYTE)b,&s)==ERROR_SUCCESS&&t==REG_SZ)return b;
    return {};}
static std::wstring dll_path(const std::wstring& cs) {
    HKEY k=nullptr;auto p=L"CLSID\\"+cs+L"\\InprocServer32";
    if(RegOpenKeyExW(HKEY_CLASSES_ROOT,p.c_str(),0,KEY_READ,&k)!=ERROR_SUCCESS)return{};
    auto r=rstr(k,nullptr);RegCloseKey(k);return r;}
static std::wstring first_cs() {
    HKEY h=nullptr;wchar_t n[256];std::wstring c;
    if(RegOpenKeyExW(HKEY_LOCAL_MACHINE,L"SOFTWARE\\ASIO",0,KEY_READ,&h)!=ERROR_SUCCESS)return{};
    if(RegEnumKeyW(h,0,n,256)==ERROR_SUCCESS){HKEY d=nullptr;
    if(RegOpenKeyExW(h,n,0,KEY_READ,&d)==ERROR_SUCCESS){c=rstr(d,L"CLSID");RegCloseKey(d);}}
    RegCloseKey(h);return c;}

// ──────────────────────────────────────────────────────────
AsioBackend::AsioBackend() : impl_(std::make_unique<Impl>()) {}
AsioBackend::~AsioBackend() { close(); }

std::vector<DeviceInfo> AsioBackend::enumerate_devices() {
    std::vector<DeviceInfo> devs; HKEY h=nullptr;
    if(RegOpenKeyExW(HKEY_LOCAL_MACHINE,L"SOFTWARE\\ASIO",0,KEY_READ,&h)!=ERROR_SUCCESS)return devs;
    DWORD i=0;wchar_t n[256];
    while(RegEnumKeyW(h,i++,n,256)==ERROR_SUCCESS){HKEY d=nullptr;
    if(RegOpenKeyExW(h,n,0,KEY_READ,&d)!=ERROR_SUCCESS)continue;
    auto c=rstr(d,L"CLSID");auto desc=rstr(d,L"Description");RegCloseKey(d);
    if(c.empty())continue;auto dp=dll_path(c);
    if(dp.empty()||GetFileAttributesW(dp.c_str())==INVALID_FILE_ATTRIBUTES)continue;
    DeviceInfo di;di.id=c;di.name=desc.empty()?n:desc;di.backend=BackendType::ASIO;
    di.is_default=(i==1);di.max_channels=32;
    di.sample_rates={44100,48000,88200,96000,176400,192000};
    di.bit_depths={16,24,32};di.supports_exclusive=true;di.supports_dsd=false;
    devs.push_back(di);}RegCloseKey(h);return devs;}

AudioFormat AsioBackend::open(const std::wstring& dev_id,
                               const AudioFormat& req, AudioCallback cb) {
    if (!impl_->control.is_current())
        return impl_->control.invoke([this, dev_id, req, cb = std::move(cb)]() mutable {
            return open(dev_id, req, std::move(cb));
        });
    tr("open start");close();
    if (!cb || req.channels < 1) return {};
    LOG_DEBUG("ASIO open: device=" + log_wide(dev_id) +
              ", rate=" + std::to_string(req.sample_rate) + ", bits=" + std::to_string(req.bit_depth) +
              ", channels=" + std::to_string(req.channels));
    if (!preparing_dop_open_) { impl_->raw_callback = {}; impl_->raw_transport = false; }
    impl_->callback=std::move(cb);
    impl_->com = std::make_unique<ComGuard>();
    if (FAILED(impl_->com->result)) {
        LOG_ERROR("ASIO: COM initialization failed: " + log_hex(impl_->com->result));
        close(); return {};
    }
    void* expected = nullptr;
    if (!g_impl.compare_exchange_strong(expected, impl_.get(), std::memory_order_acq_rel)) {
        LOG_ERROR("ASIO: only one output instance is supported");
        close(); return {};
    }

    // ASIO drivers are COM in-proc servers, but IASIO has no shared IID.
    // The ASIO SDK uses the driver's CLSID as both CLSID and RIID. Requesting
    // IID_IUnknown returns only the three IUnknown entries, so subsequent
    // IASIO calls dereference unrelated vtable slots and crash.
    tr("CoCreateInstance");
    auto cs=dev_id;CLSID tmp;
    if(cs.empty()||cs==L"default"||FAILED(CLSIDFromString(cs.c_str(),&tmp)))cs=first_cs();
    CLSID cl={};
    if(!cs.empty()&&SUCCEEDED(CLSIDFromString(cs.c_str(),&cl))){
        HRESULT hr=CoCreateInstance(cl,nullptr,CLSCTX_INPROC_SERVER,cl,
                                    reinterpret_cast<void**>(&impl_->obj));
        if(SUCCEEDED(hr)){tr("CoCreateInstance OK");}
        else{LOG_ERROR("ASIO: CoCreateInstance "+log_hex(hr));close();return{};}}
    else{LOG_ERROR("ASIO: no CLSID");close();return{};}

    // extract vtable
    tr("extract vtable");vt_from_obj(impl_->obj,&impl_->vt);

    // init
    HWND hwnd=GetDesktopWindow();tr("init");
    if(!impl_->vt.init(impl_->obj,hwnd)){tr("init FAILED");LOG_ERROR("ASIO: init failed");close();return{};}
    tr("init OK");

    // driver info
    char nb[128]={};tr("getDriverName");impl_->vt.getDriverName(impl_->obj,nb);
    impl_->driver_name=nb;
    tr("getDV");long dv=impl_->vt.getDriverVersion(impl_->obj);tr("getDV ok");
    LOG_DEBUG("ASIO: "+impl_->driver_name+" v"+std::to_string(dv));

    // channels
    long ni=0,no=0;
    tr("getCh");const ASIOError channel_result=impl_->vt.getChannels(impl_->obj,&ni,&no);tr("getCh ok");
    if(channel_result!=ASE_OK) LOG_ERROR("ASIO getChannels failed: code="+std::to_string(channel_result)+", driver="+impl_->driver_name);
    impl_->input_channels=(int)ni;impl_->output_channels=(int)no;
    if(channel_result!=ASE_OK || no<1){LOG_ERROR("ASIO: no output");close();return{};}
    int uc=std::min((int)no, std::max(1, req.channels));

    // sample rate
    int trate=req.sample_rate>0?req.sample_rate:44100;
    ASIOSampleRate sr=(ASIOSampleRate)trate;tr("canSampleRate");
    if(impl_->vt.canSampleRate(impl_->obj,sr)!=ASE_OK){
        if (impl_->raw_transport) {
            LOG_WARN("ASIO DoP: carrier rate rejected: " + std::to_string(trate) + "Hz");
            close(); return {};
        }
        tr("getSampleRate fallback");
        if (impl_->vt.getSampleRate(impl_->obj,&sr)!=ASE_OK || sr<=0) {
            LOG_ERROR("ASIO: no usable sample rate"); close(); return {};
        }
    }
    tr("setSampleRate");
    impl_->expected_rate.store(sr, std::memory_order_release);
    ASIOSampleRate existing_rate = 0;
    const bool rate_matches = impl_->vt.getSampleRate(impl_->obj, &existing_rate) == ASE_OK && existing_rate == sr;
    // Avoid unnecessary clock resets, and support externally clocked drivers
    // that reject setSampleRate even when already running at the desired rate.
    const ASIOError rate_result = rate_matches ? ASE_OK : impl_->vt.setSampleRate(impl_->obj,sr);
    if (rate_result!=ASE_OK) {
        LOG_WARN("ASIO setSampleRate rejected: code=" + std::to_string(rate_result) +
                 ", rate=" + std::to_string(static_cast<int>(sr)) + "Hz, driver=" + impl_->driver_name);
        close(); return {};
    }
    ASIOSampleRate confirmed_rate = 0;
    const ASIOError confirmed_result = impl_->vt.getSampleRate(impl_->obj,&confirmed_rate);
    if (confirmed_result!=ASE_OK || !std::isfinite(confirmed_rate) || confirmed_rate<=0 ||
        confirmed_rate>std::numeric_limits<int>::max() ||
        (impl_->raw_transport && confirmed_rate != static_cast<ASIOSampleRate>(trate))) {
        LOG_WARN("ASIO" + std::string(impl_->raw_transport ? " DoP" : "") +
                 ": rate confirmation failed, code=" + std::to_string(confirmed_result) +
                 ", requested=" + std::to_string(trate) + "Hz, actual=" + std::to_string(confirmed_rate) + "Hz");
        close(); return {};
    }
    sr=confirmed_rate;impl_->sample_rate=sr;
    impl_->expected_rate.store(sr, std::memory_order_release);
    LOG_DEBUG("ASIO rate: "+std::to_string((int)sr));

    // A rate change can change the driver's legal buffer sizes.
    long mn=0,mx=0,pr=0,gr=0;
    const ASIOError size_result = impl_->vt.getBufferSize(impl_->obj,&mn,&mx,&pr,&gr);
    const bool legal_size = mn > 0 && mx >= mn && pr >= mn && pr <= mx &&
        (gr == -1 ? (pr & (pr - 1)) == 0 :
         gr == 0 ? mn == mx && pr == mn : gr > 0 && (pr - mn) % gr == 0);
    if (size_result != ASE_OK || !legal_size ||
        static_cast<size_t>(pr) > static_cast<size_t>(std::numeric_limits<int>::max()) / uc) {
        LOG_ERROR("ASIO: invalid buffer size negotiation: code=" + std::to_string(size_result) +
                  ", min=" + std::to_string(mn) + ", max=" + std::to_string(mx) +
                  ", preferred=" + std::to_string(pr) + ", granularity=" + std::to_string(gr));
        close(); return {};
    }
    impl_->buffer_size=pr;
    LOG_DEBUG("ASIO buffer selected after rate negotiation: " + std::to_string(pr));

    // channel info
    tr("channel info");impl_->channel_infos.resize(uc);impl_->channel_types.resize(uc);
    for(long ci=0;ci<uc;++ci){ASIOChannelInfo info={};info.channel=ci;info.isInput=ASIOFalse;
    const ASIOError info_result = impl_->vt.getChannelInfo(impl_->obj,&info);
    if (info_result!=ASE_OK) {
        LOG_ERROR("ASIO getChannelInfo failed: code=" + std::to_string(info_result) +
                  ", output=" + std::to_string(ci) + ", driver=" + impl_->driver_name); close(); return {};
    }
    impl_->channel_infos[ci]=info;
    impl_->channel_types[ci]=info.type;
    const bool dop_type = info.type == ASIOSTInt24LSB || info.type == ASIOSTInt32LSB24;
    if((impl_->raw_transport && !dop_type) || (!impl_->raw_transport && !get_df(info.type))){
        LOG_WARN("ASIO DoP ch"+std::to_string(ci)+": requires Int24LSB or Int32LSB24; driver reports type="+
                  std::to_string(info.type)+" ("+tp_name(info.type)+")");
        close();
        return {};
    }
    if (impl_->raw_transport) {
        LOG_DEBUG("ASIO DoP output " + std::to_string(ci) + ": " + tp_name(info.type) +
                 (info.type == ASIOSTInt24LSB ? " packed PCM24" : " right-aligned PCM24-in-32"));
    }}

    // create buffers
    tr("createBuffers");impl_->buffer_infos.resize(uc);
    for(long ci=0;ci<uc;++ci){impl_->buffer_infos[ci].isInput=ASIOFalse;
    impl_->buffer_infos[ci].channelNum=ci;impl_->buffer_infos[ci].buffers[0]=nullptr;
    impl_->buffer_infos[ci].buffers[1]=nullptr;}
    auto& cbs = impl_->callbacks;
    cbs={};cbs.bufferSwitch=buf_switch;
    cbs.sampleRateDidChange=sr_change;cbs.asioMessage=asio_msg;
    cbs.bufferSwitchTimeInfo=buf_switch_time;
    ASIOError ce=impl_->vt.createBuffers(impl_->obj,impl_->buffer_infos.data(),uc,impl_->buffer_size,&cbs);
    if(ce!=ASE_OK){LOG_ERROR("ASIO createBuffers failed: code="+std::to_string(ce)+
        ", driver="+impl_->driver_name+", channels="+std::to_string(uc)+", frames="+std::to_string(impl_->buffer_size));close();return{};}
    impl_->buffers_created=true;tr("createBuffers OK");

    // latency
    long il=0,ol=0;tr("getLatencies");impl_->vt.getLatencies(impl_->obj,&il,&ol);
    latency_ms_=(double)ol/sr*1000.0;

    // scratch
    impl_->interleaved_buf.resize(impl_->buffer_size*uc);
    if (impl_->raw_transport) impl_->raw_interleaved_buf.resize(static_cast<size_t>(impl_->buffer_size) * uc * 3);
    impl_->output_channels=uc;
    int valid_bits = impl_->raw_transport ? 24 : tp_valid_bits(impl_->channel_types.front());
    for (const int type : impl_->channel_types) {
        if (tp_valid_bits(type) != valid_bits) { valid_bits = 0; break; }
    }
    current_format_.sample_rate=(int)sr;current_format_.bit_depth=valid_bits;
    current_format_.channels=uc;buffer_frames_=(int)impl_->buffer_size;

    LOG_DEBUG("AsioBackend opened: "+impl_->driver_name+" "+std::to_string(current_format_.sample_rate)+"Hz "+
             std::to_string(uc)+"ch "+std::to_string(impl_->buffer_size)+"samp");
    tr("open done OK");return current_format_;}

AudioFormat AsioBackend::open_dop(const std::wstring& device_id,
                                  const AudioFormat& requested_format,
                                  RawAudioCallback callback) {
    if (!impl_->control.is_current())
        return impl_->control.invoke([this, device_id, requested_format, callback = std::move(callback)]() mutable {
            return open_dop(device_id, requested_format, std::move(callback));
        });
    if (requested_format.bit_depth != 24 || requested_format.channels < 1 || !callback) {
        LOG_WARN("ASIO DoP requires a PCM24 raw callback");
        return {};
    }
    close();
    impl_->raw_callback = std::move(callback);
    impl_->raw_transport = true;
    preparing_dop_open_ = true;
    const AudioFormat actual = open(device_id, requested_format, [](float*, int, int) { return 0; });
    preparing_dop_open_ = false;
    if (actual.sample_rate == 0) {
        impl_->raw_callback = {};
        impl_->raw_transport = false;
        return {};
    }
    LOG_DEBUG("ASIO DoP transport opened: " + std::to_string(actual.sample_rate) + "Hz, " +
             std::to_string(actual.channels) + "ch, PCM24 carrier (packed or explicit 24-in-32)");
    return actual;
}

void AsioBackend::initialize_output_buffers() {
    // Clear both halves on every start. DoP uses valid encoded silence.
    for (int ci = 0; ci < impl_->output_channels; ++ci) {
        const int bytes = impl_->channel_types[ci] == ASIOSTInt16LSB ? 2 :
                          impl_->channel_types[ci] == ASIOSTInt24LSB ? 3 : 4;
        for (int half = 0; half < 2; ++half) {
            auto* output = static_cast<uint8_t*>(impl_->buffer_infos[ci].buffers[half]);
            std::memset(output, 0, static_cast<size_t>(impl_->buffer_size) * bytes);
            if (impl_->raw_transport) {
                for (long frame = 0; frame < impl_->buffer_size; ++frame) {
                    output[frame * bytes] = 0x69;
                    output[frame * bytes + 1] = 0x69;
                    output[frame * bytes + 2] = frame % 2 ? 0xFA : 0x05;
                }
            }
        }
    }
}

bool AsioBackend::start() {
    if (!impl_->control.is_current()) return impl_->control.invoke([this] { return start(); });
    if (!impl_->obj || !impl_->buffers_created || active_) return false;
    initialize_output_buffers();
    impl_->dop_marker = 0x05;
    impl_->running.store(true, std::memory_order_release);
    // ASIO begins by playing half 1, then requests half 0. Prime the real
    // driver buffer rather than only the engine's software ring.
    buf_switch(1, ASIOTrue);
    const ASIOError result = impl_->vt.start(impl_->obj);
    if (result != ASE_OK) {
        impl_->running.store(false, std::memory_order_release);
        // A failed start may have partially started the hardware.
        active_ = true;
        stop();
        LOG_ERROR("ASIO start failed: code=" + std::to_string(result));
        return false;
    }
    active_ = true;
    return true;
}

bool AsioBackend::stop() {
    if (!impl_->control.is_current()) return impl_->control.invoke([this] { return stop(); });
    if (!impl_->obj || !active_) return true;
    impl_->running.store(false, std::memory_order_release);
    const ASIOError result = impl_->vt.stop(impl_->obj);
    if (result != ASE_OK) {
        LOG_ERROR("ASIO stop failed: code=" + std::to_string(result));
        // Retain active_ so close() retries before disposing the buffers.
        return false;
    }
    active_ = false;
    return true;
}

void AsioBackend::flush() { (void)flush_checked(); }

bool AsioBackend::flush_checked() {
    if (!impl_->control.is_current()) return impl_->control.invoke([this] { return flush_checked(); });
    if (!impl_->obj) return false;
    if (!active_) { initialize_output_buffers(); return true; }
    return stop() && start();
}

unsigned AsioBackend::take_events() {
    if (!impl_->control.is_current()) return impl_->control.invoke([this] { return take_events(); });
    const unsigned events = impl_->events.exchange(BackendEventNone, std::memory_order_acq_rel);
    if ((events & BackendEventLatenciesChanged) && impl_->obj) {
        long input = 0, output = 0;
        if (impl_->vt.getLatencies(impl_->obj, &input, &output) == ASE_OK)
            latency_ms_ = output * 1000.0 / impl_->sample_rate;
    }
    return events;
}

void AsioBackend::close() {
    if (!impl_->control.is_current()) { impl_->control.invoke([this] { close(); }); return; }
    if (active_) stop();
    impl_->running.store(false, std::memory_order_release);
    // Keep callback routing alive through disposal, with rendering disabled.
    if (impl_->obj) {
        if (impl_->buffers_created) impl_->vt.disposeBuffers(impl_->obj);
        impl_->vt.Release(impl_->obj);
        impl_->obj = nullptr;
    }
    void* expected = impl_.get();
    g_impl.compare_exchange_strong(expected, nullptr, std::memory_order_acq_rel);
    impl_->vt = {}; impl_->buffers_created = false; active_ = false;
    impl_->buffer_infos.clear(); impl_->channel_infos.clear(); impl_->channel_types.clear();
    impl_->interleaved_buf.clear(); impl_->raw_interleaved_buf.clear();
    impl_->callback = {};
    if (!preparing_dop_open_) { impl_->raw_callback = {}; impl_->raw_transport = false; }
    impl_->events.store(BackendEventNone, std::memory_order_release);
    impl_->com.reset(); // IASIO released before COM, on the creating thread.
    current_format_ = {}; buffer_frames_ = 0; latency_ms_ = 0;
}
