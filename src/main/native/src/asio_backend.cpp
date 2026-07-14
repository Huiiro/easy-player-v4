#include "asio_backend.h"
#include "logger.h"

// Phase 2: ASIO implementation via registry scan + LoadLibrary.
// For Phase 0, this is a stub — returns empty device list and fails open().

struct AsioBackend::Impl {};

AsioBackend::AsioBackend() : impl_(std::make_unique<Impl>()) {
    LOG_INFO("AsioBackend stub created (Phase 2 feature)");
}

AsioBackend::~AsioBackend() {
    close();
}

std::vector<DeviceInfo> AsioBackend::enumerate_devices() {
    LOG_WARN("AsioBackend::enumerate_devices() — not implemented (Phase 2)");
    return {};
}

AudioFormat AsioBackend::open(
    const std::wstring& /*device_id*/,
    const AudioFormat& /*requested_format*/,
    AudioCallback /*callback*/)
{
    LOG_ERROR("AsioBackend::open() — not implemented (Phase 2)");
    return {};
}

bool AsioBackend::start() { return false; }
bool AsioBackend::stop() { return false; }
void AsioBackend::close() {}
