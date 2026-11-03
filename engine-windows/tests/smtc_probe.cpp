#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Media.Control.h>
#include <winrt/Windows.Storage.Streams.h>
#include <iostream>
#include <string>

using namespace winrt;
using namespace Windows::Media::Control;
std::string json(hstring const& text) {
    std::string out = "\"";
    for (auto c : to_string(text)) {
        if (c == '"' || c == '\\') { out += '\\'; out += c; }
        else if (c == '\n') out += "\\n";
        else if (c == '\r') out += "\\r";
        else if (static_cast<unsigned char>(c) >= 32) out += c;
    }
    return out + "\"";
}
int main(int argc, char** argv) {
    try {
        init_apartment(apartment_type::multi_threaded);
        auto manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().get();
        for (auto const& session : manager.GetSessions()) {
            auto id = session.SourceAppUserModelId();
            if (argc < 2 || id != to_hstring(argv[1])) continue;
            std::string action = argc > 2 ? argv[2] : "inspect";
            if (action != "inspect") {
                bool result = false;
                if (action == "play") result = session.TryPlayAsync().get();
                else if (action == "pause") result = session.TryPauseAsync().get();
                else if (action == "previous") result = session.TrySkipPreviousAsync().get();
                else if (action == "next") result = session.TrySkipNextAsync().get();
                std::cout << (result ? "true" : "false");
                return result ? 0 : 2;
            }
            auto media = session.TryGetMediaPropertiesAsync().get();
            auto info = session.GetPlaybackInfo();
            auto controls = info.Controls();
            auto thumbnail = media.Thumbnail();
            uint64_t artworkSize = thumbnail ? thumbnail.OpenReadAsync().get().Size() : 0;
            std::cout << "{\"id\":" << json(id)
                << ",\"title\":" << json(media.Title()) << ",\"artist\":" << json(media.Artist())
                << ",\"album\":" << json(media.AlbumTitle())
                << ",\"status\":" << static_cast<int>(info.PlaybackStatus())
                << ",\"play\":" << (controls.IsPlayEnabled() ? "true" : "false")
                << ",\"pause\":" << (controls.IsPauseEnabled() ? "true" : "false")
                << ",\"previous\":" << (controls.IsPreviousEnabled() ? "true" : "false")
                << ",\"next\":" << (controls.IsNextEnabled() ? "true" : "false")
                << ",\"seek\":" << (controls.IsPlaybackPositionEnabled() ? "true" : "false")
                << ",\"artworkSize\":" << artworkSize << "}";
            return 0;
        }
        std::cout << "null";
        return 0;
    } catch (hresult_error const& error) {
        std::cerr << to_string(error.message());
        return 1;
    }
}
