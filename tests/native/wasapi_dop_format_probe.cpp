#define NOMINMAX
#include <windows.h>
#include <mmdeviceapi.h>
#include <audioclient.h>
#include <audiopolicy.h>
#include <ksmedia.h>
#include <iostream>

int main() {
    const HRESULT init = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    if (FAILED(init)) return 1;
    IMMDeviceEnumerator* enumerator = nullptr;
    IMMDeviceCollection* devices = nullptr;
    HRESULT hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
        __uuidof(IMMDeviceEnumerator), reinterpret_cast<void**>(&enumerator));
    if (SUCCEEDED(hr)) hr = enumerator->EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE, &devices);
    if (FAILED(hr)) { std::cout << "enumeration hr=" << std::hex << hr << '\n'; return 1; }
    UINT count = 0;
    devices->GetCount(&count);
    for (UINT i = 0; i < count; ++i) {
        IMMDevice* device = nullptr;
        if (FAILED(devices->Item(i, &device))) continue;
        LPWSTR id = nullptr;
        device->GetId(&id);
        std::wcout << L"device=" << (id ? id : L"?") << L'\n';
        IAudioSessionManager2* sessions = nullptr;
        if (SUCCEEDED(device->Activate(__uuidof(IAudioSessionManager2), CLSCTX_ALL, nullptr,
            reinterpret_cast<void**>(&sessions)))) {
            IAudioSessionEnumerator* entries = nullptr;
            if (SUCCEEDED(sessions->GetSessionEnumerator(&entries))) {
                int session_count = 0;
                entries->GetCount(&session_count);
                for (int session = 0; session < session_count; ++session) {
                    IAudioSessionControl* control = nullptr;
                    if (FAILED(entries->GetSession(session, &control))) continue;
                    IAudioSessionControl2* control2 = nullptr;
                    if (SUCCEEDED(control->QueryInterface(__uuidof(IAudioSessionControl2),
                        reinterpret_cast<void**>(&control2)))) {
                        DWORD pid = 0;
                        if (SUCCEEDED(control2->GetProcessId(&pid)) && pid != 0) {
                            std::wcout << L"  audio_session_pid=" << pid << L'\n';
                        }
                        control2->Release();
                    }
                    control->Release();
                }
                entries->Release();
            }
            sessions->Release();
        }
        for (int container_bits : {24, 32}) {
            IAudioClient* client = nullptr;
            hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr,
                reinterpret_cast<void**>(&client));
            if (SUCCEEDED(hr)) {
                WAVEFORMATEXTENSIBLE format{};
                format.Format.wFormatTag = WAVE_FORMAT_EXTENSIBLE;
                format.Format.nChannels = 2;
                format.Format.nSamplesPerSec = 176400;
                format.Format.wBitsPerSample = static_cast<WORD>(container_bits);
                format.Format.nBlockAlign = static_cast<WORD>(2 * container_bits / 8);
                format.Format.nAvgBytesPerSec = 176400 * format.Format.nBlockAlign;
                format.Format.cbSize = sizeof(WAVEFORMATEXTENSIBLE) - sizeof(WAVEFORMATEX);
                format.Samples.wValidBitsPerSample = 24;
                format.dwChannelMask = KSAUDIO_SPEAKER_STEREO;
                format.SubFormat = KSDATAFORMAT_SUBTYPE_PCM;
                WAVEFORMATEX* closest = nullptr;
                hr = client->IsFormatSupported(AUDCLNT_SHAREMODE_EXCLUSIVE, &format.Format, &closest);
                if (closest) CoTaskMemFree(closest);
                client->Release();
            }
            std::cout << "  176400Hz PCM24 in " << container_bits << " bits: hr=0x"
                      << std::hex << static_cast<unsigned long>(hr) << std::dec << '\n';
        }
        if (id) CoTaskMemFree(id);
        device->Release();
    }
    devices->Release();
    enumerator->Release();
    CoUninitialize();
}
