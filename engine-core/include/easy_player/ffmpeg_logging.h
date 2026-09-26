#pragma once

#include <cstdint>
#include <string>

// FFmpeg's callback is process-wide. Install it once; operation context stays
// local to each calling thread so independent decoders do not mix file paths.
void initialize_ffmpeg_logging();

class ScopedFFmpegLogContext {
public:
    ScopedFFmpegLogContext(const std::string& path, const char* operation, int64_t sample = -1);
    ~ScopedFFmpegLogContext();
    ScopedFFmpegLogContext(const ScopedFFmpegLogContext&) = delete;
    ScopedFFmpegLogContext& operator=(const ScopedFFmpegLogContext&) = delete;

    const std::string& path;
    const char* operation;
    const int64_t sample;
    const ScopedFFmpegLogContext* previous;
};
