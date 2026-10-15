#include "../../engine-windows/src/wasapi_backend.h"
#include "../../engine-core/include/easy_player/logger.h"
#include <windows.h>
#include <iostream>

int main() {
    Logger::instance().set_callback([](LogLevel, const std::string& message) {
        std::cout << message << '\n';
    });
    WasapiBackend backend(true);
    int callbacks = 0;
    for (int attempt = 0; attempt < 2; ++attempt) {
        const AudioFormat actual = backend.open_dop(L"default", {176400, 24, 2},
            [&callbacks](uint8_t*, int, int) { ++callbacks; return 0; });
        std::cout << "attempt=" << attempt << " rate=" << actual.sample_rate
                  << " bits=" << actual.bit_depth << " channels=" << actual.channels << '\n';
        if (actual.sample_rate != 176400 || actual.bit_depth != 24 || actual.channels != 2) {
            return 1;
        }
        if (attempt == 0) {
            if (!backend.start()) return 2;
            Sleep(100);
            if (!backend.stop() || callbacks == 0) return 3;
            std::cout << "render_callbacks=" << callbacks << '\n';
        }
        backend.close();
    }
    return 0;
}
