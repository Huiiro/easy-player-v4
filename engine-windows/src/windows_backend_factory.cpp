#include "windows_backend_factory.h"

#include "asio_backend.h"
#include "dsound_backend.h"
#include "wasapi_backend.h"
#include <unordered_set>

std::unique_ptr<AudioBackend> WindowsAudioBackendFactory::create(BackendType type) {
    switch (type) {
        case BackendType::WASAPI_SHARED: return std::make_unique<WasapiBackend>(false);
        case BackendType::WASAPI_EXCLUSIVE: return std::make_unique<WasapiBackend>(true);
        case BackendType::ASIO: return std::make_unique<AsioBackend>();
        case BackendType::DIRECTSOUND: return std::make_unique<DSoundBackend>();
    }
    return nullptr;
}

bool WindowsAudioBackendFactory::supports(BackendType type) const {
    return type == BackendType::DIRECTSOUND || type == BackendType::WASAPI_SHARED ||
           type == BackendType::WASAPI_EXCLUSIVE || type == BackendType::ASIO;
}

std::vector<DeviceInfo> WindowsAudioBackendFactory::enumerate_devices() {
    std::vector<DeviceInfo> devices;
    std::unordered_set<std::wstring> seen_names;
    auto append_unique_names = [&](std::vector<DeviceInfo> list) {
        for (auto& device : list) {
            if (seen_names.insert(device.name).second) devices.push_back(std::move(device));
        }
    };

    // Preserve the existing desktop ordering: ASIO first, then WASAPI, then
    // the DirectSound fallback. Android can expose its own device policy.
    auto asio = create(BackendType::ASIO);
    auto asio_devices = asio->enumerate_devices();
    for (auto& device : asio_devices) devices.push_back(std::move(device));

    auto shared = create(BackendType::WASAPI_SHARED);
    append_unique_names(shared->enumerate_devices());
    auto exclusive = create(BackendType::WASAPI_EXCLUSIVE);
    auto exclusive_devices = exclusive->enumerate_devices();
    for (auto& device : exclusive_devices) devices.push_back(std::move(device));

    auto direct_sound = create(BackendType::DIRECTSOUND);
    append_unique_names(direct_sound->enumerate_devices());
    return devices;
}
