// PCM decoding and sample-accurate seek using FFmpeg timestamps.
// Retains partially consumed frames and drains resampler output at end of stream.

#include "decoder_impl.h"
#include "ffmpeg_logging.h"
#include "logger.h"
#include <algorithm>
#include <cstring>

using decoder_detail::av_err_str;

namespace {

int64_t frame_start_sample(const AVFrame* frame, const AVStream* stream, int sample_rate, int64_t fallback) {
    int64_t ts = frame->best_effort_timestamp;
    if (ts == AV_NOPTS_VALUE) ts = frame->pts;
    if (ts == AV_NOPTS_VALUE || !stream || sample_rate <= 0) return fallback;

    AVRational sample_timebase = {1, sample_rate};
    return av_rescale_q(ts, stream->time_base, sample_timebase);
}

} // namespace

int Decoder::decode(float* output, int max_frames) {
    ScopedFFmpegLogContext log_context(track_info_.file_path, "decode", impl_->current_pts);
    if (impl_->fatal_error) return -1;
    if (!impl_->codec_ctx || !output || max_frames <= 0 || (impl_->eof && impl_->swr_flushed)) return 0;

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
                    const int flush_ret = avcodec_send_packet(impl_->codec_ctx, nullptr);
                    if (flush_ret < 0 && flush_ret != AVERROR_EOF) {
                        impl_->last_error = "avcodec_send_packet(flush) failed: " + av_err_str(flush_ret) + " (code=" + std::to_string(flush_ret) + ")";
                        LOG_ERROR(impl_->last_error + ", path=" + track_info_.file_path + ", sample=" + std::to_string(impl_->current_pts));
                        impl_->fatal_error = true;
                        return frames_decoded > 0 ? frames_decoded : -1;
                    }
                    impl_->eof = true;
                    break;
                }
                if (ret < 0) {
                    impl_->last_error = "av_read_frame failed: " + av_err_str(ret) + " (code=" + std::to_string(ret) + ")";
                    LOG_ERROR(impl_->last_error + ", path=" + track_info_.file_path + ", sample=" + std::to_string(impl_->current_pts));
                    impl_->fatal_error = true;
                    return frames_decoded > 0 ? frames_decoded : -1;
                }

                if (impl_->packet->stream_index == impl_->stream_index) {
                    ret = avcodec_send_packet(impl_->codec_ctx, impl_->packet);
                    av_packet_unref(impl_->packet);
                    if (ret >= 0) break;
                    if (ret == AVERROR_INVALIDDATA) {
                        if (impl_->consecutive_bad_frames++ < 32) {
                            const auto message = "Discarding malformed audio packet: code=" + std::to_string(ret) +
                                ", error=" + av_err_str(ret) + ", path=" + track_info_.file_path +
                                ", sample=" + std::to_string(impl_->current_pts) +
                                ", consecutive_bad_frames=" + std::to_string(impl_->consecutive_bad_frames);
                            if (impl_->consecutive_bad_frames == 1) LOG_WARN(message);
                            else LOG_DEBUG(message);
                            continue;
                        }
                    }
                    impl_->last_error = "avcodec_send_packet failed: " + av_err_str(ret) + " (code=" + std::to_string(ret) + ")";
                    LOG_ERROR(impl_->last_error + ", path=" + track_info_.file_path + ", sample=" + std::to_string(impl_->current_pts));
                    impl_->fatal_error = true;
                    return frames_decoded > 0 ? frames_decoded : -1;
                } else {
                    av_packet_unref(impl_->packet);
                }
            }
            continue;
        }

        if (ret == AVERROR_EOF) {
            // avcodec may retain delayed frames after the demuxer reaches
            // EOF.  Drain them first, then flush any remaining swresample
            // delay so the tail is not truncated.
            if (impl_->swr_ctx && !impl_->swr_flushed) {
                const int capacity = std::max(1, swr_get_out_samples(impl_->swr_ctx, 0));
                std::vector<float> tail(static_cast<size_t>(capacity) * channels);
                uint8_t* out_ptr = reinterpret_cast<uint8_t*>(tail.data());
                const int converted = swr_convert(impl_->swr_ctx, &out_ptr, capacity, nullptr, 0);
                if (converted > 0) {
                    const int to_copy = std::min(converted, max_frames - frames_decoded);
                    std::memcpy(output + static_cast<size_t>(frames_decoded) * channels, tail.data(),
                                static_cast<size_t>(to_copy) * channels * sizeof(float));
                    frames_decoded += to_copy;
                    impl_->current_pts += to_copy;
                    if (to_copy < converted) {
                        impl_->pending_pcm.assign(tail.data() + static_cast<size_t>(to_copy) * channels,
                                                  tail.data() + static_cast<size_t>(converted) * channels);
                        impl_->pending_pcm_offset_frames = 0;
                        impl_->pending_pcm_start_sample = impl_->current_pts;
                    }
                    return frames_decoded;
                }
                impl_->swr_flushed = true;
            }
            impl_->eof = true;
            break;
        }
        if (ret < 0) {
            // Some codecs (notably FLAC) can report one corrupt frame and
            // resume from a later packet.  Do not turn a single bad frame
            // into a false end-of-track notification.
            if (ret == AVERROR_INVALIDDATA && impl_->consecutive_bad_frames++ < 32) {
                const auto message = "Discarding malformed decoded frame: code=" + std::to_string(ret) +
                    ", error=" + av_err_str(ret) + ", path=" + track_info_.file_path +
                    ", sample=" + std::to_string(impl_->current_pts) +
                    ", consecutive_bad_frames=" + std::to_string(impl_->consecutive_bad_frames);
                if (impl_->consecutive_bad_frames == 1) LOG_WARN(message);
                else LOG_DEBUG(message);
                av_frame_unref(impl_->frame);
                continue;
            }
            impl_->last_error = "avcodec_receive_frame failed: " + av_err_str(ret) + " (code=" + std::to_string(ret) + ")";
            LOG_ERROR(impl_->last_error + ", path=" + track_info_.file_path + ", sample=" + std::to_string(impl_->current_pts) +
                      ", consecutive_bad_frames=" + std::to_string(impl_->consecutive_bad_frames));
            impl_->fatal_error = true;
            return frames_decoded > 0 ? frames_decoded : -1;
        }
        if (impl_->consecutive_bad_frames > 0) {
            LOG_DEBUG("Decoder recovered after malformed data: path=" + track_info_.file_path +
                      ", sample=" + std::to_string(impl_->current_pts) +
                      ", skipped_errors=" + std::to_string(impl_->consecutive_bad_frames));
        }
        impl_->consecutive_bad_frames = 0;

        AVStream* stream = impl_->fmt_ctx->streams[impl_->stream_index];
        const int64_t input_fallback = av_rescale_q(impl_->current_pts,
            AVRational{1, std::max(1, track_info_.sample_rate)},
            AVRational{1, std::max(1, impl_->input_sample_rate)});
        const int64_t input_frame_start = frame_start_sample(
            impl_->frame, stream, impl_->input_sample_rate, input_fallback);
        const int64_t resample_delay = impl_->swr_ctx
            ? swr_get_delay(impl_->swr_ctx, std::max(1, impl_->input_sample_rate)) : 0;
        const int64_t frame_start = av_rescale_q(input_frame_start - resample_delay,
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

bool Decoder::seek(int64_t sample_position) {
    ScopedFFmpegLogContext log_context(track_info_.file_path, "seek", sample_position);
    if (!impl_->fmt_ctx || !impl_->codec_ctx) return false;

    AVStream* stream = impl_->fmt_ctx->streams[impl_->stream_index];
    if (stream->time_base.num <= 0 || stream->time_base.den <= 0) {
        LOG_WARN("Decoder seek rejected: time_base=" + std::to_string(stream->time_base.num) + "/" +
                 std::to_string(stream->time_base.den) + ", sample=" + std::to_string(sample_position) +
                 ", path=" + track_info_.file_path);
        return false;
    }
    if (track_info_.sample_rate <= 0) {
        LOG_WARN("Decoder seek rejected: sample_rate=" + std::to_string(track_info_.sample_rate) +
                 ", sample=" + std::to_string(sample_position) + ", path=" + track_info_.file_path);
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
        LOG_WARN("av_seek_frame failed: code=" + std::to_string(ret) + ", error=" + av_err_str(ret) +
                 ", path=" + track_info_.file_path + ", sample=" + std::to_string(sample_position) +
                 ", target_pts=" + std::to_string(seek_target) + ", stream=" + std::to_string(impl_->stream_index));
        return false;
    }

    LOG_DEBUG("Decoder seek: path=" + track_info_.file_path + ", from_sample=" + std::to_string(impl_->current_pts) +
              ", to_sample=" + std::to_string(sample_position) + ", target_pts=" + std::to_string(seek_target));

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
    impl_->swr_flushed = false;
    impl_->last_error.clear();
    impl_->consecutive_bad_frames = 0;
    impl_->fatal_error = false;

    return true;
}
