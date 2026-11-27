// Background Auto Mix planning, cached overlap analysis and vocal stem coordination.
// Revision checks keep plans for superseded tracks out of the playback path.

#include "audio_engine.h"
#include "auto_mix.h"
#include "auto_mix_preparation.h"
#include "ffmpeg_logging.h"
#include "logger.h"
#include <algorithm>
#include <cmath>
#include <deque>
#include <filesystem>
#include <iomanip>
#include <sstream>
#include <utility>
#include <vector>

namespace {
    struct AutoFadePlan {
        int64_t end_frame = 0;
        int64_t fade_frames = 0;
        int64_t source_frames = 0;
        int64_t scanned_frames = 0;
        int64_t trailing_frames = 0;
        double peak_rms = 0.0;
        double silence_threshold = 0.0;
        double earlier_rms = 0.0;
        double late_rms = 0.0;
        double separation = 0.0;
        int64_t incoming_start = 0;
        int64_t vocal_end_frame = 0;
        auto_mix::PreparedIntro prepared;
        auto_mix::MusicalProfile outgoing_music, incoming_music;
        double incoming_tempo = 1.0;
        const char* strategy = "staged-overlap";
        const char* fallback_reason = "analysis unavailable";
    };

    AutoFadePlan fallback_plan(const char* reason) {
        AutoFadePlan plan;
        plan.fallback_reason = reason;
        return plan;
    }

    std::string dbfs(double rms) {
        std::ostringstream value;
        value << std::fixed << std::setprecision(1)
              << 20.0 * std::log10(std::max(rms, 0.000000001)) << "dBFS";
        return value.str();
    }

    AutoFadePlan analyze_auto_crossfade_uncached(const std::string& path, const std::string& next_path, int max_ms, int mix_rate, int mix_channels,
        const std::function<bool()>& cancelled) {
        LOG_DEBUG("Auto crossfade analysis started");
        ScopedFFmpegLogContext log_context(path, "auto-crossfade-analysis");
        Decoder probe;
        if (!probe.open(path, mix_rate, mix_channels)) return fallback_plan("source could not be opened");
        const auto info = probe.track_info();
        int64_t total = probe.total_samples();
        if (info.sample_rate <= 0 || info.channels <= 0 || total <= 0 || info.is_dsd)
            return fallback_plan("unsupported or unknown source format");

        int64_t start = std::max<int64_t>(0, total - static_cast<int64_t>(info.sample_rate) * std::max(60, max_ms / 1000 + 12));
        if (start > 0 && !probe.seek(start))
            return fallback_plan("tail seek failed");
        const int block_frames = std::max(256, info.sample_rate / 10);
        std::vector<float> pcm(static_cast<size_t>(block_frames) * info.channels);
        using Level = auto_mix::Level;
        std::vector<Level> levels;
        double peak = 0.0;
        int64_t cursor = start;
        while (cursor < total) {
            if (cancelled()) return fallback_plan("superseded");
            const int frames = probe.decode(pcm.data(), static_cast<int>(std::min<int64_t>(block_frames, total - cursor)));
            if (frames < 0) return fallback_plan("tail decoding failed");
            if (frames <= 0) break;
            double square_sum = 0.0;
            for (int i = 0; i < frames * info.channels; ++i) square_sum += pcm[i] * pcm[i];
            const double rms = std::sqrt(square_sum / (frames * info.channels));
            cursor += frames;
            levels.push_back(auto_mix::measure(pcm.data(), frames, info.channels, cursor));
            peak = std::max(peak, rms);
        }
        // Duration metadata can be shorter than the actual PCM stream. In that
        // case the scan never saw the real ending and must not trim live audio.
        if (cursor >= total) {
            int extra = 0;
            while (extra <= info.sample_rate / 4) {
                const int frames = probe.decode(pcm.data(), block_frames);
                if (frames < 0) return fallback_plan("tail decoding failed");
                if (frames == 0) break;
                extra += frames;
                double square_sum = 0.0;
                for (int i = 0; i < frames * info.channels; ++i) square_sum += pcm[i] * pcm[i];
                const double rms = std::sqrt(square_sum / (frames * info.channels));
                cursor += frames;
                levels.push_back(auto_mix::measure(pcm.data(), frames, info.channels, cursor));
                peak = std::max(peak, rms);
            }
            if (extra > info.sample_rate / 4)
                return fallback_plan("duration metadata differs from decoded audio by over 250ms");
            total = cursor;
        }
        // If the entire window is silent, walk backwards instead of reverting
        // to fixed overlap (which would play the silent window in full).
        // Bound work to three minutes for malformed/all-silent sources.
        const int64_t scan_floor = std::max<int64_t>(0, total - info.sample_rate * 180LL);
        while (peak < auto_mix::silence_floor && start > scan_floor) {
            if (cancelled()) return fallback_plan("superseded");
            const int64_t stop = start;
            start = std::max<int64_t>(scan_floor, start - info.sample_rate * 30LL);
            if (!probe.seek(start)) return fallback_plan("silent tail backward seek failed");
            int64_t at = start;
            std::vector<Level> preceding;
            while (at < stop) {
                const int frames = probe.decode(pcm.data(), static_cast<int>(std::min<int64_t>(block_frames, stop - at)));
                if (frames <= 0) return fallback_plan("silent tail backward decode failed");
                at += frames;
                preceding.push_back(auto_mix::measure(pcm.data(), frames, info.channels, at));
                peak = std::max(peak, preceding.back().rms);
            }
            levels.insert(levels.begin(), preceding.begin(), preceding.end());
        }
        if (levels.empty() || peak < auto_mix::silence_floor)
            return fallback_plan("no audible samples within bounded tail scan");

        const double silence_threshold = auto_mix::silence_threshold(peak);
        int64_t last_audible = start;
        for (const auto& level : levels) {
            if (level.rms >= silence_threshold) last_audible = level.end;
        }
        int64_t end = total;
        const int64_t trailing = total - last_audible;
        if (trailing >= info.sample_rate * 6 / 10)
            end = std::min<int64_t>(total, last_audible + info.sample_rate * 15 / 100);

        const int64_t vocal_end_frame = end;
        auto average_level = [&](int64_t from, int64_t to) {
            double sum = 0.0;
            int count = 0;
            for (const auto& level : levels) {
                if (level.end > from && level.end <= to) { sum += level.rms; ++count; }
            }
            return count > 0 ? sum / count : 0.0;
        };
        const double earlier = average_level(end - info.sample_rate * 6LL, end - info.sample_rate * 2LL);
        const double late = average_level(end - info.sample_rate * 3LL / 2, end);
        const int64_t max_frames = std::min<int64_t>(end, static_cast<int64_t>(info.sample_rate) * max_ms / 1000);
        int64_t fade = max_frames;
        // Compare the actual handoff regions, rather than inferring compatibility
        // from genre tags. This is deliberately not a beat/key matching engine.
        double separation = 1.0; // unknown intro: prefer a short handoff
        int64_t incoming_start = 0;
        Decoder incoming;
        if (incoming.open(next_path, info.sample_rate, info.channels)) {
            const auto next = incoming.track_info();
            if (next.sample_rate == info.sample_rate && next.channels == info.channels) {
                std::vector<Level> intro;
                int64_t read = 0;
                const int64_t limit = std::min<int64_t>(incoming.total_samples(), info.sample_rate * 8LL);
                while (read < limit) {
                    if (cancelled()) return fallback_plan("superseded");
                    const int frames = incoming.decode(pcm.data(), static_cast<int>(std::min<int64_t>(block_frames, limit - read)));
                    if (frames <= 0) break;
                    read += frames;
                    intro.push_back(auto_mix::measure(pcm.data(), frames, info.channels, read));
                }
                double intro_peak = 0;
                for (const auto& level : intro) intro_peak = std::max(intro_peak, level.rms);
                const double intro_threshold = auto_mix::silence_threshold(intro_peak);
                for (const auto& level : intro) {
                    if (level.rms >= intro_threshold) {
                        incoming_start = std::max<int64_t>(0, level.end - block_frames - info.sample_rate / 20);
                        break;
                    }
                }
                // An exhausted fade-out can sound like a gap even after literal
                // silence is removed. Finish near its last useful energy, while
                // bounding the amount of musical material skipped.
                const double outro_reference = average_level(end - info.sample_rate * 6LL, end - info.sample_rate * 2LL);
                if (outro_reference > auto_mix::silence_floor && late < outro_reference * 0.4) {
                    int64_t energetic_end = end;
                    for (const auto& level : levels)
                        if (level.end <= end && level.rms >= std::max(silence_threshold, peak * 0.30))
                            energetic_end = level.end;
                    const int64_t allowance = static_cast<int64_t>(info.sample_rate) * std::min(8, max_ms / 1000 + 2);
                    if (energetic_end < end && end - energetic_end <= allowance && energetic_end > info.sample_rate * 2LL)
                        end = energetic_end;
                }
                separation = auto_mix::difference(
                    auto_mix::summarize(levels, end - info.sample_rate * 4LL, end),
                    auto_mix::summarize(intro, 0, read));
                // Never consume the entire incoming track during the overlap.
                fade = std::min<int64_t>(fade, std::max<int64_t>(0, incoming.total_samples() / 2));
            }
        }
        fade = auto_mix::overlap_frames(fade, info.sample_rate, separation);
        AutoFadePlan plan;
        fade = std::min(fade, end);
        plan.end_frame = end; plan.fade_frames = fade; plan.source_frames = total;
        plan.scanned_frames = cursor - start; plan.trailing_frames = trailing;
        plan.peak_rms = peak; plan.silence_threshold = silence_threshold;
        plan.incoming_start = incoming_start;
        plan.vocal_end_frame = vocal_end_frame;
        plan.earlier_rms = earlier; plan.late_rms = late; plan.separation = separation;
        plan.fallback_reason = fade > 0 ? nullptr : "maximum overlap is zero";
        if (cancelled()) return fallback_plan("superseded");
        plan.outgoing_music = auto_mix::analyze_region(path,
            std::max<int64_t>(0, last_audible - info.sample_rate * 24LL), last_audible,
            info.sample_rate, info.channels);
        if (cancelled()) return fallback_plan("superseded");
        plan.incoming_music = auto_mix::analyze_region(next_path, incoming_start,
            std::min<int64_t>(incoming.total_samples(), incoming_start + info.sample_rate * 24LL), info.sample_rate, info.channels);
        if (cancelled()) return fallback_plan("superseded");
        if (!auto_mix::harmonic_compatible(plan.outgoing_music.key, plan.incoming_music.key)) {
            plan.strategy = "harmonic-staged";
            plan.separation = std::max(plan.separation, 0.85);
            plan.fade_frames = auto_mix::overlap_frames(std::min<int64_t>({max_frames, end, incoming.total_samples() / 2}), info.sample_rate, plan.separation);
        } else {
            const int64_t musical_max = std::min<int64_t>({max_frames, info.sample_rate * 6LL,
                std::max<int64_t>(0, incoming.total_samples() / 2)});
            const auto handoff = auto_mix::choose_handoff(plan.outgoing_music, plan.incoming_music,
                end, musical_max, info.sample_rate, separation, incoming_start);
            if (handoff.matched) {
                plan.prepared = auto_mix::prepare_intro(next_path, info.sample_rate, info.channels,
                    handoff, plan.outgoing_music.period);
                if (!plan.prepared.pcm.empty()) {
                    plan.strategy = "beat-matched";
                    plan.fade_frames = handoff.fade_frames; plan.incoming_tempo = handoff.tempo;
                }
            }
        }
        return plan;
    }

    // Cache the complete immutable plan, including stretched PCM. Decoder position
    // adjustments are applied only to the returned copy, never to the cached plan.
    AutoFadePlan analyze_auto_crossfade(const std::string& path, const std::string& next_path,
        int max_ms, int rate, int channels, const std::function<bool()>& cancelled) {
        struct Identity {
            uintmax_t size = 0;
            std::filesystem::file_time_type stamp{};
            bool operator==(const Identity& other) const { return size == other.size && stamp == other.stamp; }
        };
        auto identify = [](const std::string& file, Identity& result) {
            std::error_code error;
            const auto name = std::filesystem::u8path(file);
            result.size = std::filesystem::file_size(name, error);
            if (error) return false;
            result.stamp = std::filesystem::last_write_time(name, error);
            return !error;
        };
        struct Entry {
            std::string source, next;
            Identity a, b;
            int max_ms, rate, channels;
            AutoFadePlan plan;
            size_t bytes() const { return sizeof(Entry) + plan.prepared.pcm.size() * sizeof(float); }
        };
        static std::mutex mutex;
        static std::deque<Entry> cache;
        constexpr size_t budget = 32 * 1024 * 1024;
        Identity a, b;
        const bool cacheable = identify(path, a) && identify(next_path, b);
        if (cacheable && !cancelled()) {
            std::lock_guard<std::mutex> lock(mutex);
            for (auto it = cache.begin(); it != cache.end(); ++it) {
                if (it->source == path && it->next == next_path && it->a == a && it->b == b &&
                    it->max_ms == max_ms && it->rate == rate && it->channels == channels) {
                    auto entry = std::move(*it);
                    cache.erase(it);
                    cache.push_back(std::move(entry));
                    LOG_DEBUG("Auto crossfade plan cache hit");
                    return cache.back().plan;
                }
            }
        }
        if (cancelled()) return fallback_plan("superseded");
        auto plan = analyze_auto_crossfade_uncached(path, next_path, max_ms, rate, channels, cancelled);
        Identity after_a, after_b;
        if (cacheable && !cancelled() && plan.end_frame > 0 && plan.fade_frames > 0 &&
            identify(path, after_a) && identify(next_path, after_b) && a == after_a && b == after_b) {
            Entry entry{path, next_path, a, b, max_ms, rate, channels, plan};
            if (entry.bytes() <= budget) {
                std::lock_guard<std::mutex> lock(mutex);
                size_t bytes = entry.bytes();
                for (const auto& item : cache) bytes += item.bytes();
                while (!cache.empty() && (cache.size() >= 8 || bytes > budget)) {
                    bytes -= cache.front().bytes(); cache.pop_front();
                }
                cache.push_back(std::move(entry));
            }
        }
        return plan;
    }
} // namespace

void AudioEngine::refresh_auto_fade_plan() {
    std::string current_path;
    std::string next_path;
    int max_ms = 0;
    int sample_rate = 0;
    int mix_channels = 0;
    int generation = 0;
    uint64_t revision = 0;
    {
        std::lock_guard<std::mutex> lock(decoder_mutex_);
        // Finish an audible adaptive overlap before applying transition changes.
        // Its incoming decoder may already point past the pre-rendered segment.
        if (crossfade_speed_supported() && transition_active_.load(std::memory_order_acquire) && auto_fade_end_frame_ > 0) return;
        cancel_auto_mix();
        auto_fade_end_frame_ = 0;
        auto_fade_frames_ = 0;
        auto_fade_vocal_end_frame_ = 0;
        auto_mix_out_vocals_.clear();
        auto_mix_in_vocals_.clear();
        ++auto_fade_revision_;
        auto_fade_intro_.clear();
        auto_fade_source_frames_ = 0;
        auto_fade_incoming_start_frame_ = 0;
        if (!crossfade_speed_supported() || playback_only_.load(std::memory_order_acquire) || !crossfade_enabled_.load(std::memory_order_acquire) ||
            !crossfade_auto_.load(std::memory_order_acquire) ||
            next_decoder_.track_info().file_path.empty()) return;
        current_path = decoder_.track_info().file_path;
        sample_rate = decoder_.track_info().sample_rate;
        mix_channels = decoder_.track_info().channels;
        next_path = next_track_path_;
        max_ms = crossfade_ms_.load(std::memory_order_acquire);
        generation = seek_generation_.load(std::memory_order_acquire);
        revision = auto_fade_revision_;
    }
    std::lock_guard<std::mutex> lock(auto_mix_mutex_);
    if (auto_mix_stopping_) return;
    const auto job = ++auto_mix_generation_;
    auto_mix_active_.store(job, std::memory_order_release);
    auto_mix_pending_ = [=] {
        compute_auto_fade_plan(current_path, next_path, max_ms, sample_rate, mix_channels, generation, revision, job);
    };
    if (!auto_mix_thread_.joinable()) {
        auto_mix_thread_ = std::thread([this] {
            for (;;) {
                std::function<void()> work;
                uint64_t job;
                {
                    std::unique_lock<std::mutex> lock(auto_mix_mutex_);
                    auto_mix_cv_.wait(lock, [this] { return auto_mix_stopping_ || bool(auto_mix_pending_); });
                    if (auto_mix_stopping_) return;
                    work = std::move(auto_mix_pending_);
                    auto_mix_pending_ = {};
                    job = auto_mix_active_.load(std::memory_order_acquire);
                }
                try { work(); }
                catch (const std::exception& error) { LOG_WARN(std::string("Auto crossfade analysis failed: ") + error.what()); }
                catch (...) { LOG_WARN("Auto crossfade analysis failed"); }
                auto_mix_active_.compare_exchange_strong(job, 0, std::memory_order_acq_rel);
            }
        });
    }
    auto_mix_cv_.notify_one();
}

void AudioEngine::cancel_auto_mix() {
    std::lock_guard<std::mutex> lock(auto_mix_mutex_);
    ++auto_mix_generation_;
    auto_mix_pending_ = {};
    auto_mix_active_.store(0, std::memory_order_release);
}

void AudioEngine::stop_auto_mix_thread() {
    {
        std::lock_guard<std::mutex> lock(auto_mix_mutex_);
        auto_mix_stopping_ = true;
        ++auto_mix_generation_;
        auto_mix_pending_ = {};
        auto_mix_active_.store(0, std::memory_order_release);
    }
    auto_mix_cv_.notify_one();
    if (auto_mix_thread_.joinable()) auto_mix_thread_.join();
}

void AudioEngine::compute_auto_fade_plan(const std::string& current_path, const std::string& next_path,
    int max_ms, int sample_rate, int mix_channels, int generation, uint64_t revision, uint64_t job) {
    const auto cancelled = [this, job] { return auto_mix_generation_.load(std::memory_order_acquire) != job; };
    auto plan = analyze_auto_crossfade(current_path, next_path, max_ms, sample_rate, mix_channels, cancelled);
    if (cancelled()) return;
    if (plan.end_frame <= 0 || plan.fade_frames <= 0) {
        LOG_WARN("Auto crossfade fallback: source=" + current_path +
            ", reason=" + plan.fallback_reason +
            ", fixedOverlap=" + std::to_string(max_ms) + "ms");
        return;
    }
    {
        std::lock_guard<std::mutex> lock(decoder_mutex_);
        if (cancelled() || !crossfade_speed_supported() || decoder_.track_info().file_path != current_path || next_track_path_ != next_path ||
            !crossfade_auto_.load(std::memory_order_acquire) ||
            !crossfade_enabled_.load(std::memory_order_acquire) ||
            crossfade_ms_.load(std::memory_order_acquire) != max_ms ||
            seek_generation_.load(std::memory_order_acquire) != generation ||
            auto_fade_revision_ != revision ||
            transition_active_.load(std::memory_order_acquire)) {
            LOG_DEBUG("Auto crossfade result discarded: queue or settings changed during analysis");
            return;
        }
        if (decoder_.position() >= plan.end_frame - plan.fade_frames) {
            LOG_DEBUG("Auto crossfade adjusted: source=" + current_path +
                ", reason=shortening overlap for late preparation" +
                ", position=" + std::to_string(decoder_.position() * 1000 / sample_rate) +
                "ms, plannedStart=" + std::to_string((plan.end_frame - plan.fade_frames) * 1000 /
                sample_rate) + "ms, fixedOverlap=" + std::to_string(max_ms) + "ms");
        }
        // A late queue/settings update must not reinstate a long silent tail.
        // Decoder position includes buffered audio, so only modify future PCM.
        if (decoder_.position() >= plan.end_frame) {
            // Already inside the detected silent tail: hand off from the next
            // undecoded frame, with a brief ramp rather than replaying silence.
            plan.end_frame = std::min<int64_t>(plan.source_frames,
                decoder_.position() + sample_rate / 20);
        }
        const int64_t remaining = plan.end_frame - decoder_.position();
        if (remaining <= 0) return;
        if (remaining < plan.fade_frames) {
            plan.prepared = {};
            plan.strategy = "late-short";
            plan.fade_frames = std::min<int64_t>(remaining, sample_rate * 8LL / 10);
        }
        if (plan.incoming_start > 0 && !next_decoder_.seek(plan.incoming_start)) {
            plan.prepared = {};
            plan.incoming_start = 0;
        }
        auto_fade_intro_ = std::move(plan.prepared.pcm);
        auto_fade_source_frames_ = plan.prepared.source_frames;
        auto_fade_incoming_start_frame_ = plan.incoming_start;
        auto_fade_end_frame_ = plan.end_frame;
        auto_fade_vocal_end_frame_ = plan.vocal_end_frame;
        auto_fade_frames_ = plan.fade_frames;
        auto_fade_separation_ = plan.separation;
        auto_mix_mixer_.reset(sample_rate, mix_channels);
    }
    LOG_DEBUG("Auto crossfade plan: source=" + current_path +
        ", next=" + next_path +
        ", strategy=" + plan.strategy +
        ", introTrim=" + std::to_string(plan.incoming_start * 1000 / sample_rate) + "ms" +
        ", outgoingBpm=" + std::to_string(plan.outgoing_music.bpm) +
        ", incomingBpm=" + std::to_string(plan.incoming_music.bpm) +
        ", beatConfidence=" + std::to_string(std::min(plan.outgoing_music.confidence, plan.incoming_music.confidence)) +
        ", outgoingKey=" + std::to_string(plan.outgoing_music.key) +
        ", incomingKey=" + std::to_string(plan.incoming_music.key) +
        ", incomingTempo=" + std::to_string(plan.incoming_tempo) +
        ", overlap=" + std::to_string(plan.fade_frames * 1000 / sample_rate) +
        "ms, start=" + std::to_string((plan.end_frame - plan.fade_frames) * 1000 / sample_rate) +
        "ms, end=" + std::to_string(plan.end_frame * 1000 / sample_rate) +
        "ms, trailingSilence=" + std::to_string(plan.trailing_frames * 1000 / sample_rate) +
        "ms, trimmed=" + std::to_string((plan.source_frames - plan.end_frame) * 1000 / sample_rate) + "ms");
    LOG_DEBUG("Auto crossfade levels: source=" + current_path +
        ", scanned=" + std::to_string(plan.scanned_frames * 1000 / sample_rate) +
        "ms, peak=" + dbfs(plan.peak_rms) +
        ", silenceThreshold=" + dbfs(plan.silence_threshold) +
        ", earlier=" + dbfs(plan.earlier_rms) +
        ", late=" + dbfs(plan.late_rms) +
        ", energyDrop=" + std::to_string(static_cast<int>(std::clamp(
            1.0 - plan.late_rms / std::max(plan.earlier_rms, 0.0015), 0.0, 1.0) * 100)) + "%" +
        ", separation=" + std::to_string(plan.separation) +
        ", maxOverlap=" + std::to_string(max_ms) + "ms");
}


AutoMixStemRequest AudioEngine::auto_mix_stem_request() const {
    std::lock_guard<std::mutex> lock(decoder_mutex_);
    const auto& current = decoder_.track_info();
    if (!crossfade_speed_supported() || !crossfade_auto_.load() || !crossfade_enabled_.load() || transition_active_.load() ||
        next_track_path_.empty() || !auto_fade_intro_.empty() || !auto_mix_out_vocals_.empty() || auto_fade_frames_ <= 0 || current.sample_rate <= 0 ||
        current.channels < 1 || current.channels > 2 || auto_fade_frames_ > current.sample_rate * 12LL ||
        decoder_.position() >= auto_fade_end_frame_ - auto_fade_frames_) return {};
    return {current.file_path, next_track_path_, auto_fade_revision_, current.sample_rate,
        current.channels, std::max<int64_t>(0, auto_fade_vocal_end_frame_ - auto_fade_frames_),
        auto_fade_incoming_start_frame_, auto_fade_frames_, vocal_cue_enabled_.load()};
}

bool AudioEngine::set_auto_mix_vocals(uint64_t revision, const std::string& out_path, const std::string& in_path, int64_t cue_frame, int64_t out_start_frame) {
    const auto request = auto_mix_stem_request();
    if (request.revision != revision || request.fade_frames <= 0) return false;
    const int64_t outgoing_start = out_start_frame >= 0 ? out_start_frame : request.out_start_frame;
    if (outgoing_start < std::max<int64_t>(0, request.out_start_frame - request.sample_rate * 8LL) ||
        outgoing_start > request.out_start_frame) return false;
    const int64_t incoming_start = cue_frame >= 0 ? cue_frame : request.in_start_frame;
    if (incoming_start < request.in_start_frame || incoming_start > request.in_start_frame + request.sample_rate * 40LL ||
        (!request.vocal_cue && incoming_start != request.in_start_frame)) return false;
    auto read = [&](const std::string& path, std::vector<float>& pcm) {
        Decoder stem;
        if (!stem.open(path, request.sample_rate, request.channels) || stem.track_info().is_dsd) return false;
        pcm.resize(static_cast<size_t>(request.fade_frames) * request.channels);
        int64_t at = 0;
        while (at < request.fade_frames) {
            const int frames = stem.decode(pcm.data() + at * request.channels,
                static_cast<int>(std::min<int64_t>(4096, request.fade_frames - at)));
            if (frames <= 0) return false;
            at += frames;
        }
        return std::all_of(pcm.begin(), pcm.end(), [](float x) { return std::isfinite(x) && std::abs(x) < 8; });
    };
    std::vector<float> outgoing, incoming;
    if (!read(out_path, outgoing) || !read(in_path, incoming)) return false;
    std::lock_guard<std::mutex> lock(decoder_mutex_);
    if (!crossfade_speed_supported() || auto_fade_revision_ != revision || decoder_.track_info().file_path != request.source_path ||
        next_track_path_ != request.next_path || transition_active_.load() || !crossfade_auto_.load() ||
        !crossfade_enabled_.load() || decoder_.position() >= std::min(outgoing_start, auto_fade_end_frame_ - auto_fade_frames_) ||
        incoming_start + request.fade_frames >= next_decoder_.total_samples() ||
        !next_decoder_.seek(incoming_start)) return false;
    auto_mix_out_vocals_ = std::move(outgoing); auto_mix_in_vocals_ = std::move(incoming);
    auto_fade_end_frame_ = outgoing_start + request.fade_frames;
    auto_fade_incoming_start_frame_ = incoming_start;
    auto_fade_intro_.clear(); auto_fade_source_frames_ = 0;
    auto_mix_vocal_mixer_.reset(request.sample_rate);
    ++auto_fade_revision_;
    LOG_INFO("Auto Mix vocal protection ready: overlap=" + std::to_string(request.fade_frames * 1000 / request.sample_rate) +
        "ms, tailTrim=" + std::to_string((request.out_start_frame - outgoing_start) * 1000 / request.sample_rate) +
        "ms, incomingCue=" + std::to_string(incoming_start * 1000 / request.sample_rate) + "ms, source=" + request.source_path + ", next=" + request.next_path);
    return true;
}
