#define NOMINMAX
#include <napi.h>
#include <windows.h>
#include <systemmediatransportcontrolsinterop.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Media.h>
#include <winrt/Windows.Storage.Streams.h>
#include <atomic>
#include <condition_variable>
#include <cstring>
#include <deque>
#include <functional>
#include <future>
#include <memory>
#include <mutex>
#include <thread>
#include <vector>

using namespace winrt;
using namespace Windows::Media;
using namespace Windows::Storage::Streams;

namespace {
struct Events {
    Napi::ThreadSafeFunction callback;
    std::atomic<bool> active{true};
    Events(Napi::Env env, Napi::Function fn)
        : callback(Napi::ThreadSafeFunction::New(env, fn, "SMTC buttons", 64, 1)) {
        callback.Unref(env);
    }
    ~Events() { callback.Release(); }
    void send(const char* action) {
        if (!active.load()) return;
        auto value = new std::string(action);
        if (callback.NonBlockingCall(value, [](Napi::Env env, Napi::Function fn, std::string* text) {
            std::unique_ptr<std::string> owned(text);
            if (env && fn) fn.Call({Napi::String::New(env, *owned)});
        }) != napi_ok) delete value;
    }
};

struct Snapshot {
    uint64_t revision;
    bool enabled, hasTrack, canPrevious, canNext;
    std::string title, artist, album, status;
};

class Bridge {
    std::mutex mutex;
    std::mutex closeMutex;
    std::condition_variable changed;
    std::deque<std::function<void()>> tasks;
    bool stopping = false;
    std::thread thread;
    std::promise<void> initialized;
    std::shared_ptr<Events> events;
    SystemMediaTransportControls controls{nullptr};
    uint64_t revision = 0;
    bool enabled = false;
    bool hasTrack = false;

    void run(HWND hwnd) {
        bool apartment = false;
        event_token token{};
        bool subscribed = false;
        try {
            init_apartment(apartment_type::multi_threaded);
            apartment = true;
            DWORD owner = 0;
            GetWindowThreadProcessId(hwnd, &owner);
            if (!IsWindow(hwnd) || owner != GetCurrentProcessId() || GetAncestor(hwnd, GA_ROOT) != hwnd)
                throw std::runtime_error("SMTC requires a top-level window in this process");
            auto interop = get_activation_factory<SystemMediaTransportControls, ISystemMediaTransportControlsInterop>();
            check_hresult(interop->GetForWindow(hwnd, guid_of<SystemMediaTransportControls>(), put_abi(controls)));
            controls.IsEnabled(false);
            controls.IsStopEnabled(false);
            controls.IsFastForwardEnabled(false);
            controls.IsRewindEnabled(false);
            controls.IsRecordEnabled(false);
            controls.IsChannelUpEnabled(false);
            controls.IsChannelDownEnabled(false);
            std::weak_ptr<Events> weak = events;
            token = controls.ButtonPressed([weak](auto const&, SystemMediaTransportControlsButtonPressedEventArgs const& args) {
                auto sink = weak.lock();
                if (!sink) return;
                switch (args.Button()) {
                    case SystemMediaTransportControlsButton::Play: sink->send("play"); break;
                    case SystemMediaTransportControlsButton::Pause: sink->send("pause"); break;
                    case SystemMediaTransportControlsButton::Previous: sink->send("previous"); break;
                    case SystemMediaTransportControlsButton::Next: sink->send("next"); break;
                    default: break;
                }
            });
            subscribed = true;
            initialized.set_value();
            for (;;) {
                std::function<void()> task;
                {
                    std::unique_lock<std::mutex> lock(mutex);
                    changed.wait(lock, [&] { return stopping || !tasks.empty(); });
                    if (tasks.empty() && stopping) break;
                    task = std::move(tasks.front());
                    tasks.pop_front();
                }
                task(); // packaged_task captures exceptions for the JS promise.
            }
        } catch (...) {
            try { initialized.set_exception(std::current_exception()); } catch (...) {}
        }
        if (controls) {
            try { if (subscribed) controls.ButtonPressed(token); } catch (...) {}
            try {
                controls.IsEnabled(false);
                controls.PlaybackStatus(MediaPlaybackStatus::Closed);
                controls.DisplayUpdater().ClearAll();
                controls.DisplayUpdater().Update();
            } catch (...) {}
            controls = nullptr;
        }
        {
            std::lock_guard<std::mutex> lock(mutex);
            stopping = true;
            tasks.clear();
        }
        if (apartment) uninit_apartment();
    }
public:
    std::shared_future<void> ready;
    Bridge(HWND hwnd, std::shared_ptr<Events> sink) : events(std::move(sink)) {
        ready = initialized.get_future().share();
        thread = std::thread([this, hwnd] { run(hwnd); });
    }
    ~Bridge() { close(); }
    void close() {
        std::lock_guard<std::mutex> closing(closeMutex);
        if (events) events->active = false;
        {
            std::lock_guard<std::mutex> lock(mutex);
            stopping = true;
        }
        changed.notify_one();
        if (thread.joinable()) thread.join();
        events.reset();
    }
    std::shared_future<void> submit(std::function<void()> action) {
        auto task = std::make_shared<std::packaged_task<void()>>(std::move(action));
        auto result = task->get_future().share();
        {
            std::lock_guard<std::mutex> lock(mutex);
            if (stopping) throw std::runtime_error("SMTC is closed");
            tasks.emplace_back([task] { (*task)(); });
        }
        changed.notify_one();
        return result;
    }
    std::shared_future<void> update(Snapshot value) {
        return submit([this, value] {
            if (!controls) throw std::runtime_error("SMTC is not ready");
            const bool trackChanged = revision != value.revision;
            revision = value.revision;
            enabled = value.enabled;
            hasTrack = value.hasTrack;
            auto updater = controls.DisplayUpdater();
            if (trackChanged || !hasTrack || !enabled) updater.ClearAll();
            if (hasTrack && enabled) {
                updater.Type(MediaPlaybackType::Music);
                auto music = updater.MusicProperties();
                music.Title(to_hstring(value.title));
                music.Artist(to_hstring(value.artist));
                music.AlbumTitle(to_hstring(value.album));
            }
            updater.Update();
            const bool active = enabled && hasTrack;
            const bool playable = active && value.status != "loading";
            controls.IsPlayEnabled(playable);
            controls.IsPauseEnabled(playable);
            controls.IsPreviousEnabled(playable && value.canPrevious);
            controls.IsNextEnabled(playable && value.canNext);
            auto status = MediaPlaybackStatus::Closed;
            if (active) {
                if (value.status == "playing") status = MediaPlaybackStatus::Playing;
                else if (value.status == "loading") status = MediaPlaybackStatus::Changing;
                else if (value.status == "stopped") status = MediaPlaybackStatus::Stopped;
                else status = MediaPlaybackStatus::Paused;
            }
            controls.PlaybackStatus(status);
            controls.IsEnabled(active);
        });
    }
    std::shared_future<void> artwork(std::vector<uint8_t> bytes, uint64_t expected) {
        return submit([this, bytes = std::move(bytes), expected] {
            if (!controls || revision != expected || !enabled || !hasTrack) return;
            InMemoryRandomAccessStream stream;
            DataWriter writer(stream);
            writer.WriteBytes(bytes);
            writer.StoreAsync().get();
            writer.DetachStream();
            stream.Seek(0);
            auto updater = controls.DisplayUpdater();
            updater.Thumbnail(RandomAccessStreamReference::CreateFromStream(stream));
            updater.Update();
        });
    }
};

class WaitWorker : public Napi::AsyncWorker {
    Napi::Promise::Deferred deferred;
    std::function<void()> action;
public:
    WaitWorker(Napi::Env env, std::function<void()> fn)
        : AsyncWorker(env), deferred(Napi::Promise::Deferred::New(env)), action(std::move(fn)) {}
    void Execute() override {
        try { action(); }
        catch (hresult_error const& error) { SetError(to_string(error.message())); }
        catch (std::exception const& error) { SetError(error.what()); }
    }
    void OnOK() override { deferred.Resolve(Env().Undefined()); }
    void OnError(Napi::Error const& error) override { deferred.Reject(error.Value()); }
    Napi::Promise start() { auto result = deferred.Promise(); Queue(); return result; }
};

class Session : public Napi::ObjectWrap<Session> {
    std::shared_ptr<Bridge> bridge;
    static void cleanup(void* data) { static_cast<Session*>(data)->bridge->close(); }
    Napi::Value wait(Napi::Env env, std::shared_future<void> result) {
        auto keep = bridge;
        return (new WaitWorker(env, [keep, result] { result.get(); }))->start();
    }
public:
    Session(Napi::CallbackInfo const& info) : ObjectWrap(info) {
        if (info.Length() != 2 || !info[0].IsBuffer() || !info[1].IsFunction())
            throw Napi::TypeError::New(info.Env(), "Expected HWND buffer and action callback");
        auto bytes = info[0].As<Napi::Buffer<uint8_t>>();
        if (bytes.Length() != sizeof(HWND)) throw Napi::TypeError::New(info.Env(), "Invalid HWND buffer");
        HWND hwnd;
        std::memcpy(&hwnd, bytes.Data(), sizeof(hwnd));
        auto events = std::make_shared<Events>(info.Env(), info[1].As<Napi::Function>());
        bridge = std::make_shared<Bridge>(hwnd, std::move(events));
        napi_add_env_cleanup_hook(info.Env(), cleanup, this);
    }
    ~Session() {
        napi_remove_env_cleanup_hook(Env(), cleanup, this);
        bridge->close();
    }
    Napi::Value Ready(Napi::CallbackInfo const& info) { return wait(info.Env(), bridge->ready); }
    Napi::Value Update(Napi::CallbackInfo const& info) {
        auto o = info[0].As<Napi::Object>();
        Snapshot value{
            static_cast<uint64_t>(o.Get("revision").As<Napi::Number>().Int64Value()),
            o.Get("enabled").As<Napi::Boolean>().Value(), o.Get("hasTrack").As<Napi::Boolean>().Value(),
            o.Get("canPrevious").ToBoolean().Value(), o.Get("canNext").ToBoolean().Value(),
            o.Get("title").As<Napi::String>().Utf8Value(), o.Get("artist").As<Napi::String>().Utf8Value(),
            o.Get("album").As<Napi::String>().Utf8Value(), o.Get("status").As<Napi::String>().Utf8Value()
        };
        try { return wait(info.Env(), bridge->update(std::move(value))); }
        catch (std::exception const& error) { throw Napi::Error::New(info.Env(), error.what()); }
    }
    Napi::Value Artwork(Napi::CallbackInfo const& info) {
        auto bytes = info[0].As<Napi::Buffer<uint8_t>>();
        if (bytes.Length() > 2 * 1024 * 1024) throw Napi::Error::New(info.Env(), "Artwork too large");
        auto revision = static_cast<uint64_t>(info[1].As<Napi::Number>().Int64Value());
        try { return wait(info.Env(), bridge->artwork({bytes.Data(), bytes.Data() + bytes.Length()}, revision)); }
        catch (std::exception const& error) { throw Napi::Error::New(info.Env(), error.what()); }
    }
    Napi::Value Close(Napi::CallbackInfo const& info) {
        auto keep = bridge;
        return (new WaitWorker(info.Env(), [keep] { keep->close(); }))->start();
    }
    static Napi::Object init(Napi::Env env, Napi::Object exports) {
        exports.Set("Session", DefineClass(env, "Session", {
            InstanceMethod("ready", &Session::Ready), InstanceMethod("update", &Session::Update),
            InstanceMethod("artwork", &Session::Artwork), InstanceMethod("close", &Session::Close)
        }));
        return exports;
    }
};
}
Napi::Object InitSmtc(Napi::Env env, Napi::Object exports) { return Session::init(env, exports); }
NODE_API_MODULE(easy_player_smtc, InitSmtc)
