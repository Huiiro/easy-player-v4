#pragma once

// Shared formatting for output negotiation and track diagnostics.

#include "audio_backend.h"
#include <string>

namespace audio_engine_detail {

inline const char* backend_name(BackendType type) {
    switch (type) {
        case BackendType::WASAPI_SHARED: return "wasapi_shared";
        case BackendType::WASAPI_EXCLUSIVE: return "wasapi_exclusive";
        case BackendType::ASIO: return "asio";
        case BackendType::DIRECTSOUND: return "directsound";
    }
    return "unknown";
}

inline std::string format_audio(const AudioFormat& format) {
    return std::to_string(format.sample_rate) + "Hz/" + std::to_string(format.bit_depth) +
           "bit/" + std::to_string(format.channels) + "ch";
}

} // namespace audio_engine_detail
