#define NOMINMAX
#include <windows.h>
#include "../../engine-core/include/easy_player/decoder.h"
#include "../../engine-core/include/easy_player/logger.h"
#include <iostream>
#include <vector>
#include <algorithm>

int wmain(int argc, wchar_t** argv) {
    std::cout << std::unitbuf;
    if (argc != 2 && argc != 3) return 2;
    Logger::instance().set_callback([](LogLevel, const std::string& message) {
        std::cout << message << '\n';
    });
    const int bytes = WideCharToMultiByte(CP_UTF8, 0, argv[1], -1, nullptr, 0, nullptr, nullptr);
    if (bytes <= 1) return 2;
    std::string path(static_cast<size_t>(bytes), '\0');
    WideCharToMultiByte(CP_UTF8, 0, argv[1], -1, path.data(), bytes, nullptr, nullptr);
    path.pop_back();
    Decoder decoder;
    std::cout << "opening\n";
    if (!decoder.open(path)) return 3;
    const auto info = decoder.track_info();
    std::cout << "source=" << info.dsd_sample_rate << "Hz/" << info.channels << "ch\n";
    if (!decoder.begin_dop()) return 4;
    std::cout << "dop_started\n";
    std::vector<uint8_t> buffer(static_cast<size_t>(4096) * info.channels * 3);
    const int64_t resume_frame = argc == 3 ? _wtoi64(argv[2]) : -1;
    std::vector<uint8_t> expected;
    int64_t total = 0;
    for (;;) {
        const int frames = decoder.read_dop(buffer.data(), 4096);
        if (frames < 0) return 5;
        if (frames == 0) break;
        if (resume_frame >= total && resume_frame + 4096 <= total + frames) {
            const size_t byte_offset = static_cast<size_t>(resume_frame - total) * info.channels * 3;
            expected.assign(buffer.begin() + byte_offset,
                            buffer.begin() + byte_offset + static_cast<size_t>(4096) * info.channels * 3);
        }
        total += frames;
        if (total % (4096 * 256) < 4096) std::cout << "frames=" << total << '\n';
    }
    std::cout << "dop_frames=" << total << '\n';
    if (resume_frame >= 0) {
        if (expected.empty() || !decoder.begin_dop(resume_frame)) return 7;
        const int frames = decoder.read_dop(buffer.data(), 4096);
        if (frames != 4096 || !std::equal(expected.begin(), expected.end(), buffer.begin())) {
            std::cout << "resume_mismatch frame=" << resume_frame << " frames=" << frames << '\n';
            return 8;
        }
        std::cout << "resume_match frame=" << resume_frame << '\n';
    }
    return total > 0 ? 0 : 6;
}
