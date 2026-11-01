#pragma once
#include <windows.h>
#include <dwmapi.h>
#include <napi.h>
#include <algorithm>
#include <cstring>


namespace window_preview {
inline HWND handle(const Napi::Value& value) {
    if (!value.IsBuffer()) return nullptr;
    auto bytes = value.As<Napi::Buffer<unsigned char>>();
    if (bytes.Length() != sizeof(HWND)) return nullptr;
    HWND window{}; std::memcpy(&window, bytes.Data(), sizeof(window));
    DWORD pid{}; GetWindowThreadProcessId(window, &pid);
    return pid == GetCurrentProcessId() && IsWindow(window) ? window : nullptr;
}
inline void install(Napi::Env env, Napi::Object exports) {
    exports.Set("configureCoverPreview", Napi::Function::New(env, [](const Napi::CallbackInfo& args) {
        HWND window = args.Length() >= 2 ? handle(args[0]) : nullptr;
        if (!window || !args[1].IsBoolean()) return Napi::Boolean::New(args.Env(), false);
        BOOL enabled = args[1].As<Napi::Boolean>().Value();
        HRESULT first = DwmSetWindowAttribute(window, DWMWA_FORCE_ICONIC_REPRESENTATION, &enabled, sizeof(enabled));
        HRESULT second = DwmSetWindowAttribute(window, DWMWA_HAS_ICONIC_BITMAP, &enabled, sizeof(enabled));
        DwmInvalidateIconicBitmaps(window);
        return Napi::Boolean::New(args.Env(), SUCCEEDED(first) && SUCCEEDED(second));
    }));
    exports.Set("invalidateCoverPreview", Napi::Function::New(env, [](const Napi::CallbackInfo& args) {
        HWND window = args.Length() ? handle(args[0]) : nullptr;
        return Napi::Boolean::New(args.Env(), window && SUCCEEDED(DwmInvalidateIconicBitmaps(window)));
    }));
    exports.Set("drawCoverPreview", Napi::Function::New(env, [](const Napi::CallbackInfo& args) {
        auto fail = [&]() { return Napi::Boolean::New(args.Env(), false); };
        HWND window = args.Length() == 5 ? handle(args[0]) : nullptr;
        if (!window || !args[1].IsBuffer() || !args[2].IsNumber() || !args[3].IsNumber() || !args[4].IsBoolean()) return fail();
        const bool live = args[4].As<Napi::Boolean>().Value();
        int width = args[2].As<Napi::Number>().Int32Value(), height = args[3].As<Napi::Number>().Int32Value();
        if (live) { RECT rect{}; GetClientRect(window, &rect); width = rect.right; height = rect.bottom; }
        width = std::clamp(width, 1, 4096); height = std::clamp(height, 1, 4096);
        auto pixels = args[1].As<Napi::Buffer<unsigned char>>();
        constexpr int sourceSize = 512;
        if (pixels.Length() != sourceSize*sourceSize*4) return fail();
        if (!live) width = height = (std::min)(width, height);
        BITMAPINFO info{}; info.bmiHeader.biSize = sizeof(BITMAPINFOHEADER);
        info.bmiHeader.biPlanes = 1; info.bmiHeader.biBitCount = 32; info.bmiHeader.biCompression = BI_RGB;
        HDC screen = GetDC(nullptr), source = CreateCompatibleDC(screen), target = CreateCompatibleDC(screen);
        info.bmiHeader.biWidth = sourceSize; info.bmiHeader.biHeight = -sourceSize;
        void* sourcePixels{}; HBITMAP input = CreateDIBSection(screen, &info, DIB_RGB_COLORS, &sourcePixels, nullptr, 0);
        info.bmiHeader.biWidth = width; info.bmiHeader.biHeight = -height;
        void* targetPixels{}; HBITMAP output = CreateDIBSection(screen, &info, DIB_RGB_COLORS, &targetPixels, nullptr, 0);
        bool success = false;
        if (source && target && input && output) {
            std::memcpy(sourcePixels, pixels.Data(), pixels.Length());
            auto oldSource = SelectObject(source, input), oldTarget = SelectObject(target, output);
            RECT rect{0,0,width,height}; HBRUSH background = CreateSolidBrush(RGB(17,22,20));
            FillRect(target, &rect, background); DeleteObject(background);
            SetStretchBltMode(target, HALFTONE); SetBrushOrgEx(target, 0,0,nullptr);
            const int size = (std::min)(width,height);
            StretchBlt(target, (width-size)/2,(height-size)/2,size,size,source,0,0,sourceSize,sourceSize,SRCCOPY);
            GdiFlush();
            auto bytes = static_cast<unsigned char*>(targetPixels);
            for (int i=0;i<width*height;++i) bytes[i*4+3]=255;
            SelectObject(source,oldSource); SelectObject(target,oldTarget);
            HRESULT result = live ? DwmSetIconicLivePreviewBitmap(window,output,nullptr,0) : DwmSetIconicThumbnail(window,output,0);
            success = SUCCEEDED(result);
        }
        if (input) DeleteObject(input); if (output) DeleteObject(output);
        if (source) DeleteDC(source); if (target) DeleteDC(target); ReleaseDC(nullptr,screen);
        return Napi::Boolean::New(args.Env(), success);
    }));
}
}
