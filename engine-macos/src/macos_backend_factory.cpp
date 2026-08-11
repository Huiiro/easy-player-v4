#include "macos_backend_factory.h"

#include "macos_audio_backend.h"

std::unique_ptr<AudioBackend> MacOSAudioBackendFactory::create(BackendType type) {
    return supports(type) ? std::make_unique<MacOSAudioBackend>() : nullptr;
}

std::vector<DeviceInfo> MacOSAudioBackendFactory::enumerate_devices() {
    MacOSAudioBackend backend;
    return backend.enumerate_devices();
}

bool MacOSAudioBackendFactory::supports(BackendType type) const {
    return type == BackendType::DIRECTSOUND;
}
