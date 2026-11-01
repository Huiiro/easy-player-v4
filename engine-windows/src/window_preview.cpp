#include "window_preview.h"
Napi::Object InitWindowPreview(Napi::Env env, Napi::Object exports) {
    window_preview::install(env, exports);
    return exports;
}
NODE_API_MODULE(easy_player_window, InitWindowPreview)
