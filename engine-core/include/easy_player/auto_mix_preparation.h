#pragma once
#include "decoder.h"
#include "musical_analysis.h"
#include <soundtouch/SoundTouch.h>
#include <deque>
#include <filesystem>
#include <mutex>
#include <string>

namespace auto_mix {
inline MusicalProfile analyze_region(const std::string& path, int64_t start, int64_t end, int mix_rate = 0, int mix_channels = 0) {
    struct Entry { std::string path; uintmax_t size; std::filesystem::file_time_type stamp; int64_t start, end; int rate, channels; MusicalProfile profile; };
    static std::mutex mutex;
    static std::deque<Entry> cache;
    std::error_code error;
    const auto size = std::filesystem::file_size(std::filesystem::u8path(path), error);
    if (error) return {};
    const auto stamp = std::filesystem::last_write_time(std::filesystem::u8path(path), error);
    if (error) return {};
    {
        std::lock_guard<std::mutex> lock(mutex);
        for (auto it = cache.begin(); it != cache.end(); ++it) {
            if (it->path == path && it->size == size && it->stamp == stamp && it->start == start && it->end == end && it->rate == mix_rate && it->channels == mix_channels) {
                const auto entry = *it; cache.erase(it); cache.push_back(entry); return entry.profile;
            }
        }
    }
    Decoder decoder;
    if (!decoder.open(path, mix_rate, mix_channels)) return {};
    const auto info = decoder.track_info();
    if (info.is_dsd || info.sample_rate <= 0 || info.channels <= 0 || end <= start ||
        end - start > info.sample_rate * 24LL || (start > 0 && !decoder.seek(start))) return {};
    MusicalAnalyzer analyzer(info.sample_rate, info.channels, double(start) / info.sample_rate);
    std::vector<float> pcm(static_cast<size_t>(4096) * info.channels);
    int64_t at = start;
    while (at < end) {
        const int frames = decoder.decode(pcm.data(), static_cast<int>(std::min<int64_t>(4096, end - at)));
        if (frames < 0) return {};
        if (!frames) break;
        analyzer.add(pcm.data(), frames); at += frames;
    }
    const auto result = analyzer.finish();
    const auto after_size = std::filesystem::file_size(std::filesystem::u8path(path), error);
    if (error || after_size != size) return result;
    const auto after_stamp = std::filesystem::last_write_time(std::filesystem::u8path(path), error);
    if (!error && after_stamp == stamp) {
        std::lock_guard<std::mutex> lock(mutex);
        if (cache.size() >= 16) cache.pop_front();
        cache.push_back({path, size, stamp, start, end, mix_rate, mix_channels, result});
    }
    return result;
}
struct PreparedIntro {
    std::vector<float> pcm;
    int64_t source_frames = 0;
};
// Render only the overlap, with an independent incoming tempo processor. The
// outgoing deck stays at its original speed; shared user DSP still runs later.
inline PreparedIntro prepare_intro(const std::string& path, int rate, int channels,
    const BeatHandoff& handoff, double beat_seconds) try {
    PreparedIntro result;
    if (!handoff.matched || channels < 1 || channels > 2 || rate < 8000 || rate > 192000 ||
        handoff.fade_frames > rate * 8LL || handoff.fade_frames <= handoff.delay_frames) return result;
    Decoder source;
    if (!source.open(path, rate, channels) || source.track_info().sample_rate != rate || source.track_info().channels != channels) return result;
    if (handoff.source_start > 0 && !source.seek(handoff.source_start)) return {};
    const int frames = static_cast<int>(handoff.fade_frames - handoff.delay_frames);
    std::vector<float> raw;
    soundtouch::SoundTouch stretch;
    stretch.setSampleRate(rate); stretch.setChannels(channels);
    std::vector<float> block(256 * channels);
    double expected = 0;
    while (expected < frames) {
        // Maintain the beat match for most of the overlap, then gently restore
        // the original tempo over the final beat, before handing back to PCM.
        const double recovery = std::clamp((expected - (frames - beat_seconds * rate)) /
            std::max(1.0, beat_seconds * rate), 0.0, 1.0);
        const double tempo = handoff.tempo + (1.0 - handoff.tempo) * recovery;
        const int count = std::max(1, std::min(256, static_cast<int>(std::ceil((frames - expected) * tempo))));
        const int decoded = source.decode(block.data(), count);
        if (decoded != count) return {};
        raw.insert(raw.end(), block.begin(), block.begin() + decoded * channels);
        stretch.setTempo(tempo);
        stretch.putSamples(block.data(), decoded);
        expected += decoded / tempo;
    }
    const int64_t raw_frames = raw.size() / channels;
    result.source_frames = handoff.source_start + raw_frames;
    if (result.source_frames >= source.total_samples()) return {};
    stretch.flush();
    const int available = static_cast<int>(stretch.numSamples());
    // A changing SoundTouch tempo can shift its final duration slightly. Never
    // fabricate silence or consume an unpredictable amount of source audio.
    if (std::abs(available - frames) > rate / 10 || available < frames) return {};
    result.pcm.assign(static_cast<size_t>(handoff.fade_frames) * channels, 0.0f);
    float* target = result.pcm.data() + handoff.delay_frames * channels;
    if (stretch.receiveSamples(target, frames) != static_cast<unsigned>(frames)) return {};
    // Join exactly to the original source endpoint. This also removes the
    // processor's flushed tail from the now fully audible incoming deck.
    const int join = std::min({rate / 12, frames, static_cast<int>(raw_frames)});
    for (int i = 0; i < join; ++i) {
        const float t = static_cast<float>(i + 1) / join;
        const float weight = t * t * (3 - 2 * t);
        for (int c = 0; c < channels; ++c) {
            const size_t dst = static_cast<size_t>(frames - join + i) * channels + c;
            const size_t src = static_cast<size_t>(raw_frames - join + i) * channels + c;
            target[dst] = target[dst] * (1 - weight) + raw[src] * weight;
        }
    }
    return result;
} catch (const std::exception&) {
    return {}; // Unsupported processing settings must keep normal playback usable.
}
} // namespace auto_mix
