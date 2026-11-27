// Gapless and crossfade configuration, incoming decoder preparation and track handoff.
// Decoder changes are serialized with decoding by the engine decoder mutex.

#include "audio_engine.h"
#include "audio_engine_logging.h"
#include "logger.h"
#include <algorithm>
#include <cmath>

using audio_engine_detail::format_audio;

bool AudioEngine::crossfade_speed_supported() const {
    const auto speed = dsp_pipeline_.playback_speed_config();
    return !speed.enabled || std::abs(speed.speed - 1.0f) < 0.0001f;
}

bool AudioEngine::set_playback_speed_config(const PlaybackSpeedConfig& config) {
    {
        std::lock_guard<std::mutex> lock(decoder_mutex_);
        const bool was_supported = crossfade_speed_supported();
        if (!dsp_pipeline_.set_playback_speed_config(config)) return false;
        if (was_supported == crossfade_speed_supported()) return true;
        // Cancel both prepared and active overlaps before the decoder sees the
        // new speed. Rewind the incoming track so bypassing a mix skips no audio.
        cancel_auto_mix();
        ++auto_fade_revision_;
        transition_active_.store(false, std::memory_order_release);
        if (!next_track_path_.empty()) prepare_next_decoder_locked();
    }
    refresh_auto_fade_plan();
    return true;
}

bool AudioEngine::set_transition_config(const TransitionConfig& input) {
    TransitionConfig value{};
    value.gapless_enabled = input.gapless_enabled;
    value.crossfade_enabled = input.crossfade_enabled;
    value.crossfade_ms = std::max(0, std::min(30000, input.crossfade_ms));
    value.crossfade_auto = input.crossfade_auto;
    value.vocal_cue_enabled = input.vocal_cue_enabled;
    value.pause_fade_enabled = input.pause_fade_enabled;
    value.pause_fade_ms = std::max(0, std::min(1000, input.pause_fade_ms));
    if (!value.gapless_enabled) value.crossfade_enabled = false;
    // DoP is encoded data, so mixing it would corrupt the transport.
    if (dop_transport_active_.load(std::memory_order_acquire) && value.crossfade_enabled) {
        LOG_WARN("Transition config rejected: active DoP transport, crossfade_ms=" + std::to_string(value.crossfade_ms));
        return false;
    }
    LOG_DEBUG("Transition config: gapless=" + std::to_string(value.gapless_enabled) +
              ", crossfade=" + std::to_string(value.crossfade_enabled) + ", crossfade_ms=" +
              std::to_string(value.crossfade_ms) + ", adaptive=" + std::to_string(value.crossfade_auto) +
              ", pause_fade=" + std::to_string(value.pause_fade_enabled) +
              ", pause_fade_ms=" + std::to_string(value.pause_fade_ms));
    gapless_enabled_.store(value.gapless_enabled, std::memory_order_release);
    crossfade_enabled_.store(value.crossfade_enabled, std::memory_order_release);
    crossfade_ms_.store(value.crossfade_ms, std::memory_order_release);
    crossfade_auto_.store(value.crossfade_auto, std::memory_order_release);
    vocal_cue_enabled_.store(value.vocal_cue_enabled, std::memory_order_release);
    pause_fade_enabled_.store(value.pause_fade_enabled, std::memory_order_release);
    pause_fade_ms_.store(value.pause_fade_ms, std::memory_order_release);
    refresh_auto_fade_plan();
    return true;
}

bool AudioEngine::prepare_next_decoder_locked() {
    next_decoder_.close();
    const auto& current = decoder_.track_info();
    const bool mix = crossfade_speed_supported() && crossfade_enabled_.load(std::memory_order_acquire) && !current.is_dsd;
    if (next_track_path_.empty() || !next_decoder_.open(next_track_path_,
        mix ? current.sample_rate : 0, mix ? current.channels : 0)) return false;
    const auto& next = next_decoder_.track_info();
    const bool compatible = next.sample_rate == current.sample_rate &&
        next.channels == current.channels && (mix || next.bit_depth == current.bit_depth) &&
        !next.is_dsd && !current.is_dsd;
    if (!compatible) {
        LOG_DEBUG("Next decoder incompatible: source=" + current.file_path + " (" +
                  format_audio({current.sample_rate, current.bit_depth, current.channels}) +
                  "), target=" + next.file_path + " (" +
                  format_audio({next.sample_rate, next.bit_depth, next.channels}) +
                  "), source_dsd=" + std::to_string(current.is_dsd) + ", target_dsd=" + std::to_string(next.is_dsd));
        next_decoder_.close();
    }
    return compatible;
}

bool AudioEngine::set_next_track(const std::string& file_path, const std::string& source_path) {
    bool ready = true;
    {
        std::lock_guard<std::mutex> lock(decoder_mutex_);
        // Decoding can run ahead of the renderer and the audible transition.
        // A command prepared for the outgoing decoder must never modify the
        // incoming decoder's next track, including stale clear requests.
        if (!source_path.empty() && decoder_.track_info().file_path != source_path) return false;
        if (file_path == next_track_path_ &&
            (file_path.empty() || !next_decoder_.track_info().file_path.empty())) return true;
        cancel_auto_mix();
        next_track_path_ = file_path;
        next_decoder_.close();
        auto_fade_end_frame_ = 0;
        auto_fade_frames_ = 0;
        auto_fade_vocal_end_frame_ = 0;
        auto_mix_out_vocals_.clear();
        auto_mix_in_vocals_.clear();
        ++auto_fade_revision_;
        auto_fade_intro_.clear();
        auto_fade_source_frames_ = 0;
        auto_fade_incoming_start_frame_ = 0;
        transition_active_.store(false, std::memory_order_release);
        crossfade_target_warned_ = false;
        crossfade_started_logged_ = false;
        if (!file_path.empty()) {
            ready = prepare_next_decoder_locked();
            if (!ready) next_track_path_.clear();
        }
    }
    if (!ready) LOG_WARN("Crossfade target is unavailable or incompatible: target=" + file_path);
    if (ready && !file_path.empty()) refresh_auto_fade_plan();
    return ready;
}

bool AudioEngine::switch_to_next_decoder_locked() {
    // The renderer owns the queue, so an unavailable native "next" decoder
    // is not a request to replay the current file. Seeking back to zero here
    // made queue-loop mode look like single-track repeat and forced the
    // renderer to infer EOF from a position rollover.
    if (next_decoder_.track_info().file_path.empty()) return false;
    const auto& current = decoder_.track_info();
    const auto& next = next_decoder_.track_info();
    const int64_t total = decoder_.position();
    const bool mixed = transition_active_.load(std::memory_order_acquire);
    const int rate = std::max(1, current.sample_rate);
    const int64_t fade = mixed
        ? next_decoder_.position()
        : 0;
    LOG_DEBUG("Track transition: source=" + current.file_path +
        ", next=" + next.file_path +
        ", mode=" + (mixed ? (auto_fade_end_frame_ > 0 ? "auto crossfade" : "fixed crossfade") : "gapless") +
        ", outgoingEnd=" + std::to_string(total * 1000 / rate) +
        "ms, incomingConsumed=" + std::to_string(fade * 1000 / rate) + "ms");
    pending_ended_path_ = current.file_path;
    pending_track_info_ = next_decoder_.track_info();
    pending_start_frame_ = track_start_frame_.load(std::memory_order_acquire) + total - fade;
    pending_transition_frame_.store(track_start_frame_.load(std::memory_order_acquire) +
        total, std::memory_order_release);
    decoder_.swap(next_decoder_);
    next_decoder_.close();
    next_track_path_.clear();
    crossfade_target_warned_ = false;
    crossfade_started_logged_ = false;
    auto_fade_end_frame_ = 0;
    auto_fade_frames_ = 0;
    auto_fade_vocal_end_frame_ = 0;
    auto_mix_out_vocals_.clear();
    auto_mix_in_vocals_.clear();
    ++auto_fade_revision_;
    auto_fade_intro_.clear();
    auto_fade_source_frames_ = 0;
    auto_fade_incoming_start_frame_ = 0;
    return true;
}
