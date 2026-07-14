#include "decoder.h"
#include "logger.h"

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

} // namespace

struct Decoder::Impl {
    AVFormatContext* fmt_ctx = nullptr;
    AVCodecContext* codec_ctx = nullptr;
    SwrContext* swr_ctx = nullptr;
    AVFrame* frame = nullptr;
    AVPacket* packet = nullptr;
    int stream_index = -1;
    int64_t current_pts = 0;
    int64_t total_samples_ = 0;
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

    // Setup resampler: native format → interleaved f32
    AVChannelLayout out_ch_layout;
    av_channel_layout_default(&out_ch_layout, impl_->codec_ctx->ch_layout.nb_channels);

    ret = swr_alloc_set_opts2(&impl_->swr_ctx,
                              &out_ch_layout, AV_SAMPLE_FMT_FLT, impl_->codec_ctx->sample_rate,
                              &impl_->codec_ctx->ch_layout, impl_->codec_ctx->sample_fmt, impl_->codec_ctx->sample_rate,
                              0, nullptr);
    if (ret < 0 || !impl_->swr_ctx || swr_init(impl_->swr_ctx) < 0) {
        LOG_ERROR("swr_init failed — falling back to native format");
        swr_free(&impl_->swr_ctx);
        impl_->swr_ctx = nullptr;
        // Will do native format passthrough
    }

    // Fill TrackInfo
    track_info_.file_path = file_path;
    track_info_.format = avcodec_get_name(stream->codecpar->codec_id);
    track_info_.sample_rate = impl_->codec_ctx->sample_rate;
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

    LOG_INFO("Decoder opened: " + file_path + " [" + track_info_.format + ", " +
             std::to_string(track_info_.sample_rate) + "Hz, " +
             std::to_string(track_info_.channels) + "ch, " +
             std::to_string(track_info_.duration_ms) + "ms]");

    return true;
}

void Decoder::close() {
    swr_free(&impl_->swr_ctx);
    avcodec_free_context(&impl_->codec_ctx);
    avformat_close_input(&impl_->fmt_ctx);
    impl_->stream_index = -1;
    impl_->eof = false;
    track_info_ = TrackInfo{};
}

int Decoder::decode(float* output, int max_frames) {
    if (!impl_->codec_ctx || impl_->eof) return 0;

    int frames_decoded = 0;
    int channels = track_info_.channels;

    while (frames_decoded < max_frames) {
        // Try to receive a decoded frame
        int ret = avcodec_receive_frame(impl_->codec_ctx, impl_->frame);

        if (ret == AVERROR(EAGAIN)) {
            // Need more data — send a packet
            while (true) {
                ret = av_read_frame(impl_->fmt_ctx, impl_->packet);
                if (ret == AVERROR_EOF) {
                    avcodec_send_packet(impl_->codec_ctx, nullptr); // flush
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
                    if (ret >= 0) break; // sent, now receive
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

        // Convert to interleaved f32
        int frame_samples = impl_->frame->nb_samples;
        int remaining = max_frames - frames_decoded;
        int to_copy = std::min(frame_samples, remaining);

        if (impl_->swr_ctx) {
            // Use libswresample for conversion
            uint8_t* out_ptr = reinterpret_cast<uint8_t*>(output + frames_decoded * channels);
            int converted = swr_convert(impl_->swr_ctx, &out_ptr, to_copy,
                                        (const uint8_t**)impl_->frame->data,
                                        impl_->frame->nb_samples);
            if (converted > 0) {
                frames_decoded += converted;
            }
        } else if (impl_->codec_ctx->sample_fmt == AV_SAMPLE_FMT_FLT) {
            // Direct copy (planar → interleaved)
            for (int ch = 0; ch < channels; ++ch) {
                float* src = reinterpret_cast<float*>(impl_->frame->data[ch]);
                float* dst = output + frames_decoded * channels;
                for (int i = 0; i < to_copy; ++i) {
                    dst[i * channels + ch] = src[i];
                }
            }
            frames_decoded += to_copy;
        } else {
            // FIXME: add more format conversions
            LOG_WARN("Unsupported sample format without swresample");
            break;
        }

        av_frame_unref(impl_->frame);
    }

    impl_->current_pts += frames_decoded;
    return frames_decoded;
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
    AVRational sample_timebase = {1, track_info_.sample_rate};
    int64_t seek_target = av_rescale_q(sample_position,
                                        sample_timebase,
                                        stream->time_base);

    int ret = av_seek_frame(impl_->fmt_ctx, impl_->stream_index,
                            seek_target, AVSEEK_FLAG_BACKWARD);
    if (ret < 0) {
        LOG_WARN("av_seek_frame failed");
        return false;
    }

    avcodec_flush_buffers(impl_->codec_ctx);
    impl_->current_pts = sample_position;
    impl_->eof = false;

    return true;
}

int64_t Decoder::position() const {
    return impl_->current_pts;
}

int64_t Decoder::total_samples() const {
    return impl_->total_samples_;
}
