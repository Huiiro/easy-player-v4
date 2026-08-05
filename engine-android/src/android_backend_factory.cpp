#include "android_backend_factory.h"

#include "android_aaudio_backend.h"

std::unique_ptr<AudioBackend> AndroidAudioBackendFactory::create(BackendType type) {
    // DIRECTSOUND is the existing engine's default output selection. On
    // Android it means "system-selected low-latency output", not DirectSound.
    return supports(type) ? std::make_unique<AndroidAAudioBackend>() : nullptr;
}

std::vector<DeviceInfo> AndroidAudioBackendFactory::enumerate_devices() {
    AndroidAAudioBackend backend;
    return backend.enumerate_devices();
}

bool AndroidAudioBackendFactory::supports(BackendType type) const {
    return type == BackendType::DIRECTSOUND;
}
