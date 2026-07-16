#include "decoder.h"
#include "dop_packer.h"
#include "logger.h"
#include <algorithm>
#include <cctype>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <vector>

#ifdef _WIN32
#define NOMINMAX
#include <windows.h>
#endif

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libswresample/swresample.h>
#include <libavutil/error.h>
#include <libavutil/opt.h>
}

namespace {

// Convert FFmpeg error code to human-readable string
std::string av_err_str(int errnum) {
    char buf[256];
    av_strerror(errnum, buf, sizeof(buf));
    return std::string(buf);
}

#ifdef _WIN32
// Convert UTF-8 string to wide string (UTF-16) for Windows file APIs
std::wstring utf8_to_wide(const std::string& utf8) {
    if (utf8.empty()) return L"";
    int len = MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, nullptr, 0);
    if (len <= 0) return L"";
    std::wstring result(len, L'\0');
    MultiByteToWideChar(CP_UTF8, 0, utf8.c_str(), -1, &result[0], len);
    result.resize(len - 1); // remove null terminator
    return result;
}

// Check if a file exists and is readable using wide-char path (Windows)
bool file_exists(const std::string& utf8_path) {
    std::wstring wpath = utf8_to_wide(utf8_path);
    DWORD attrs = GetFileAttributesW(wpath.c_str());
    return attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY);
}
#else
// POSIX: standard ifstream check works with UTF-8
#include <fstream>
bool file_exists(const std::string& path) {
    std::ifstream test(path, std::ios::binary);
    return test.is_open();
}
#endif

int64_t frame_start_sample(const AVFrame* frame, const AVStream* stream, int sample_rate, int64_t fallback) {
    int64_t ts = frame->best_effort_timestamp;
    if (ts == AV_NOPTS_VALUE) ts = frame->pts;
    if (ts == AV_NOPTS_VALUE || !stream || sample_rate <= 0) return fallback;

    AVRational sample_timebase = {1, sample_rate};
    return av_rescale_q(ts, stream->time_base, sample_timebase);
}

bool is_dsd_codec(const AVCodecParameters* parameters) {
    const char* name = parameters ? avcodec_get_name(parameters->codec_id) : nullptr;
    return name && std::strncmp(name, "dsd", 3) == 0;
}

std::string dsd_format_label(int sample_rate) {
    if (sample_rate <= 0) return "DSD";
    const int multiple = static_cast<int>(std::lround(static_cast<double>(sample_rate) / 2822400.0));
    return multiple > 0 ? "DSD" + std::to_string(64 * multiple) : "DSD";
}

int dsd_pcm_output_rate(int decoder_rate) {
    // FFmpeg's DSD decoder exposes one converted PCM sample per DSD byte.
    // Decimate that intermediate stream before it reaches the real-time
    // pipeline, preserving the 44.1 kHz family and filtering shaped noise.
    return decoder_rate >= 705600 ? 176400 : 88200;
}

void read_replaygain_metadata(const AVDictionary* dictionary, TrackInfo::Metadata& metadata) {
    AVDictionaryEntry* tag = nullptr;
    while ((tag = av_dict_get(dictionary, "", tag, AV_DICT_IGNORE_SUFFIX))) {
        std::string key = tag->key;
        std::transform(key.begin(), key.end(), key.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        const float value = std::strtof(tag->value, nullptr);
        if (key == "replaygain_track_gain") { metadata.replaygain_track_db = value; metadata.has_replaygain_track = true; }
        else if (key == "replaygain_album_gain") { metadata.replaygain_album_db = value; metadata.has_replaygain_album = true; }
        else if (key == "replaygain_track_peak") metadata.replaygain_track_peak = value;
        else if (key == "replaygain_album_peak") metadata.replaygain_album_peak = value;
    }
}

} // namespace

struct Decoder::Impl {
    AVFormatContext* fmt_ctx = nullptr;
    AVCodecContext* codec_ctx = nullptr;
    SwrContext* swr_ctx = nullptr;
    AVFrame* frame = nullptr;
    AVPacket* packet = nullptr;
    int stream_index = -1;
    int64_t current_pts = 0;
    int64_t pending_seek_sample = -1;
    std::vector<float> pending_pcm;
    int pending_pcm_offset_frames = 0;
    int64_t pending_pcm_start_sample = 0;
    int64_t total_samples_ = 0;
    int input_sample_rate = 0;
    int output_sample_rate = 0;
    bool source_is_dsd = false;
    bool dsd_lsb_first = false;
    bool dsd_planar = false;
    std::vector<uint8_t> dop_bytes;
    size_t dop_byte_offset = 0;
    uint8_t dop_marker = 0x05;
    bool dop_mode = false;
    bool eof = false;
};

Decoder::Decoder() : impl_(std::make_unique<Impl>()) {
    impl_->frame = av_frame_alloc();
    impl_->packet = av_packet_alloc();
}

Decoder::~Decoder() {
    close();
    av_frame_free(&impl_->frame);
    av_packet_free(&impl_->packet);
}

bool Decoder::open(const std::string& file_path) {
    close();

    // Verify file exists and is readable (uses wide-char API on Windows)
    if (!file_exists(file_path)) {
        LOG_ERROR("File not found or not readable: " + file_path);
        return false;
    }

    LOG_INFO("Opening file: " + file_path);
    int ret = avformat_open_input(&impl_->fmt_ctx, file_path.c_str(), nullptr, nullptr);

#ifdef _WIN32
    // If UTF-8 path fails, try the system's ANSI code page (e.g., GBK for Chinese Windows)
    if (ret < 0) {
        int wlen = MultiByteToWideChar(CP_UTF8, 0, file_path.c_str(), -1, nullptr, 0);
        if (wlen > 0) {
            std::wstring wpath(wlen, L'\0');
            MultiByteToWideChar(CP_UTF8, 0, file_path.c_str(), -1, &wpath[0], wlen);
            // Convert wide to system ANSI code page
            int alen = WideCharToMultiByte(CP_ACP, 0, wpath.c_str(), -1, nullptr, 0, nullptr, nullptr);
            if (alen > 0) {
                std::string ansi_path(alen, '\0');
                WideCharToMultiByte(CP_ACP, 0, wpath.c_str(), -1, &ansi_path[0], alen, nullptr, nullptr);
                // Remove null terminator
                if (!ansi_path.empty() && ansi_path.back() == '\0') ansi_path.pop_back();
                LOG_INFO("Retrying with ANSI path: " + ansi_path);
                ret = avformat_open_input(&impl_->fmt_ctx, ansi_path.c_str(), nullptr, nullptr);
            }
        }
    }
#endif

    if (ret < 0) {
        LOG_ERROR("avformat_open_input failed [" + av_err_str(ret) + "]: " + file_path);
        return false;
    }

    ret = avformat_find_stream_info(impl_->fmt_ctx, nullptr);
    if (ret < 0) {
        LOG_WARN("avformat_find_stream_info incomplete");
    }

    // Find best audio stream
    impl_->stream_index = av_find_best_stream(impl_->fmt_ctx, AVMEDIA_TYPE_AUDIO,
                                               -1, -1, nullptr, 0);
    if (impl_->stream_index < 0) {
        LOG_ERROR("No audio stream found in: " + file_path);
        close();
        return false;
    }

    AVStream* stream = impl_->fmt_ctx->streams[impl_->stream_index];
    const AVCodec* codec = avcodec_find_decoder(stream->codecpar->codec_id);
    if (!codec) {
        LOG_ERROR("No decoder found for codec: " +
                  std::string(avcodec_get_name(stream->codecpar->codec_id)));
        close();
        return false;
    }

    impl_->codec_ctx = avcodec_alloc_context3(codec);
    avcodec_parameters_to_context(impl_->codec_ctx, stream->codecpar);
    impl_->codec_ctx->pkt_timebase = stream->time_base;

    ret = avcodec_open2(impl_->codec_ctx, codec, nullptr);
    if (ret < 0) {
        LOG_ERROR("avcodec_open2 failed [" + av_err_str(ret) + "]");
        close();
        return false;
    }

    const bool source_is_dsd = is_dsd_codec(stream->codecpar);
    if (source_is_dsd && !dop::self_test()) {
        LOG_ERROR("DSD DoP packer self-test failed");
        close();
        return false;
    }
    impl_->input_sample_rate = impl_->codec_ctx->sample_rate;
    impl_->source_is_dsd = source_is_dsd;
    impl_->dsd_lsb_first = stream->codecpar->codec_id == AV_CODEC_ID_DSD_LSBF ||
                           stream->codecpar->codec_id == AV_CODEC_ID_DSD_LSBF_PLANAR;
    impl_->dsd_planar = stream->codecpar->codec_id == AV_CODEC_ID_DSD_LSBF_PLANAR ||
                        stream->codecpar->codec_id == AV_CODEC_ID_DSD_MSBF_PLANAR;
    impl_->output_sample_rate = source_is_dsd
        ? dsd_pcm_output_rate(impl_->input_sample_rate)
        : impl_->input_sample_rate;

    // Setup resampler: native format to interleaved f32
    AVChannelLayout out_ch_layout;
    av_channel_layout_default(&out_ch_layout, impl_->codec_ctx->ch_layout.nb_channels);

    ret = swr_alloc_set_opts2(&impl_->swr_ctx,
                              &out_ch_layout, AV_SAMPLE_FMT_FLT, impl_->output_sample_rate,
                              &impl_->codec_ctx->ch_layout, impl_->codec_ctx->sample_fmt, impl_->codec_ctx->sample_rate,
                              0, nullptr);
    if (source_is_dsd && impl_->swr_ctx) {
        // DSD decoder output is intentionally decimated before entering the
        // PCM/DSP path.  Keep this conversion deterministic and use a longer
        // low-pass filter than the swresample default; float output must not
        // be dithered at this stage.
        av_opt_set_int(impl_->swr_ctx, "filter_size", 64, 0);
        av_opt_set_int(impl_->swr_ctx, "phase_shift", 10, 0);
        av_opt_set_double(impl_->swr_ctx, "cutoff", 0.97, 0);
        av_opt_set_int(impl_->swr_ctx, "dither_method", SWR_DITHER_NONE, 0);
        LOG_INFO("DSD PCM conversion: high-quality decimation " +
                 std::to_string(impl_->input_sample_rate) + "Hz -> " +
                 std::to_string(impl_->output_sample_rate) + "Hz (64-tap, no dither)");
    }
    if (ret < 0 || !impl_->swr_ctx || swr_init(impl_->swr_ctx) < 0) {
        LOG_ERROR("swr_init failed" + std::string(source_is_dsd ? " for required DSD PCM decimation" : " - falling back to native format"));
        swr_free(&impl_->swr_ctx);
        if (source_is_dsd) {
            close();
            return false;
        }
        impl_->swr_ctx = nullptr;
        // Will do native format passthrough
    }

    // Fill TrackInfo
    track_info_.file_path = file_path;
    track_info_.is_dsd = source_is_dsd;
    // FFmpeg's DSD decoder emits one PCM sample per input byte (see
    // dsddec.c), so input_sample_rate is the byte-rate and the original
    // one-bit stream clock is eight times that value.
    track_info_.dsd_sample_rate = track_info_.is_dsd ? impl_->input_sample_rate * 8 : 0;
    track_info_.dsd_transport = track_info_.is_dsd ? "pcm_conversion" : "";
    track_info_.format = track_info_.is_dsd ? dsd_format_label(track_info_.dsd_sample_rate) : avcodec_get_name(stream->codecpar->codec_id);
    track_info_.sample_rate = impl_->output_sample_rate;
    track_info_.bit_depth = impl_->codec_ctx->bits_per_raw_sample ?
                            impl_->codec_ctx->bits_per_raw_sample : 16;
    track_info_.channels = impl_->codec_ctx->ch_layout.nb_channels;
    track_info_.codec_name = codec->long_name ? codec->long_name : codec->name;

    if (stream->duration != AV_NOPTS_VALUE) {
        track_info_.duration_ms = stream->duration *
                                  av_q2d(stream->time_base) * 1000.0;
    } else if (impl_->fmt_ctx->duration != AV_NOPTS_VALUE) {
        track_info_.duration_ms = impl_->fmt_ctx->duration / 1000.0;
    }

    if (impl_->codec_ctx->bit_rate > 0) {
        track_info_.bitrate_kbps = (int)(impl_->codec_ctx->bit_rate / 1000);
    }

    impl_->total_samples_ = (int64_t)(track_info_.duration_ms / 1000.0 *
                                      track_info_.sample_rate);
    impl_->eof = false;
    impl_->current_pts = 0;
    impl_->pending_seek_sample = -1;
    impl_->pending_pcm.clear();
    impl_->pending_pcm_offset_frames = 0;
    impl_->pending_pcm_start_sample = 0;

    // Read metadata
    AVDictionaryEntry* tag = nullptr;
    tag = av_dict_get(impl_->fmt_ctx->metadata, "title", nullptr, 0);
    if (tag) track_info_.metadata.title = tag->value;
    tag = av_dict_get(impl_->fmt_ctx->metadata, "artist", nullptr, 0);
    if (tag) track_info_.metadata.artist = tag->value;
    tag = av_dict_get(impl_->fmt_ctx->metadata, "album", nullptr, 0);
    if (tag) track_info_.metadata.album = tag->value;
    tag = av_dict_get(impl_->fmt_ctx->metadata, "track", nullptr, 0);
    if (tag) track_info_.metadata.track_number = std::stoi(tag->value);
    tag = av_dict_get(impl_->fmt_ctx->metadata, "genre", nullptr, 0);
    if (tag) track_info_.metadata.genre = tag->value;

    read_replaygain_metadata(impl_->fmt_ctx->metadata, track_info_.metadata);
    read_replaygain_metadata(stream->metadata, track_info_.metadata);

    LOG_INFO("Decoder opened: " + file_path + " [" + track_info_.format + ", " +
             std::to_string(track_info_.sample_rate) + "Hz, " +
             std::to_string(track_info_.channels) + "ch, " +
             std::to_string(track_info_.duration_ms) + "ms]");
    if (track_info_.is_dsd) {
        LOG_INFO("DSD source recognized: " + track_info_.format + " at " +
                 std::to_string(track_info_.dsd_sample_rate) +
                 "Hz; decoder PCM=" + std::to_string(track_info_.sample_rate) +
                 "Hz; default transport=PCM conversion (Native DSD unavailable; DoP requires explicit compatibility opt-in)");
    }

    return true;
}

void Decoder::close() {
    swr_free(&impl_->swr_ctx);
    avcodec_free_context(&impl_->codec_ctx);
    avformat_close_input(&impl_->fmt_ctx);
    impl_->stream_index = -1;
    impl_->eof = false;
    impl_->pending_seek_sample = -1;
    impl_->pending_pcm.clear();
    impl_->pending_pcm_offset_frames = 0;
    impl_->pending_pcm_start_sample = 0;
    impl_->source_is_dsd = false;
    impl_->dop_mode = false;
    impl_->dop_bytes.clear();
    impl_->dop_byte_offset = 0;
    track_info_ = TrackInfo{};
}

bool Decoder::begin_dop() {
    if (!impl_->fmt_ctx || !impl_->codec_ctx || !impl_->source_is_dsd) return false;
    if (av_seek_frame(impl_->fmt_ctx, impl_->stream_index, 0, AVSEEK_FLAG_BACKWARD) < 0) {
        LOG_WARN("DSD DoP: failed to rewind demuxer");
        return false;
    }
    avcodec_flush_buffers(impl_->codec_ctx);
    impl_->dop_bytes.clear();
    impl_->dop_byte_offset = 0;
    impl_->dop_marker = 0x05;
    impl_->dop_mode = true;
    impl_->eof = false;
    LOG_INFO("DSD DoP: raw packet reader prepared (" +
             std::string(impl_->dsd_planar ? "planar" : "interleaved") + ", " +
             std::string(impl_->dsd_lsb_first ? "LSB-first" : "MSB-first") + ")");
    return true;
}

int Decoder::read_dop(uint8_t* output, int max_frames) {
    if (!output || max_frames <= 0 || !impl_->dop_mode || !impl_->source_is_dsd) return -1;
    const int channels = track_info_.channels;
    if (channels < 1 || channels > 8) return -1;
    int frames = 0;
    while (frames < max_frames) {
        const size_t bytes_available = (impl_->dop_bytes.size() - impl_->dop_byte_offset) /
                                       static_cast<size_t>(channels);
        if (bytes_available >= 2) {
            uint8_t payload[16] = {};
            for (int channel = 0; channel < channels; ++channel) {
                payload[channel * 2] = impl_->dop_bytes[impl_->dop_byte_offset * channels + channel];
                payload[channel * 2 + 1] = impl_->dop_bytes[(impl_->dop_byte_offset + 1) * channels + channel];
            }
            dop::pack_frame(payload, channels, impl_->dsd_lsb_first, impl_->dop_marker,
                            output + static_cast<size_t>(frames) * channels * 3);
            impl_->dop_marker = impl_->dop_marker == 0x05 ? 0xFA : 0x05;
            impl_->dop_byte_offset += 2;
            ++frames;
            continue;
        }
        if (impl_->dop_byte_offset > 0) {
            impl_->dop_bytes.erase(impl_->dop_bytes.begin(),
                impl_->dop_bytes.begin() + static_cast<std::ptrdiff_t>(impl_->dop_byte_offset * channels));
            impl_->dop_byte_offset = 0;
        }
        const int ret = av_read_frame(impl_->fmt_ctx, impl_->packet);
        if (ret == AVERROR_EOF) { impl_->eof = true; break; }
        if (ret < 0) return frames > 0 ? frames : -1;
        if (impl_->packet->stream_index != impl_->stream_index) { av_packet_unref(impl_->packet); continue; }
        const int bytes_per_channel = impl_->packet->size / channels;
        if (bytes_per_channel <= 0 || bytes_per_channel * channels != impl_->packet->size) {
            LOG_WARN("DSD DoP: malformed raw packet");
            av_packet_unref(impl_->packet);
            continue;
        }
        const size_t old_size = impl_->dop_bytes.size();
        impl_->dop_bytes.resize(old_size + static_cast<size_t>(impl_->packet->size));
        for (int byte_index = 0; byte_index < bytes_per_channel; ++byte_index) {
            for (int channel = 0; channel < channels; ++channel) {
                const size_t source = impl_->dsd_planar
                    ? static_cast<size_t>(channel) * bytes_per_channel + byte_index
                    : static_cast<size_t>(byte_index) * channels + channel;
                impl_->dop_bytes[old_size + static_cast<size_t>(byte_index) * channels + channel] = impl_->packet->data[source];
            }
        }
        av_packet_unref(impl_->packet);
    }
    return frames;
}

int Decoder::decode(float* output, int max_frames) {
    if (!impl_->codec_ctx || impl_->eof) return 0;

    int frames_decoded = 0;
    int channels = track_info_.channels;

    while (frames_decoded < max_frames) {
        if (!impl_->pending_pcm.empty()) {
            int pending_frames = (int)impl_->pending_pcm.size() / channels;
            int available = pending_frames - impl_->pending_pcm_offset_frames;
            int to_copy = std::min(available, max_frames - frames_decoded);

            std::memcpy(output + frames_decoded * channels,
                        impl_->pending_pcm.data() + impl_->pending_pcm_offset_frames * channels,
                        to_copy * channels * sizeof(float));

            frames_decoded += to_copy;
            impl_->pending_pcm_offset_frames += to_copy;
            impl_->current_pts = impl_->pending_pcm_start_sample + impl_->pending_pcm_offset_frames;

            if (impl_->pending_pcm_offset_frames >= pending_frames) {
                impl_->pending_pcm.clear();
                impl_->pending_pcm_offset_frames = 0;
                impl_->pending_pcm_start_sample = 0;
            }

            continue;
        }

        int ret = avcodec_receive_frame(impl_->codec_ctx, impl_->frame);

        if (ret == AVERROR(EAGAIN)) {
            while (true) {
                ret = av_read_frame(impl_->fmt_ctx, impl_->packet);
                if (ret == AVERROR_EOF) {
                    avcodec_send_packet(impl_->codec_ctx, nullptr);
                    impl_->eof = true;
                    break;
                }
                if (ret < 0) {
                    LOG_WARN("av_read_frame error");
                    return frames_decoded > 0 ? frames_decoded : -1;
                }

                if (impl_->packet->stream_index == impl_->stream_index) {
                    ret = avcodec_send_packet(impl_->codec_ctx, impl_->packet);
                    av_packet_unref(impl_->packet);
                    if (ret >= 0) break;
                } else {
                    av_packet_unref(impl_->packet);
                }
            }
            if (impl_->eof && ret == AVERROR_EOF) break;
            continue;
        }

        if (ret < 0) {
            LOG_ERROR("avcodec_receive_frame error: " + std::to_string(ret));
            return frames_decoded > 0 ? frames_decoded : -1;
        }

        AVStream* stream = impl_->fmt_ctx->streams[impl_->stream_index];
        const int64_t input_fallback = av_rescale_q(impl_->current_pts,
            AVRational{1, std::max(1, track_info_.sample_rate)},
            AVRational{1, std::max(1, impl_->input_sample_rate)});
        const int64_t input_frame_start = frame_start_sample(
            impl_->frame, stream, impl_->input_sample_rate, input_fallback);
        const int64_t frame_start = av_rescale_q(input_frame_start,
            AVRational{1, std::max(1, impl_->input_sample_rate)},
            AVRational{1, std::max(1, track_info_.sample_rate)});

        int frame_samples = impl_->frame->nb_samples;
        int remaining = max_frames - frames_decoded;
        const int output_capacity = impl_->swr_ctx
            ? std::max(frame_samples, swr_get_out_samples(impl_->swr_ctx, frame_samples))
            : frame_samples;
        std::vector<float> frame_output(static_cast<size_t>(output_capacity) * channels);
        int converted = 0;

        if (impl_->swr_ctx) {
            uint8_t* out_ptr = reinterpret_cast<uint8_t*>(frame_output.data());
            converted = swr_convert(impl_->swr_ctx, &out_ptr, output_capacity,
                                    (const uint8_t**)impl_->frame->data,
                                    impl_->frame->nb_samples);
        } else if (impl_->codec_ctx->sample_fmt == AV_SAMPLE_FMT_FLT) {
            for (int ch = 0; ch < channels; ++ch) {
                float* src = reinterpret_cast<float*>(impl_->frame->data[ch]);
                float* dst = frame_output.data();
                for (int i = 0; i < frame_samples; ++i) {
                    dst[i * channels + ch] = src[i];
                }
            }
            converted = frame_samples;
        } else {
            LOG_WARN("Unsupported sample format without swresample");
            break;
        }

        if (converted > 0) {
            int skip = 0;
            if (impl_->pending_seek_sample >= 0) {
                int64_t frame_end = frame_start + converted;
                if (frame_end <= impl_->pending_seek_sample) {
                    impl_->current_pts = frame_end;
                    av_frame_unref(impl_->frame);
                    continue;
                }

                if (frame_start < impl_->pending_seek_sample) {
                    skip = (int)std::min<int64_t>(
                        converted, impl_->pending_seek_sample - frame_start);
                }
                impl_->pending_seek_sample = -1;
            }

            int available = converted - skip;
            int to_copy = std::min(available, remaining);
            if (to_copy > 0) {
                std::memcpy(output + frames_decoded * channels,
                            frame_output.data() + skip * channels,
                            to_copy * channels * sizeof(float));
                frames_decoded += to_copy;
                impl_->current_pts = frame_start + skip + to_copy;
            }

            if (to_copy < available) {
                int leftover = available - to_copy;
                const float* leftover_start = frame_output.data() + (skip + to_copy) * channels;
                impl_->pending_pcm.assign(leftover_start, leftover_start + leftover * channels);
                impl_->pending_pcm_offset_frames = 0;
                impl_->pending_pcm_start_sample = frame_start + skip + to_copy;
            }
        }

        av_frame_unref(impl_->frame);
    }

    return frames_decoded;
}

void read_replaygain_metadata(const AVDictionary* dictionary, TrackInfo::Metadata& metadata) {
    AVDictionaryEntry* tag = nullptr;
    while ((tag = av_dict_get(dictionary, "", tag, AV_DICT_IGNORE_SUFFIX))) {
        std::string key = tag->key;
        std::transform(key.begin(), key.end(), key.begin(), [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
        const float value = std::strtof(tag->value, nullptr);
        if (key == "replaygain_track_gain") { metadata.replaygain_track_db = value; metadata.has_replaygain_track = true; }
        else if (key == "replaygain_album_gain") { metadata.replaygain_album_db = value; metadata.has_replaygain_album = true; }
        else if (key == "replaygain_track_peak") metadata.replaygain_track_peak = value;
        else if (key == "replaygain_album_peak") metadata.replaygain_album_peak = value;
    }
}

bool Decoder::seek(int64_t sample_position) {
    if (!impl_->fmt_ctx || !impl_->codec_ctx) return false;

    AVStream* stream = impl_->fmt_ctx->streams[impl_->stream_index];
    if (stream->time_base.num <= 0 || stream->time_base.den <= 0) {
        LOG_WARN("Invalid stream time_base, seek skipped");
        return false;
    }
    if (track_info_.sample_rate <= 0) {
        LOG_WARN("Invalid sample rate, seek skipped");
        return false;
    }
    const int64_t input_position = av_rescale_q(sample_position,
                                        AVRational{1, track_info_.sample_rate},
                                        AVRational{1, std::max(1, impl_->input_sample_rate)});
    AVRational sample_timebase = {1, std::max(1, impl_->input_sample_rate)};
    int64_t seek_target = av_rescale_q(input_position,
                                        sample_timebase,
                                        stream->time_base);

    int ret = av_seek_frame(impl_->fmt_ctx, impl_->stream_index,
                            seek_target, AVSEEK_FLAG_BACKWARD);
    if (ret < 0) {
        LOG_WARN("av_seek_frame failed");
        return false;
    }

    avcodec_flush_buffers(impl_->codec_ctx);
    if (impl_->swr_ctx) {
        swr_close(impl_->swr_ctx);
        swr_init(impl_->swr_ctx);
    }
    impl_->current_pts = sample_position;
    impl_->pending_seek_sample = sample_position;
    impl_->pending_pcm.clear();
    impl_->pending_pcm_offset_frames = 0;
    impl_->pending_pcm_start_sample = 0;
    impl_->dop_mode = false;
    impl_->dop_bytes.clear();
    impl_->dop_byte_offset = 0;
    impl_->dop_marker = 0x05;
    impl_->eof = false;

    return true;
}

int64_t Decoder::position() const {
    return impl_->current_pts;
}

int64_t Decoder::total_samples() const {
    return impl_->total_samples_;
}
