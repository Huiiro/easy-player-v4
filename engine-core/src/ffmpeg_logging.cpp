#include "ffmpeg_logging.h"
#include "logger.h"
#include <mutex>

extern "C" {
#include <libavutil/log.h>
}

namespace {
thread_local const ScopedFFmpegLogContext* current_context = nullptr;

const char* ffmpeg_level_name(int level) {
    if (level <= AV_LOG_PANIC) return "panic";
    if (level <= AV_LOG_FATAL) return "fatal";
    if (level <= AV_LOG_ERROR) return "error";
    if (level <= AV_LOG_WARNING) return "warning";
    if (level <= AV_LOG_INFO) return "info";
    if (level <= AV_LOG_VERBOSE) return "verbose";
    if (level <= AV_LOG_DEBUG) return "debug";
    return "trace";
}

void forward_ffmpeg_log(void* context, int level, const char* format, va_list arguments) {
    level &= 0xff; // Strip optional terminal color bits.
    if (level > av_log_get_level() || level == (AV_LOG_QUIET & 0xff)) return;
    // Never let allocation failures or logger exceptions cross a C callback.
    try {
        char buffer[4096] = {};
        int print_prefix = 1;
        const int size = av_log_format_line2(context, level, format, arguments,
                                             buffer, sizeof(buffer), &print_prefix);
        std::string text(buffer);
        while (!text.empty() && (text.back() == '\n' || text.back() == '\r' || text.back() == ' '))
            text.pop_back();
        if (text.empty()) return;
        if (size >= static_cast<int>(sizeof(buffer))) text += " [truncated]";
        std::string message = "FFmpeg [level=" + std::string(ffmpeg_level_name(level)) + "] ";
        if (current_context) {
            message += "operation=" + std::string(current_context->operation) +
                       ", path=" + current_context->path;
            if (current_context->sample >= 0)
                message += ", sample=" + std::to_string(current_context->sample);
            if (current_context->previous)
                message += ", parent_operation=" + std::string(current_context->previous->operation);
            message += ": ";
        }
        message += text;
        // A codec's error-level diagnostic may be recoverable or occur during
        // probing. Decoder return codes decide application warn/error severity.
        // Preserve FFmpeg's original level in the text for debugging.
        if (level <= AV_LOG_FATAL) LOG_ERROR(message);
        else LOG_DEBUG(message);
    } catch (...) {
        // Diagnostic output must not interrupt playback or unwind into FFmpeg.
    }
}
} // namespace

void initialize_ffmpeg_logging() {
    static std::once_flag installed;
    std::call_once(installed, [] { av_log_set_callback(forward_ffmpeg_log); });
}

ScopedFFmpegLogContext::ScopedFFmpegLogContext(const std::string& source, const char* stage,
                                               int64_t position)
    : path(source), operation(stage), sample(position), previous(current_context) {
    initialize_ffmpeg_logging();
    current_context = this;
}

ScopedFFmpegLogContext::~ScopedFFmpegLogContext() {
    current_context = previous;
}
