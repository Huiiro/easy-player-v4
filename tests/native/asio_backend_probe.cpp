// Explicit hardware diagnostic: opens ASIO4ALL briefly and renders only silence.
#include "asio_backend.h"
#include "logger.h"
#include <atomic>
#include <chrono>
#include <cstring>
#include <iostream>
#include <thread>

int main() {
    Logger::instance().set_callback([](LogLevel, const std::string& message) { std::cout << message << std::endl; });
    AsioBackend backend;
    std::atomic<int> callbacks{0};
    const auto actual = backend.open(L"{232685C6-6548-49D8-846D-4141A3EF7560}", {48000, 32, 2},
        [&](float* output, int frames, int channels) {
            std::memset(output, 0, static_cast<size_t>(frames) * channels * sizeof(float));
            ++callbacks; return frames;
        });
    if (!actual.sample_rate || !backend.start()) return 1;
    std::this_thread::sleep_for(std::chrono::milliseconds(500));
    const bool stopped = backend.stop();
    backend.close();
    const int count = callbacks;
    std::cout << "ASIO4ALL silent playback: callbacks=" << count << ", stop=" << stopped << std::endl;
    Logger::instance().set_callback({});
    return stopped && count > 2 ? 0 : 2;
}
