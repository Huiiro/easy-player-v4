// ABI stubs exercise the real Windows backend control/render paths without hardware.
#include <array>
#include <iostream>
#include <stdexcept>
#include "../../engine-windows/src/wasapi_backend.cpp"
#include "../../engine-windows/src/dsound_backend.cpp"

#define CHECK(x) do { if (!(x)) throw std::runtime_error(#x); } while (0)

template<size_t N> struct ComStub {
    void** vptr;
    std::array<void*, N> methods{};
    ComStub() : vptr(methods.data()) {
        set(2, +[](void*) -> ULONG { return 1; });
    }
    template<class F> void set(size_t index, F method) { methods[index] = reinterpret_cast<void*>(method); }
};

struct ClientStub : ComStub<15> {
    bool fail_start = false, fail_stop = false, fail_reset = false;
    ClientStub() {
        set(10, +[](ClientStub* self) -> HRESULT { return self->fail_start ? E_FAIL : S_OK; });
        set(11, +[](ClientStub* self) -> HRESULT { return self->fail_stop ? E_FAIL : S_OK; });
        set(12, +[](ClientStub* self) -> HRESULT { return self->fail_reset ? E_FAIL : S_OK; });
    }
};
struct RenderStub : ComStub<5> {
    bool fail_buffer = false;
    std::array<float, 128> data{};
    RenderStub() {
        set(3, +[](RenderStub* self, UINT32, BYTE** output) -> HRESULT {
            *output = reinterpret_cast<BYTE*>(self->data.data());
            return self->fail_buffer ? AUDCLNT_E_DEVICE_INVALIDATED : S_OK;
        });
        set(4, +[](RenderStub*, UINT32, DWORD) -> HRESULT { return S_OK; });
    }
};
struct NotifyStub : ComStub<4> {
    NotifyStub() { set(3, +[](NotifyStub*, DWORD, LPCDSBPOSITIONNOTIFY) -> HRESULT { return S_OK; }); }
};
struct BufferStub : ComStub<21> {
    NotifyStub notify;
    std::array<short, 256> data{};
    bool fail_play = false, fail_stop = false, fail_position = false, fail_lock = false, fail_unlock = false;
    BufferStub() {
        set(0, +[](BufferStub* self, REFIID, void** output) -> HRESULT { *output = &self->notify; return S_OK; });
        set(11, +[](BufferStub* self, DWORD offset, DWORD bytes, void** first, DWORD* count,
                   void** second, DWORD* count2, DWORD) -> HRESULT {
            *first = reinterpret_cast<uint8_t*>(self->data.data()) + offset; *count = bytes;
            *second = nullptr; *count2 = 0;
            return self->fail_lock ? DSERR_BUFFERLOST : S_OK;
        });
        set(12, +[](BufferStub* self, DWORD, DWORD, DWORD) -> HRESULT { return self->fail_play ? E_FAIL : S_OK; });
        set(13, +[](BufferStub* self, DWORD) -> HRESULT { return self->fail_position ? E_FAIL : S_OK; });
        set(18, +[](BufferStub* self) -> HRESULT { return self->fail_stop ? E_FAIL : S_OK; });
        set(19, +[](BufferStub* self, void*, DWORD, void*, DWORD) -> HRESULT { return self->fail_unlock ? E_FAIL : S_OK; });
    }
};

struct WindowsBackendTest {
    static void prepare(WasapiBackend& backend, ClientStub& client, RenderStub& render) {
        auto& im = *backend.impl_;
        im.audio_client = reinterpret_cast<IAudioClient*>(&client);
        im.render_client = reinterpret_cast<IAudioRenderClient*>(&render);
        im.wave_format = static_cast<WAVEFORMATEX*>(CoTaskMemAlloc(sizeof(WAVEFORMATEX)));
        *im.wave_format = {}; im.wave_format->nChannels = 2;
        im.bytes_per_frame = 8; im.buffer_frames = 64;
        im.event_handle = CreateEventW(nullptr, FALSE, FALSE, nullptr);
        CHECK(im.event_handle);
        im.callback = [](float* output, int frames, int channels) {
            std::fill(output, output + frames * channels, 0.0f); return frames;
        };
    }
    static void prepare(DSoundBackend& backend, BufferStub& buffer) {
        auto& im = *backend.impl_;
        im.secondary = reinterpret_cast<IDirectSoundBuffer*>(&buffer);
        im.wave_format.nChannels = 2;
        im.buffer_frames = 64; im.buffer_bytes = 512;
        im.scratch.assign(256, 0.0f);
        im.callback = [](float* output, int frames, int channels) {
            std::fill(output, output + frames * channels, 0.0f); return frames;
        };
    }
    static void fail_render(WasapiBackend& backend, RenderStub& render) {
        render.fail_buffer = true;
        SetEvent(backend.impl_->event_handle);
        CHECK(WaitForSingleObject(backend.impl_->thread_handle, 2000) == WAIT_OBJECT_0);
    }
    static void fail_render(DSoundBackend& backend, BufferStub& buffer) {
        buffer.fail_lock = true;
        SetEvent(backend.impl_->notify_events[0]);
        CHECK(WaitForSingleObject(backend.impl_->thread_handle, 2000) == WAIT_OBJECT_0);
    }
};

static void wasapi_failures() {
    {
        ClientStub client; RenderStub render; WasapiBackend backend(true);
        WindowsBackendTest::prepare(backend, client, render);
        client.fail_start = true;
        CHECK(!backend.start()); CHECK(!backend.is_active());
        CHECK(backend.take_events() & BackendEventFailure);
    }
    {
        ClientStub client; RenderStub render; WasapiBackend backend(true);
        WindowsBackendTest::prepare(backend, client, render);
        CHECK(backend.start()); WindowsBackendTest::fail_render(backend, render);
        CHECK(backend.take_events() & BackendEventFailure);
    }
    for (int failure = 0; failure < 4; ++failure) {
        ClientStub client; RenderStub render; WasapiBackend backend(true);
        WindowsBackendTest::prepare(backend, client, render);
        CHECK(backend.start());
        client.fail_stop = failure == 0;
        client.fail_reset = failure == 1;
        client.fail_start = failure == 2;
        CHECK(backend.flush_checked() == (failure == 3));
        CHECK(backend.is_active() == (failure == 3));
    }
}

static void dsound_failures() {
    {
        BufferStub buffer; DSoundBackend backend;
        WindowsBackendTest::prepare(backend, buffer);
        buffer.fail_play = true;
        CHECK(!backend.start()); CHECK(!backend.is_active());
        CHECK(backend.take_events() & BackendEventFailure);
    }
    {
        BufferStub buffer; DSoundBackend backend;
        WindowsBackendTest::prepare(backend, buffer);
        CHECK(backend.start()); WindowsBackendTest::fail_render(backend, buffer);
        CHECK(backend.take_events() & BackendEventFailure);
    }
    for (int failure = 0; failure < 6; ++failure) {
        BufferStub buffer; DSoundBackend backend;
        WindowsBackendTest::prepare(backend, buffer); CHECK(backend.start());
        buffer.fail_stop = failure == 0; buffer.fail_position = failure == 1;
        buffer.fail_lock = failure == 2; buffer.fail_unlock = failure == 3;
        buffer.fail_play = failure == 4;
        CHECK(backend.flush_checked() == (failure == 5));
    }
}

int main() {
    try { wasapi_failures(); dsound_failures(); }
    catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
    std::cout << "WASAPI/DirectSound startup, render failure and checked seek flush passed\n";
}
