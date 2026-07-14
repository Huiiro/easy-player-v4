#include "wasapi_backend.h"
#include "logger.h"

// Phase 1: WASAPI implementation via IAudioClient.
// For Phase 0, this is a stub — returns empty device list and fails open().

struct WasapiBackend::Impl {};

WasapiBackend::WasapiBackend(bool exclusive) : exclusive_(exclusive), impl_(std::make_unique<Impl>()) {
    LOG_INFO("WasapiBackend stub created (Phase 1 feature)");
}

WasapiBackend::~WasapiBackend() {
    close();
}

std::vector<DeviceInfo> WasapiBackend::enumerate_devices() {
    LOG_WARN("WasapiBackend::enumerate_devices() — not implemented (Phase 1)");
    return {};
}

AudioFormat WasapiBackend::open(
    const std::wstring& /*device_id*/,
    const AudioFormat& /*requested_format*/,
    AudioCallback /*callback*/)
{
    LOG_ERROR("WasapiBackend::open() — not implemented (Phase 1)");
    return {};
}

bool WasapiBackend::start() { return false; }
bool WasapiBackend::stop() { return false; }
void WasapiBackend::close() {}
