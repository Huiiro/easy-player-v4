// Decoder producer, real-time PCM/DoP consumers and deferred playback events.
// The decoder queues audio; the device callback drains it and the timer dispatches notifications.

#include "audio_engine.h"
#include "auto_mix.h"
#include "logger.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <vector>

void AudioEngine::decoder_thread_func() {
    LOG_DEBUG("Decoder thread started");
    int channels = track_info_.channels;

    std::vector<float> buffer;
    if (!dop_transport_active_.load(std::memory_order_acquire))
        buffer.resize(static_cast<size_t>(4096) * channels);
    while (decoder_running_) {
        if (dop_transport_active_.load(std::memory_order_acquire)) {
            if (!dop_ring_buffer_) break;
            const int target = dop_ring_buffer_->writable_frames();
            if (target < 1024) {
                std::this_thread::sleep_for(std::chrono::milliseconds(10));
                continue;
            }
            const int decode_chunk = std::min(target, 4096);
            int decoded = 0;
            {
                std::lock_guard<std::mutex> lock(decoder_mutex_);
                decoded = decoder_.read_dop(dop_work_buffer_.data(), decode_chunk);
                if (decoded > 0) dop_ring_buffer_->write(dop_work_buffer_.data(), decoded);
            }
            if (decoded <= 0) {
                LOG_DEBUG("DSD DoP reader reached EOF");
                decoder_running_ = false;
                break;
            }
            continue;
        }
        // Keep ring buffer around 75% full
        int target = ring_buffer_->write_available() / channels;
        if (target < 1024) {
            std::this_thread::sleep_for(std::chrono::milliseconds(10));
            continue;
        }

        int decode_chunk = std::min(target, 4096);
        int decoded = 0;

        {
            // Hold mutex for entire decode+write cycle.
            // seek() also holds this mutex during reset+seek, ensuring:
            // - No concurrent FFmpeg access (thread safety)
            // - Ring buffer reset can't happen between decode and write
            std::lock_guard<std::mutex> lock(decoder_mutex_);
            const auto transition = transition_config();
            const bool mix_speed_supported = crossfade_speed_supported();
            const bool finish_auto_fade = mix_speed_supported && transition_active_.load(std::memory_order_acquire) && auto_fade_end_frame_ > 0;
            const bool auto_fade = mix_speed_supported && ((transition.crossfade_enabled && transition.crossfade_auto) || finish_auto_fade) &&
                auto_fade_end_frame_ > 0 && !next_decoder_.track_info().file_path.empty();
            const int64_t total = auto_fade ? auto_fade_end_frame_ : decoder_.total_samples();
            const int64_t position = decoder_.position();
            const int fade_frames = mix_speed_supported && (transition.crossfade_enabled || finish_auto_fade) && !track_info_.is_dsd
                ? static_cast<int>(std::min<int64_t>(total, auto_fade ? auto_fade_frames_ :
                    static_cast<int64_t>(track_info_.sample_rate) * transition.crossfade_ms / 1000))
                : 0;
            const int64_t remaining = std::max<int64_t>(0, total - position);
            const bool in_fade = fade_frames > 0 && remaining <= fade_frames;
            if (in_fade) decode_chunk = static_cast<int>(std::min<int64_t>(decode_chunk, remaining));
            else if (fade_frames > 0 && remaining > fade_frames)
                decode_chunk = static_cast<int>(std::min<int64_t>(decode_chunk, remaining - fade_frames));
            decoded = decoder_.decode(buffer.data(), decode_chunk);

            if (decoded > 0 && in_fade) {
                if (next_decoder_.track_info().file_path.empty() && !prepare_next_decoder_locked()) {
                    if (!crossfade_target_warned_) {
                        LOG_WARN("Crossfade target unavailable; continuing without a mix");
                        crossfade_target_warned_ = true;
                    }
                } else {
                    transition_work_buffer_.resize(static_cast<size_t>(decoded) * channels);
                    int next_frames = 0;
                    const int64_t prepared_offset = fade_frames - remaining;
                    if (auto_fade && auto_fade_intro_.size() == static_cast<size_t>(fade_frames) * channels &&
                        prepared_offset >= 0 && prepared_offset + decoded <= fade_frames) {
                        // Seek once before using prepared PCM, so the decoder is
                        // ready at the exact original-source continuation point.
                        if (next_decoder_.position() == auto_fade_source_frames_ ||
                            next_decoder_.seek(auto_fade_source_frames_)) {
                            std::copy_n(auto_fade_intro_.data() + prepared_offset * channels,
                                decoded * channels, transition_work_buffer_.data());
                            next_frames = decoded;
                        } else {
                            auto_fade_intro_.clear();
                            prepare_next_decoder_locked();
                        }
                    }
                    if (next_frames == 0) {
                        // A seek can enter halfway through an overlap. Keep raw
                        // incoming PCM aligned with both stem buffers and cues.
                        if (auto_fade && auto_fade_intro_.empty()) {
                            const int64_t expected = auto_fade_incoming_start_frame_ + prepared_offset;
                            if (std::abs(next_decoder_.position() - expected) > 2 && !next_decoder_.seek(expected))
                                auto_mix_in_vocals_.clear();
                        }
                        next_frames = next_decoder_.decode(transition_work_buffer_.data(), decoded);
                    }
                    if (next_frames == decoded) {
                        if (!crossfade_started_logged_) {
                            LOG_DEBUG("Crossfade started: source=" + decoder_.track_info().file_path +
                                ", next=" + next_decoder_.track_info().file_path +
                                ", mode=" + (auto_fade ? "auto" : "fixed") +
                                ", position=" + std::to_string(position * 1000 / track_info_.sample_rate) +
                                "ms, remaining=" + std::to_string(remaining * 1000 / track_info_.sample_rate) +
                                "ms, overlap=" + std::to_string(fade_frames * 1000 / track_info_.sample_rate) + "ms");
                            crossfade_started_logged_ = true;
                        }
                        const int64_t fade_offset = fade_frames - remaining;
                        if (auto_fade && auto_mix_out_vocals_.size() == static_cast<size_t>(fade_frames) * channels &&
                            auto_mix_in_vocals_.size() == auto_mix_out_vocals_.size()) {
                            auto_mix_vocal_mixer_.process(buffer.data(), transition_work_buffer_.data(),
                                auto_mix_out_vocals_.data() + fade_offset * channels,
                                auto_mix_in_vocals_.data() + fade_offset * channels,
                                decoded, channels, fade_offset, fade_frames);
                        } else if (auto_fade) {
                            auto_mix_mixer_.process(buffer.data(), transition_work_buffer_.data(), decoded,
                                channels, fade_offset, fade_frames, auto_fade_separation_);
                        } else for (int frame = 0; frame < decoded; ++frame) {
                            const float t = std::min(1.0f, static_cast<float>(fade_offset + frame) /
                                static_cast<float>(std::max(1, fade_frames - 1)));
                            // Equal-power throughout: complementary fades made unrelated
                            // material dip in energy at the midpoint.
                            const auto gains = auto_mix::gains(t, 0.0);
                            const float outgoing = gains.first;
                            const float incoming = gains.second;
                            for (int channel = 0; channel < channels; ++channel) {
                                const size_t index = static_cast<size_t>(frame) * channels + channel;
                                buffer[index] = buffer[index] * outgoing + transition_work_buffer_[index] * incoming;
                            }
                        }
                        transition_active_.store(true, std::memory_order_release);
                    } else {
                        // A partial read is not a usable overlap. Restore the
                        // decoder so the next track is not truncated at EOF.
                        if (!crossfade_target_warned_) {
                            LOG_WARN("Crossfade target ended before the outgoing overlap completed: " +
                                next_decoder_.track_info().file_path);
                            crossfade_target_warned_ = true;
                        }
                        prepare_next_decoder_locked();
                    }
                }
            }

            if (decoded <= 0) {
                if (decoded < 0) {
                    decoder_failed_.store(true, std::memory_order_release);
                    std::lock_guard<std::mutex> end_lock(track_end_mutex_);
                    decoder_error_message_ = decoder_.last_error();
                    LOG_ERROR("Decoder stopped after an unrecoverable error: " + decoder_error_message_);
                    decoder_running_ = false;
                    break;
                }
                if ((transition.gapless_enabled || finish_auto_fade) && !track_info_.is_dsd && switch_to_next_decoder_locked()) {
                    transition_active_.store(false, std::memory_order_release);
                    continue;
                }
                LOG_DEBUG("Decoder reached EOF");
                decoder_running_ = false;
                break;
            }

            ring_buffer_->write(buffer.data(), decoded, 0); // timeout=0: non-blocking
            // Switch immediately after the tail is queued. The already-open
            // decoder has advanced by fade_frames, so the overlap is not
            // replayed after a crossfade.
            if (decoder_.position() >= total && (transition.gapless_enabled || finish_auto_fade) && !track_info_.is_dsd) {
                if (switch_to_next_decoder_locked()) transition_active_.store(false, std::memory_order_release);
            }
        }
    }
    LOG_DEBUG("Decoder thread stopped");
}

void AudioEngine::mark_track_ended_pending() {
    // This path runs only once at EOF; capturing the source prevents a late
    // notification from being attributed to a track selected in the meantime.
    {
        std::lock_guard<std::mutex> lock(track_end_mutex_);
        ended_track_path_ = track_info_.file_path;
        ended_track_reason_ = decoder_failed_.load(std::memory_order_acquire) ? "decode_error" : "eof";
    }
    track_end_pending_.store(true, std::memory_order_release);
}

void AudioEngine::position_timer_func() {
    auto next_position_event = std::chrono::steady_clock::now();
    while (timer_running_) {
        std::this_thread::sleep_for(std::chrono::milliseconds(100));

        bool transitioned = false;
        if (pending_transition_frame_.load(std::memory_order_acquire) >= 0 &&
            played_frames_.load(std::memory_order_acquire) >=
                pending_transition_frame_.load(std::memory_order_acquire)) {
            std::string ended_path;
            {
                std::lock_guard<std::mutex> lock(decoder_mutex_);
                if (pending_transition_frame_.load(std::memory_order_acquire) >= 0) {
                    ended_path = pending_ended_path_;
                    track_info_ = pending_track_info_;
                    track_start_frame_.store(pending_start_frame_, std::memory_order_release);
                    update_replay_gain_for_track();
                    pending_transition_frame_.store(-1, std::memory_order_release);
                }
            }
            transitioned = !ended_path.empty();
            if (transitioned && track_ended_cb_) track_ended_cb_("transition", ended_path);
        }

        if (track_end_pending_.exchange(false, std::memory_order_acq_rel)) {
            // ThreadSafeFunction and logging may lock or allocate, so this
            // transition is deliberately deferred out of audio_callback().
            set_state(EngineState::Stopped);
            std::string ended_track_reason;
            std::string decoder_error;
            std::string ended_track_path;
            {
                std::lock_guard<std::mutex> lock(track_end_mutex_);
                if (transitioned) ended_track_path_ = track_info_.file_path;
                ended_track_path = ended_track_path_;
                ended_track_reason = ended_track_reason_;
                decoder_error = decoder_error_message_;
            }
            if (ended_track_reason == "decode_error") {
                LOG_ERROR("Track ended because decoding could not continue: " + decoder_error);
                if (error_cb_) error_cb_(-1, decoder_error.empty() ? "Audio decoding failed" : decoder_error);
            } else {
                LOG_DEBUG("Track ended (EOF reached)");
            }
            if (track_ended_cb_) track_ended_cb_(ended_track_reason, ended_track_path);
            // Do not leave an inactive callback pumping silence forever.
            // This thread never joins itself; stop() will join the finished
            // timer later when the user opens another track or stops.
            if (backend_) backend_->stop();
            stop_analysis_thread();
            timer_running_.store(false, std::memory_order_release);
            return;
        }

        const uint64_t processed_eq = dsp_pipeline_.processed_eq_generation();
        if (processed_eq != 0 && processed_eq != last_logged_eq_generation_) {
            last_logged_eq_generation_ = processed_eq;
            LOG_DEBUG("EQ configuration reached audio callback: generation=" +
                     std::to_string(processed_eq) + ", active bands=" +
                     std::to_string(dsp_pipeline_.active_eq_band_count()));
        }

        if (pos_cb_ && state_ == EngineState::Playing) {
            const auto now = std::chrono::steady_clock::now();
            if (!playback_only_.load(std::memory_order_acquire) || transitioned || now >= next_position_event) {
                pos_cb_(position_ms(), duration_ms());
                next_position_event = now + std::chrono::seconds(1);
            }
        }
    }
}

int AudioEngine::dop_audio_callback(uint8_t* output, int frames, int channels) {
    if ((state_ != EngineState::Playing && state_ != EngineState::Ready) ||
        !dop_transport_active_.load(std::memory_order_acquire) || !dop_ring_buffer_ ||
        channels != track_info_.channels) {
        return 0;
    }
    const int read = dop_ring_buffer_->read(output, frames);
    if (read < frames) glitch_count_.fetch_add(1, std::memory_order_relaxed);
    // The producer may run ahead of the audio clock, so the consumer owns
    // marker phase. This keeps 0x05/0xFA continuous across an underrun. A
    // DSD byte value of 0x69 is the conventional sigma-delta silence pattern.
    for (int frame = 0; frame < frames; ++frame) {
        const uint8_t marker = dop_output_marker_;
        for (int channel = 0; channel < channels; ++channel) {
            uint8_t* sample = output + (static_cast<size_t>(frame) * channels + channel) * 3;
            if (frame >= read) { sample[0] = 0x69; sample[1] = 0x69; }
            sample[2] = marker;
        }
        dop_output_marker_ = marker == 0x05 ? 0xFA : 0x05;
    }
    dop_carrier_frames_.fetch_add(read, std::memory_order_relaxed);
    if (state_ != EngineState::Ready && !decoder_running_ && dop_ring_buffer_->readable_frames() == 0 &&
        !track_ended_fired_.exchange(true, std::memory_order_acq_rel)) {
        mark_track_ended_pending();
    }
    return frames;
}

int AudioEngine::audio_callback(float* output, int frames, int channels) {
    if (pcm_io_resetting_.load(std::memory_order_acquire)) {
        std::memset(output, 0, frames * channels * sizeof(float));
        return frames;
    }
    pcm_callbacks_in_flight_.fetch_add(1, std::memory_order_acq_rel);
    struct CallbackGuard {
        std::atomic<int>& count;
        ~CallbackGuard() { count.fetch_sub(1, std::memory_order_release); }
    } guard{pcm_callbacks_in_flight_};
    const EngineState playback_state = state_.load(std::memory_order_acquire);
    const bool fading_out = playback_state == EngineState::Paused &&
        pause_fade_pending_.load(std::memory_order_acquire) && pause_fade_live_ > 0.0f;
    if (pcm_io_resetting_.load(std::memory_order_acquire) ||
        (playback_state != EngineState::Playing && playback_state != EngineState::Ready && !fading_out) || !ring_buffer_ ||
        source_work_buffer_.empty()) {
        // Paused or stopped: output silence
        if (playback_state == EngineState::Paused && !fading_out) pause_fade_live_ = 0.0f;
        std::memset(output, 0, frames * channels * sizeof(float));
        return frames;
    }

    const int source_channels = source_channels_;
    const int capacity_frames = static_cast<int>(source_work_buffer_.size() / source_channels);
    // Keep a small SRC look-ahead. libsamplerate may consume fewer input
    // frames than it receives, so tail frames remain in this FIFO.
    const int desired_frames = std::min(capacity_frames,
                                        dsp_pipeline_.required_input_frames(frames));
    const int to_read = std::max(0, desired_frames - source_work_frames_);
    int read = 0;
    if (to_read > 0) {
        read = ring_buffer_->read(source_work_buffer_.data() +
                                  static_cast<size_t>(source_work_frames_) * source_channels,
                                  to_read);
        source_work_frames_ += read;
    }

    if (read < to_read) {
        glitch_count_.fetch_add(1, std::memory_order_relaxed);
    }

    // Check for end-of-stream: decoder stopped AND ring buffer is (nearly) empty
    // During device startup the backend can call us while state is Ready,
    // before decoder_thread_ has been created. That temporary empty queue is
    // not EOF (notably for synchronous ASIO start callbacks).
    const bool input_ended = state_ != EngineState::Ready && !decoder_running_ &&
                             ring_buffer_->frames_available() == 0;
    auto* eq_monitor =
        playback_state == EngineState::Playing && (eq_spectrum_request_.load(std::memory_order_acquire) & 1) &&
        analysis_enabled_.load(std::memory_order_acquire) ? eq_monitor_ring_buffer_.get() : nullptr;
    const auto result = dsp_pipeline_.process(source_work_buffer_.data(), source_work_frames_,
                                              source_channels, input_ended, output, frames, channels, eq_monitor);
    // This final PCM envelope never changes the user's volume setting. Continue
    // consuming source frames until the pause fade reaches silence, then leave
    // the remaining queued audio untouched for resume.
    const bool fade_enabled = pause_fade_enabled_.load(std::memory_order_acquire) &&
        pause_fade_ms_.load(std::memory_order_acquire) > 0;
    if (fade_enabled && playback_state != EngineState::Ready) {
        const float target = playback_state == EngineState::Paused ? 0.0f : 1.0f;
        const int rate = std::max(1, pcm_output_sample_rate_.load(std::memory_order_acquire));
        const int fade_frames = std::max(1, rate * pause_fade_ms_.load(std::memory_order_acquire) / 1000);
        const float step = 1.0f / static_cast<float>(fade_frames);
        for (int frame = 0; frame < frames; ++frame) {
            pause_fade_live_ = target < pause_fade_live_
                ? std::max(target, pause_fade_live_ - step)
                : std::min(target, pause_fade_live_ + step);
            for (int channel = 0; channel < channels; ++channel)
                output[static_cast<size_t>(frame) * channels + channel] *= pause_fade_live_;
        }
        if (target == 0.0f && pause_fade_live_ == 0.0f)
            pause_fade_pending_.store(false, std::memory_order_release);
    } else {
        pause_fade_live_ = 1.0f;
        if (playback_state == EngineState::Paused)
            pause_fade_pending_.store(false, std::memory_order_release);
    }
    played_frames_.fetch_add(result.input_frames_used, std::memory_order_relaxed);
    const int consumed = std::min(result.input_frames_used, source_work_frames_);
    const int remaining = source_work_frames_ - consumed;
    if (remaining > 0 && consumed > 0) {
        std::memmove(source_work_buffer_.data(),
                     source_work_buffer_.data() + static_cast<size_t>(consumed) * source_channels,
                     static_cast<size_t>(remaining) * source_channels * sizeof(float));
    }
    source_work_frames_ = remaining;

    // Wait until the SRC FIFO has been consumed as well; otherwise the last
    // resampler tail would be cut off when the decoder reaches EOF.
    if (playback_state != EngineState::Paused && input_ended && source_work_frames_ == 0 && result.stream_drained &&
        !track_ended_fired_.exchange(true, std::memory_order_acq_rel)) {
        mark_track_ended_pending();
    }

    if (analysis_ring_buffer_ && analysis_enabled_.load(std::memory_order_acquire) &&
        !playback_only_.load(std::memory_order_acquire)) {
        const int written = analysis_ring_buffer_->write(output, frames, 0);
        if (written < frames) analysis_dropped_frames_.fetch_add(frames - written, std::memory_order_relaxed);
    }
    analysis_output_frames_.fetch_add(frames, std::memory_order_relaxed);

    return frames;
}
