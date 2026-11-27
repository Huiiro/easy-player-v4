// Engine-level DSP settings that depend on track metadata or output configuration.
// The sample processing and effect implementations live in the DSP pipeline.

#include "audio_engine.h"
#include "logger.h"
#include <algorithm>
#include <array>
#include <cctype>
#include <cmath>
#include <filesystem>
#include <vector>

AudioChainStatus AudioEngine::audio_chain_status() const {
    std::lock_guard<std::mutex> lock(decoder_mutex_);
    const auto state = state_.load(std::memory_order_acquire);
    const bool output_open = backend_ && (state == EngineState::Playing || state == EngineState::Paused);
    const bool dop = output_open && dop_transport_active_.load(std::memory_order_acquire);
    auto status = dop ? AudioChainStatus{} : dsp_pipeline_.status();
    status.source_codec = track_info_.codec_name;
    status.source_label = track_info_.format;
    status.original_format = track_info_.is_dsd
        ? AudioFormat{track_info_.dsd_sample_rate, 1, track_info_.channels}
        : AudioFormat{
            track_info_.original_sample_rate > 0 ? track_info_.original_sample_rate : track_info_.sample_rate,
            track_info_.bit_depth,
            track_info_.original_channels > 0 ? track_info_.original_channels : track_info_.channels};
    status.dop_carrier_rate = track_info_.dsd_sample_rate / 16;
    if (output_open) {
        status.backend_format = backend_->current_format();
        status.output_device_id = backend_->opened_device_id();
        status.output_buffer_frames = backend_->buffer_size_frames();
        status.output_latency_ms = backend_->latency_ms();
        status.output_transport = dop ? "dop" : track_info_.is_dsd ? "pcm_conversion" : "pcm";
        if (!dop && track_info_.is_dsd) {
            status.decoded_pcm_format = {track_info_.sample_rate, 32, track_info_.channels, 32, true};
            status.dop_fallback_reason = dop_fallback_reason_;
        } else if (!dop && (status.original_format.sample_rate != track_info_.sample_rate ||
                            status.original_format.channels != track_info_.channels)) {
            status.decoded_pcm_format = {track_info_.sample_rate, 32, track_info_.channels, 32, true};
        }
    } else {
        if (status.backend_format.sample_rate > 0) {
            status.bit_perfect_blockers.emplace_back("Output backend is not active");
            status.is_bit_perfect_eligible = false;
            status.bit_perfect_verification_state = "blocked";
            status.is_bit_perfect = false;
        }
        status.backend_format = {};
    }

    if (!dop) {
        if (track_info_.is_dsd) {
            status.bit_perfect_blockers.push_back("DSD source was converted to PCM");
            status.is_bit_perfect_eligible = false;
            status.bit_perfect_verification_state = "blocked";
            status.is_bit_perfect = false;
        }
        if (status.output_transport == "pcm_conversion") {
            status.active_nodes.insert(status.active_nodes.begin(), "DSD to PCM conversion");
        } else if (!track_info_.is_dsd && track_info_.original_sample_rate > 0 &&
            (track_info_.original_sample_rate != track_info_.sample_rate ||
             track_info_.original_channels != track_info_.channels)) {
            status.active_nodes.emplace_back("Mix format conversion");
            status.bit_perfect_blockers.emplace_back("Sample-rate conversion is active");
            status.is_bit_perfect_eligible = false;
            status.bit_perfect_verification_state = "blocked";
            status.is_bit_perfect = false;
        }
        const auto transition = transition_config();
        if (crossfade_speed_supported() && transition.crossfade_enabled && transition.crossfade_ms > 0 && !track_info_.is_dsd) {
            // Crossfade mixes decoded tracks before the DSP pipeline.
            status.active_nodes.insert(status.active_nodes.begin(), "Crossfade");
            status.bit_perfect_blockers.push_back("Crossfade mixes consecutive tracks");
            status.is_bit_perfect_eligible = false;
            status.bit_perfect_verification_state = "blocked";
            status.is_bit_perfect = false;
        } else status.bypassed_nodes.insert(status.bypassed_nodes.begin(), "Crossfade");
        if (transition.pause_fade_enabled && transition.pause_fade_ms > 0) {
            status.active_nodes.emplace_back("Pause fade");
            status.bit_perfect_blockers.push_back("Pause and resume use a PCM gain envelope");
            status.is_bit_perfect_eligible = false;
            status.bit_perfect_verification_state = "blocked";
            status.is_bit_perfect = false;
        } else status.bypassed_nodes.emplace_back("Pause fade");
        return status;
    }
    status.source_format = status.original_format;
    status.active_nodes = {"DoP encoded transport"};
    status.bypassed_nodes = {"Master volume", "Pause fade"};
    status.bit_perfect_blockers = {"DoP is an encoded DSD transport, not PCM bit-perfect"};
    status.is_bit_perfect_eligible = false;
    status.bit_perfect_verification_state = "blocked";
    return status;
}

bool AudioEngine::set_impulse_response_config(const ImpulseResponseConfig& config) {
    impulse_response_error_.clear();
    const auto reject = [this](const char* reason) {
        impulse_response_error_ = reason;
        return false;
    };
    if (!std::isfinite(config.gain_db) || config.gain_db < -24.0f || config.gain_db > 12.0f) return reject("invalid_gain");
    if (config.enabled == impulse_response_config_.enabled &&
        config.path == impulse_response_config_.path) {
        if (!dsp_pipeline_.set_ir_gain(config.auto_gain, config.gain_db)) return reject("invalid_gain");
        impulse_response_config_ = config;
        return true;
    }
    if (!config.enabled) {
        dsp_pipeline_.set_impulse_response({}, 0, 0, false);
        dsp_pipeline_.set_ir_gain(config.auto_gain, config.gain_db);
        impulse_response_config_ = config;
        return true;
    }
    std::vector<float> samples;
    int sample_rate = 48000;
    int channels = 1;
    {
        if (config.path.empty()) return reject("path_required");
        const auto dot = config.path.find_last_of('.');
        std::string extension = dot == std::string::npos ? "" : config.path.substr(dot);
        std::transform(extension.begin(), extension.end(), extension.begin(),
                       [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        if (extension != ".wav") return reject("not_wav");
        try {
            std::error_code error;
            const bool exists = std::filesystem::exists(std::filesystem::u8path(config.path), error);
            if (error) return reject("file_unreadable");
            if (!exists) return reject("file_not_found");
        } catch (const std::exception&) {
            return reject("file_unreadable");
        }
        Decoder decoder;
        if (!decoder.open(config.path)) return reject("decode_open_failed");
        const auto& info = decoder.track_info();
        if (info.channels < 1 || info.channels > 2) return reject("unsupported_channels");
        if (info.sample_rate <= 0 || info.sample_rate > 192000) return reject("unsupported_sample_rate");
        constexpr size_t kMaxIrFrames = 131072;
        if (info.duration_ms > 0 && info.duration_ms * info.sample_rate / 1000.0 > kMaxIrFrames + 1) {
            return reject("too_many_frames");
        }
        sample_rate = info.sample_rate;
        channels = info.channels;
        std::vector<float> chunk(static_cast<size_t>(4096) * channels);
        const size_t max_samples = kMaxIrFrames * channels;
        while (samples.size() <= max_samples) {
            const int decoded = decoder.decode(chunk.data(), 4096);
            if (decoded < 0) return reject("decode_failed");
            if (decoded == 0) break;
            samples.insert(samples.end(), chunk.begin(), chunk.begin() + static_cast<size_t>(decoded) * channels);
        }
        if (samples.empty()) return reject("empty_ir");
        if (samples.size() > max_samples) return reject("too_many_frames");
        if (!std::all_of(samples.begin(), samples.end(), [](float sample) { return std::isfinite(sample); })) return reject("non_finite_ir");
    }
    if (!dsp_pipeline_.set_impulse_response(samples, sample_rate, channels, true)) return reject("output_rate_limit");
    dsp_pipeline_.set_ir_gain(config.auto_gain, config.gain_db);
    impulse_response_config_ = config;
    return true;
}

void AudioEngine::set_replay_gain_mode(int mode, bool prevent_clipping) {
    replay_gain_mode_ = std::max(0, std::min(2, mode));
    replay_gain_prevent_clipping_ = prevent_clipping;
    update_replay_gain_for_track();
}

void AudioEngine::update_replay_gain_for_track() {
    const bool use_track = replay_gain_mode_ == 1 && track_info_.metadata.has_replaygain_track;
    const bool use_album = replay_gain_mode_ == 2 && track_info_.metadata.has_replaygain_album;
    const float gain = use_track ? track_info_.metadata.replaygain_track_db : use_album ? track_info_.metadata.replaygain_album_db : 0.0f;
    const float peak = use_track ? track_info_.metadata.replaygain_track_peak : use_album ? track_info_.metadata.replaygain_album_peak : 0.0f;
    dsp_pipeline_.set_replay_gain_config({use_track || use_album, gain, peak, replay_gain_prevent_clipping_});
}

void AudioEngine::set_volume(float volume) {
    dsp_pipeline_.set_master_volume(volume);
}

bool AudioEngine::set_eq_bands(const std::array<EqBand, kEqBandCount>& bands) {
    const bool ok = dsp_pipeline_.set_eq_bands(bands);
    if (ok) {
        std::ostringstream message;
        message << "EQ configuration published: "
                << dsp_pipeline_.active_eq_band_count() << " active band(s)";
        for (const auto& band : bands) {
            if (band.enabled && std::abs(band.gain_db) >= 0.0001f) {
                message << " [" << band.frequency_hz << "Hz "
                        << (band.gain_db >= 0.0f ? "+" : "") << band.gain_db
                        << "dB Q=" << band.q << "]";
            }
        }
        LOG_DEBUG(message.str());
    }
    return ok;
}

bool AudioEngine::set_resampler_config(bool force_output_rate, int target_sample_rate, int quality) {
    if (target_sample_rate < 8000 || target_sample_rate > 384000 || quality < 0 || quality > 2) {
        LOG_WARN("Resampler config rejected: target_rate=" + std::to_string(target_sample_rate) +
                 ", quality=" + std::to_string(quality) + "; expected 8000..384000 Hz, quality 0..2");
        return false;
    }
    if (force_output_rate_ == force_output_rate && target_sample_rate_ == target_sample_rate &&
        resampler_quality_ == quality) return true;

    const bool needs_reopen = force_output_rate_ != force_output_rate ||
        (force_output_rate && target_sample_rate_ != target_sample_rate) ||
        (resampler_quality_ != quality && !dop_transport_active_.load(std::memory_order_acquire));
    force_output_rate_ = force_output_rate;
    target_sample_rate_ = target_sample_rate;
    resampler_quality_ = quality;
    LOG_DEBUG("Resampler configuration: " + std::string(force_output_rate ? "force " : "automatic ") +
             std::to_string(target_sample_rate) + "Hz, quality=" +
             (quality == 0 ? "best" : quality == 1 ? "medium" : "fast"));
    if (!needs_reopen) {
        dsp_pipeline_.set_resampler_quality(static_cast<DspPipeline::ResamplerQuality>(quality));
        return true;
    }

    // An opened backend owns its output clock. Recreate it before playback
    // resumes so a target-rate change never reaches the audio callback half-applied.
    const bool resume = state_ == EngineState::Playing;
    if (backend_) reopen_output(false);
    dsp_pipeline_.set_resampler_quality(static_cast<DspPipeline::ResamplerQuality>(quality));
    return !resume || play();
}
