// Exercise the real backend with a fake IASIO server, without installed drivers.
#define NOMINMAX
#include <windows.h>
#include <objbase.h>
#include <iostream>
#include <stdexcept>

HRESULT mock_create(REFCLSID, LPUNKNOWN, DWORD, REFIID, LPVOID*);
#define CoCreateInstance mock_create
#include "../../engine-windows/src/asio_backend.cpp"
#undef CoCreateInstance

#define CHECK(x) do { if (!(x)) throw std::runtime_error(#x); } while (0)

struct FakeDriver {
    AsioVTable* vptr;
    AsioVTable table{};
    ASIOCallbacks* callbacks = nullptr;
    std::vector<std::vector<uint8_t>> buffers;
    std::thread::id owner;
    double rate = 44100;
    bool rate_set = false;
    bool valid_com = true;
    long minimum = 16, maximum = 256, preferred = 64, granularity = -1;
    long sample_type = ASIOSTFloat32LSB;
    int starts = 0, stops = 0, releases = 0, disposals = 0;
    int stop_failures = 0;
    bool fail_start = false, fail_size = false, fail_channels = false;
    std::function<void()> before_start;

    void check_thread() {
        APTTYPE apartment; APTTYPEQUALIFIER qualifier;
        valid_com = valid_com && SUCCEEDED(CoGetApartmentType(&apartment, &qualifier)) &&
                    (apartment == APTTYPE_STA || apartment == APTTYPE_MAINSTA) &&
                    owner == std::this_thread::get_id();
    }
    static FakeDriver& get(IUnknown* obj) {
        auto& driver = *reinterpret_cast<FakeDriver*>(obj);
        driver.check_thread();
        return driver;
    }
    FakeDriver() : vptr(&table) {
        table.init = [](IUnknown* obj, void*) -> ASIOBool { get(obj); return ASIOTrue; };
        table.getDriverName = [](IUnknown* obj, char* name) { get(obj); std::strcpy(name, "FakeASIO"); };
        table.getDriverVersion = [](IUnknown* obj) -> long { get(obj); return 1; };
        table.getChannels = [](IUnknown* obj, long* in, long* out) -> ASIOError {
            auto& d = get(obj); *in = 0; *out = 2; return d.fail_channels ? ASE_HWMalfunction : ASE_OK;
        };
        table.canSampleRate = [](IUnknown* obj, double) -> ASIOError { get(obj); return ASE_OK; };
        table.setSampleRate = [](IUnknown* obj, double rate) -> ASIOError {
            auto& d = get(obj); d.rate = rate; d.rate_set = true; return ASE_OK;
        };
        table.getSampleRate = [](IUnknown* obj, double* rate) -> ASIOError { *rate = get(obj).rate; return ASE_OK; };
        table.getBufferSize = [](IUnknown* obj, long* mn, long* mx, long* pr, long* gr) -> ASIOError {
            auto& d = get(obj); CHECK(d.rate_set || d.rate == 48000);
            *mn = d.minimum; *mx = d.maximum; *pr = d.preferred; *gr = d.granularity;
            return d.fail_size ? ASE_HWMalfunction : ASE_OK;
        };
        table.getChannelInfo = [](IUnknown* obj, ASIOChannelInfo* info) -> ASIOError {
            info->type = get(obj).sample_type; return ASE_OK;
        };
        table.createBuffers = [](IUnknown* obj, ASIOBufferInfo* info, long ch, long frames, ASIOCallbacks* cb) -> ASIOError {
            auto& d = get(obj); CHECK(frames == d.preferred);
            d.callbacks = cb; d.buffers.assign(ch * 2, std::vector<uint8_t>(frames * 4, 0xCD));
            for (long ci = 0; ci < ch; ++ci)
                for (int half = 0; half < 2; ++half) info[ci].buffers[half] = d.buffers[ci * 2 + half].data();
            CHECK(cb->asioMessage(1, 3, nullptr, nullptr) == 1);
            CHECK(cb->asioMessage(7, 0, nullptr, nullptr) == 1);
            return ASE_OK;
        };
        table.getLatencies = [](IUnknown* obj, long* in, long* out) -> ASIOError {
            get(obj); *in = 0; *out = 128; return ASE_OK;
        };
        table.start = [](IUnknown* obj) -> ASIOError {
            auto& d = get(obj); ++d.starts;
            if (d.before_start) d.before_start();
            // Some drivers call back synchronously before start() returns.
            d.callbacks->bufferSwitchTimeInfo(nullptr, 0, ASIOTrue);
            return d.fail_start ? ASE_HWMalfunction : ASE_OK;
        };
        table.stop = [](IUnknown* obj) -> ASIOError {
            auto& d = get(obj); ++d.stops;
            if (d.stop_failures > 0) { --d.stop_failures; return ASE_HWMalfunction; }
            return ASE_OK;
        };
        table.disposeBuffers = [](IUnknown* obj) -> ASIOError { ++get(obj).disposals; return ASE_OK; };
        table.Release = [](IUnknown* obj) -> ULONG { ++get(obj).releases; return 0; };
    }
};

static FakeDriver* driver;
HRESULT mock_create(REFCLSID, LPUNKNOWN, DWORD, REFIID, LPVOID* output) {
    driver->owner = std::this_thread::get_id();
    *output = reinterpret_cast<IUnknown*>(driver);
    return S_OK;
}

static const std::wstring device = L"{00000000-0000-0000-0000-000000000001}";
static AudioFormat open_pcm(AsioBackend& backend) {
    return backend.open(device, {48000, 32, 2}, [](float* output, int frames, int channels) {
        std::fill(output, output + frames * channels, 0.25f); return frames / 2;
    });
}

static void test_pcm_lifecycle() {
    FakeDriver fake; driver = &fake;
    AsioBackend backend;
    CHECK(std::async(std::launch::async, [&] { return open_pcm(backend); }).get().sample_rate == 48000);
    CHECK(fake.owner != std::this_thread::get_id());
    fake.before_start = [&] {
        const float* first = reinterpret_cast<float*>(fake.buffers[1].data());
        CHECK(first[0] == 0.25f); CHECK(first[63] == 0.0f);
    };
    CHECK(backend.start());
    std::fill(fake.buffers[0].begin(), fake.buffers[0].end(), 0xCD);
    CHECK(backend.flush_checked());
    CHECK(fake.starts == 2 && fake.stops == 1);
    fake.callbacks->sampleRateDidChange(48000); CHECK(backend.take_events() == 0);
    fake.callbacks->sampleRateDidChange(96000);
    CHECK(fake.callbacks->asioMessage(3, 0, nullptr, nullptr) == 1);
    CHECK(fake.callbacks->asioMessage(5, 0, nullptr, nullptr) == 1);
    CHECK(fake.callbacks->asioMessage(6, 0, nullptr, nullptr) == 1);
    CHECK(backend.take_events() == (BackendEventReset | BackendEventResync | BackendEventRateChanged | BackendEventLatenciesChanged));
    CHECK(backend.take_events() == 0);
    CHECK(std::async(std::launch::async, [&] { return backend.stop(); }).get());
    backend.close();
    CHECK(fake.valid_com && fake.releases == 1 && fake.disposals == 1);
    CHECK(backend.current_format().sample_rate == 0);
}

static void test_constraints_and_ownership() {
    for (int scenario = 0; scenario < 3; ++scenario) {
        FakeDriver fake; driver = &fake; AsioBackend backend;
        if (scenario == 0) {
            fake.rate = 48000; // An already-correct clock must not be reset.
            fake.minimum = fake.maximum = fake.preferred = 48; fake.granularity = 0;
        } else {
            fake.minimum = 32; fake.maximum = 256; fake.preferred = 80; fake.granularity = 16;
            if (scenario == 2) fake.preferred = 81;
        }
        const auto actual = open_pcm(backend);
        if (scenario == 2) { CHECK(actual.sample_rate == 0); continue; }
        CHECK(actual.sample_rate == 48000);
        CHECK(backend.buffer_size_frames() == fake.preferred);
        if (scenario == 0) CHECK(!fake.rate_set);
        AsioBackend competing;
        CHECK(open_pcm(competing).sample_rate == 0);
        CHECK(fake.releases == 0); // Failed competing open must not release the owner.
        CHECK(backend.start());
        CHECK(fake.callbacks->asioMessage(4, 128, nullptr, nullptr) == 1);
        fake.callbacks->sampleRateDidChange(0); // External clock loss.
        CHECK(backend.take_events() == (BackendEventReset | BackendEventRateChanged));
        backend.close();
        CHECK(fake.valid_com && fake.releases == 1);
    }
}

static void test_failures() {
    for (int scenario = 0; scenario < 5; ++scenario) {
        FakeDriver fake; driver = &fake; AsioBackend backend;
        if (scenario == 0) fake.fail_size = true;
        if (scenario == 1) fake.preferred = 65;
        if (scenario == 2) fake.fail_channels = true;
        if (scenario < 3) {
            CHECK(open_pcm(backend).sample_rate == 0);
        } else {
            CHECK(open_pcm(backend).sample_rate == 48000); CHECK(backend.start());
            if (scenario == 3) fake.fail_start = true;
            else fake.stop_failures = 1;
            CHECK(!backend.flush_checked());
            CHECK(fake.starts == (scenario == 3 ? 2 : 1));
            backend.close();
        }
        CHECK(fake.valid_com && fake.releases == 1);
    }
}

static void test_dop_silence() {
    for (long type : {ASIOSTInt24LSB, ASIOSTInt32LSB24}) {
        FakeDriver fake; driver = &fake; AsioBackend backend;
        fake.sample_type = type;
        fake.minimum = fake.maximum = fake.preferred = 17; fake.granularity = 0;
        CHECK(backend.open_dop(device, {176400, 24, 2}, [](uint8_t*, int, int) { return 0; }).sample_rate == 176400);
        const int bytes = type == ASIOSTInt24LSB ? 3 : 4;
        CHECK(backend.start());
        // Odd frame counts must preserve marker phase across half 1 -> half 0.
        CHECK(fake.buffers[1][2] == 0x05);
        CHECK(fake.buffers[1][16 * bytes + 2] == 0x05);
        CHECK(fake.buffers[0][0] == 0x69 && fake.buffers[0][1] == 0x69);
        CHECK(fake.buffers[0][2] == 0xFA);
        if (bytes == 4) CHECK(fake.buffers[0][3] == 0);
        CHECK(backend.stop()); CHECK(backend.start());
        backend.close(); CHECK(fake.valid_com);
    }
}

static void test_idle_message_pump() {
    AsioControlThread control;
    const HWND window = control.invoke([] {
        WNDCLASSW window_class{};
        window_class.hInstance = GetModuleHandleW(nullptr);
        window_class.lpszClassName = L"EasyPlayerAsioPumpTest";
        window_class.lpfnWndProc = [](HWND hwnd, UINT message, WPARAM w, LPARAM l) -> LRESULT {
            if (message == WM_APP + 1) { SetEvent(reinterpret_cast<HANDLE>(l)); return 0; }
            return DefWindowProcW(hwnd, message, w, l);
        };
        CHECK(RegisterClassW(&window_class));
        return CreateWindowExW(0, window_class.lpszClassName, L"", 0, 0, 0, 0, 0,
                               HWND_MESSAGE, nullptr, window_class.hInstance, nullptr);
    });
    CHECK(window);
    HANDLE delivered = CreateEventW(nullptr, FALSE, FALSE, nullptr);
    CHECK(delivered);
    CHECK(PostMessageW(window, WM_APP + 1, 0, reinterpret_cast<LPARAM>(delivered)));
    // No queued host task should be needed to dispatch a driver's window message.
    const DWORD result = WaitForSingleObject(delivered, 2000);
    control.invoke([&] {
        DestroyWindow(window);
        UnregisterClassW(L"EasyPlayerAsioPumpTest", GetModuleHandleW(nullptr));
    });
    CloseHandle(delivered);
    CHECK(result == WAIT_OBJECT_0);
}

int main() {
    try { test_pcm_lifecycle(); test_constraints_and_ownership(); test_failures(); test_dop_silence(); test_idle_message_pump(); }
    catch (const std::exception& error) { std::cerr << error.what() << '\n'; return 1; }
    std::cout << "ASIO lifecycle, COM, priming, notifications, failure and DoP tests passed\n";
}
