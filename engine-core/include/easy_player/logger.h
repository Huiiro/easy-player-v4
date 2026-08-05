#pragma once

#include <functional>
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

    void debug(const std::string& msg)   { log(LogLevel::Debug, msg); }
    void info(const std::string& msg)    { log(LogLevel::Info, msg); }
    void warn(const std::string& msg)    { log(LogLevel::Warn, msg); }
    void error(const std::string& msg)   { log(LogLevel::Error, msg); }

private:
    Logger() = default;
    LogCallback callback_;
};

// Convenience macros
#define LOG_DEBUG(msg) Logger::instance().debug(msg)
#define LOG_INFO(msg)  Logger::instance().info(msg)
#define LOG_WARN(msg)  Logger::instance().warn(msg)
#define LOG_ERROR(msg) Logger::instance().error(msg)
