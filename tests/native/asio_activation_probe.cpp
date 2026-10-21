// Read-only driver activation probe: does not initialize/start an audio device.
#include <windows.h>
#include <objbase.h>
#include <iomanip>
#include <iostream>
#include <thread>

static HRESULT activate(DWORD apartment) {
    HRESULT result = E_FAIL;
    std::thread thread([&] {
        const HRESULT initialized = CoInitializeEx(nullptr, apartment);
        if (FAILED(initialized)) { result = initialized; return; }
        CLSID clsid{};
        CLSIDFromString(L"{232685C6-6548-49D8-846D-4141A3EF7560}", &clsid);
        IUnknown* driver = nullptr;
        result = CoCreateInstance(clsid, nullptr, CLSCTX_INPROC_SERVER, clsid,
                                  reinterpret_cast<void**>(&driver));
        if (driver) driver->Release();
        CoUninitialize();
    });
    thread.join();
    return result;
}

int main() {
    const HRESULT mta = activate(COINIT_MULTITHREADED);
    const HRESULT sta = activate(COINIT_APARTMENTTHREADED);
    std::cout << std::hex << std::uppercase << "ASIO4ALL activation MTA=0x"
              << static_cast<unsigned long>(mta) << " STA=0x" << static_cast<unsigned long>(sta) << '\n';
    return FAILED(sta) ? 1 : 0;
}
