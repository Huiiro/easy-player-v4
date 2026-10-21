#pragma once

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <functional>
#include <future>
#include <mutex>
#include <queue>
#include <thread>
#include <type_traits>
#include <system_error>

// IASIO creation, control and release always run on the same COM STA thread.
// Audio callbacks never submit work here or wait for this thread.
class AsioControlThread {
public:
    AsioControlThread() : thread_([this] { run(); }) {}
    ~AsioControlThread() {
        { std::lock_guard<std::mutex> lock(mutex_); exiting_ = true; }
        SetEvent(wake_.handle);
        thread_.join();
    }
    bool is_current() const { return std::this_thread::get_id() == thread_.get_id(); }
    template<class F> auto invoke(F&& f) -> std::invoke_result_t<F> {
        if (is_current()) return f();
        auto task = std::make_shared<std::packaged_task<std::invoke_result_t<F>()>>(std::forward<F>(f));
        auto result = task->get_future();
        {
            std::lock_guard<std::mutex> lock(mutex_);
            tasks_.push([task] { (*task)(); });
        }
        SetEvent(wake_.handle);
        return result.get();
    }
private:
    void run() {
        for (;;) {
            // Apartment drivers may own hidden windows or post control work.
            // Bound each batch so message traffic cannot starve host commands.
            MSG message{};
            for (int i = 0; i < 64 && PeekMessageW(&message, nullptr, 0, 0, PM_REMOVE); ++i) {
                TranslateMessage(&message);
                DispatchMessageW(&message);
            }
            std::function<void()> task;
            {
                std::lock_guard<std::mutex> lock(mutex_);
                if (exiting_ && tasks_.empty()) return;
                if (!tasks_.empty()) { task = std::move(tasks_.front()); tasks_.pop(); }
            }
            if (task) task();
            else MsgWaitForMultipleObjectsEx(1, &wake_.handle, INFINITE, QS_ALLINPUT, MWMO_INPUTAVAILABLE);
        }
    }
    struct WakeEvent {
        HANDLE handle = CreateEventW(nullptr, FALSE, FALSE, nullptr);
        WakeEvent() {
            if (!handle) throw std::system_error(GetLastError(), std::system_category(), "ASIO control event");
        }
        ~WakeEvent() { CloseHandle(handle); }
    };
    std::mutex mutex_;
    std::queue<std::function<void()>> tasks_;
    bool exiting_ = false;
    WakeEvent wake_;
    std::thread thread_;
};
