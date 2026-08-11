#pragma once

#include "audio_backend_factory.h"

class MacOSAudioBackendFactory final : public AudioBackendFactory {
public:
    std::unique_ptr<AudioBackend> create(BackendType type) override;
    std::vector<DeviceInfo> enumerate_devices() override;
    bool supports(BackendType type) const override;
};
