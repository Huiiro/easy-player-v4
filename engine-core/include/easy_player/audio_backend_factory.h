#pragma once

#include "audio_backend.h"
#include <memory>
#include <vector>

// Platform boundary for output devices. AudioEngine owns decoding, buffering
// and DSP; a platform supplies this factory to create its output backend.
//
// The Windows implementation lives in windows_backend_factory.cpp. Android
// will provide the same contract with an Oboe/AAudio implementation, without
// pulling Win32 headers or device code into engine-core.
class AudioBackendFactory {
public:
    virtual ~AudioBackendFactory() = default;

    virtual std::unique_ptr<AudioBackend> create(BackendType type) = 0;
    virtual std::vector<DeviceInfo> enumerate_devices() = 0;
    virtual bool supports(BackendType type) const = 0;
};
