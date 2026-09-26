#pragma once

#include <functional>
#include <cstdint>
#include <iomanip>
#include <sstream>
#include <string>

enum class LogLevel {
    Debug,
    Info,
    Warn,
    Error
};

// Simple logger that forwards messages to a JavaScript callback via N-API ThreadSafeFunction.
class Logger {
public:
    using LogCallback = std::function<void(LogLevel, const std::string&)>;

    static Logger& instance() {
        static Logger logger;
        return logger;
    }

    void set_callback(LogCallback cb) {
        callback_ = std::move(cb);
    }

    void log(LogLevel level, const std::string& message) {
        if (callback_) {
            callback_(level, message);
        }
    }

    void log(LogLevel level, const std::string& message, const char* file, int line,
             const char* function) {
        if (!callback_) return;
        // Keep source locations portable and avoid exposing build-machine paths.
        const char* filename = file;
        for (const char* p = file; *p; ++p) {
            if (*p == '/' || *p == '\\') filename = p + 1;
        }
        callback_(level, message + " [" + filename + ":" + std::to_string(line) +
                          " " + function + "]");
    }

    void debug(const std::string& msg)   { log(LogLevel::Debug, msg); }
    void info(const std::string& msg)    { log(LogLevel::Info, msg); }
    void warn(const std::string& msg)    { log(LogLevel::Warn, msg); }
    void error(const std::string& msg)   { log(LogLevel::Error, msg); }

private:
    Logger() = default;
    LogCallback callback_;
};

// HRESULT is signed on Windows; preserve its actual 32-bit hexadecimal value.
inline std::string log_hex(uint32_t code) {
    std::ostringstream output;
    output << "0x" << std::hex << std::uppercase << std::setfill('0') << std::setw(8) << code;
    return output.str();
}

// Device IDs are normally ASCII GUIDs. Preserve other wide code units as
// escapes instead of silently narrowing them according to the Windows locale.
inline std::string log_wide(const std::wstring& value) {
    std::ostringstream output;
    for (const wchar_t unit : value) {
        const auto code = static_cast<uint32_t>(unit);
        if (code >= 32 && code < 127) output << static_cast<char>(code);
        else output << "\\u" << std::hex << std::uppercase << std::setfill('0')
                    << std::setw(sizeof(wchar_t) * 2) << code << std::dec;
    }
    return output.str();
}

// Convenience macros
#define LOG_DEBUG(msg) Logger::instance().log(LogLevel::Debug, msg, __FILE__, __LINE__, __func__)
#define LOG_INFO(msg)  Logger::instance().info(msg)
#define LOG_WARN(msg)  Logger::instance().log(LogLevel::Warn, msg, __FILE__, __LINE__, __func__)
#define LOG_ERROR(msg) Logger::instance().log(LogLevel::Error, msg, __FILE__, __LINE__, __func__)
