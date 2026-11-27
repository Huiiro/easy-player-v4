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
    HANDLE packet_ready = nullptr;
    std::array<float, 128> data{};
    RenderStub() {
        set(3, +[](RenderStub* self, UINT32, BYTE** output) -> HRESULT {
            *output = reinterpret_cast<BYTE*>(self->data.data());
            return self->fail_buffer ? AUDCLNT_E_DEVICE_INVALIDATED : S_OK;
        });
        set(4, +[](RenderStub* self, UINT32, DWORD) -> HRESULT {
            if (self->packet_ready) SetEvent(self->packet_ready);
            return S_OK;
        });
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
        im.buffer_frames = 64;
        im.event_handle = CreateEventW(nullptr, FALSE, FALSE, nullptr);
        CHECK(im.event_handle);
        im.callback = [](float* output, int frames, int channels) {
            std::fill(output, output + frames * channels, 0.0f); return frames;
        };
    }
    static void prepare_dop(WasapiBackend& backend, int container_bits, RawAudioCallback callback) {
        auto& im = *backend.impl_;
        im.raw_transport = true;
        im.pcm_bits = container_bits;
        im.pcm_valid_bits = 24;
        im.buffer_frames = 33;
        im.raw_callback = std::move(callback);
        if (container_bits == 32) im.dop_scratch.resize(im.buffer_frames * 2 * 3);
    }
    static void request_buffer(WasapiBackend& backend) {
        CHECK(SetEvent(backend.impl_->event_handle));
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

static void wasapi_dop() {
    for (int container_bits : {24, 32}) {
        const std::unique_ptr<void, decltype(&CloseHandle)> packet_ready(
            CreateEventW(nullptr, FALSE, FALSE, nullptr), CloseHandle);
        CHECK(packet_ready);
        ClientStub client;
        RenderStub render;
        render.packet_ready = packet_ready.get();
        int frames_to_render = 1;
        WasapiBackend backend(true);
        WindowsBackendTest::prepare(backend, client, render);
        WindowsBackendTest::prepare_dop(backend, container_bits,
            [&frames_to_render](uint8_t* output, int, int channels) {
                if (frames_to_render) {
                    for (int channel = 0; channel < channels; ++channel) {
                        output[channel * 3] = static_cast<uint8_t>(0x12 + channel);
                        output[channel * 3 + 1] = static_cast<uint8_t>(0x34 + channel);
                        output[channel * 3 + 2] = 0x05;
                    }
                }
                return frames_to_render;
            });

        auto check_packet = [&](uint8_t marker, bool has_payload) {
            CHECK(WaitForSingleObject(packet_ready.get(), 2000) == WAIT_OBJECT_0);
            const auto* data = reinterpret_cast<const uint8_t*>(render.data.data());
            const int bytes_per_sample = container_bits / 8;
            for (int frame = 0; frame < 33; ++frame) {
                for (int channel = 0; channel < 2; ++channel) {
                    const auto* sample = data + (frame * 2 + channel) * bytes_per_sample;
                    if (bytes_per_sample == 4) CHECK(*sample++ == 0);
                    CHECK(sample[0] == (has_payload && frame == 0 ? 0x12 + channel : 0x69));
                    CHECK(sample[1] == (has_payload && frame == 0 ? 0x34 + channel : 0x69));
                    CHECK(sample[2] == marker);
                }
                marker = marker == 0x05 ? 0xFA : 0x05;
            }
        };

        CHECK(backend.start());
        check_packet(0x05, false);
        WindowsBackendTest::request_buffer(backend);
        check_packet(0xFA, true);
        CHECK(backend.stop());

        frames_to_render = 0;
        CHECK(backend.start());
        CHECK(WaitForSingleObject(packet_ready.get(), 0) == WAIT_TIMEOUT);
        WindowsBackendTest::request_buffer(backend);
        check_packet(0x05, false);
        CHECK(backend.flush_checked());
        check_packet(0x05, false);
        CHECK(backend.stop());

        CHECK(backend.flush_checked());
        render.fail_buffer = true;
        CHECK(!backend.start());
        CHECK(backend.take_events() & BackendEventFailure);
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
    try { wasapi_failures(); wasapi_dop(); dsound_failures(); }
    catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
    std::cout << "WASAPI/DirectSound startup, render failure, checked seek flush and DoP passed\n";
}
