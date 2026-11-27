// Raw DSD packet reading, carrier-frame seeks and DoP packing.

#include "decoder_impl.h"
#include "dop_packer.h"
#include "ffmpeg_logging.h"
#include "logger.h"
#include <algorithm>
#include <cstddef>

using decoder_detail::av_err_str;

bool Decoder::begin_dop(int64_t carrier_frame) {
    ScopedFFmpegLogContext log_context(track_info_.file_path, "begin-dop", impl_->current_pts);
    if (!impl_->fmt_ctx || !impl_->codec_ctx || !impl_->source_is_dsd) return false;
    AVStream* stream = impl_->fmt_ctx->streams[impl_->stream_index];
    const int64_t target_byte = std::max<int64_t>(0, carrier_frame) * 2;
    const int64_t target_pts = av_rescale_q(target_byte,
        AVRational{1, std::max(1, impl_->input_sample_rate)}, stream->time_base);
    const int seek_result = av_seek_frame(impl_->fmt_ctx, impl_->stream_index, target_pts, AVSEEK_FLAG_BACKWARD);
    if (seek_result < 0) {
        LOG_WARN("DSD DoP rewind failed: code=" + std::to_string(seek_result) + ", error=" + av_err_str(seek_result) +
                 ", path=" + track_info_.file_path + ", stream=" + std::to_string(impl_->stream_index));
        return false;
    }
    avcodec_flush_buffers(impl_->codec_ctx);
    impl_->dop_bytes.clear();
    impl_->dop_byte_offset = 0;
    impl_->dop_seek_byte = target_byte;
    impl_->dop_marker = 0x05;
    impl_->dop_mode = true;
    impl_->eof = false;
    LOG_DEBUG("DSD DoP: raw packet reader prepared (" +
             std::string(impl_->dsd_planar ? "planar" : "interleaved") + ", " +
             std::string(impl_->dsd_lsb_first ? "LSB-first" : "MSB-first") + ")");
    return true;
}

int Decoder::read_dop(uint8_t* output, int max_frames) {
    ScopedFFmpegLogContext log_context(track_info_.file_path, "read-dop", impl_->current_pts);
    if (!output || max_frames <= 0 || !impl_->dop_mode || !impl_->source_is_dsd) return -1;
    const int channels = track_info_.channels;
    if (channels < 1 || channels > 8) return -1;
    AVStream* stream = impl_->fmt_ctx->streams[impl_->stream_index];
    int frames = 0;
    while (frames < max_frames) {
        const size_t consumed_bytes = impl_->dop_byte_offset * static_cast<size_t>(channels);
        const size_t bytes_available = consumed_bytes <= impl_->dop_bytes.size()
            ? (impl_->dop_bytes.size() - consumed_bytes) / static_cast<size_t>(channels) : 0;
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
        if (ret < 0) {
            LOG_ERROR("DSD DoP packet read failed: code=" + std::to_string(ret) + ", error=" + av_err_str(ret) +
                      ", path=" + track_info_.file_path + ", decoded_frames=" + std::to_string(frames));
            return frames > 0 ? frames : -1;
        }
        if (impl_->packet->stream_index != impl_->stream_index) { av_packet_unref(impl_->packet); continue; }
        const int bytes_per_channel = impl_->packet->size / channels;
        if (bytes_per_channel <= 0 || bytes_per_channel * channels != impl_->packet->size) {
            LOG_WARN("DSD DoP malformed packet: bytes=" + std::to_string(impl_->packet->size) +
                     ", channels=" + std::to_string(channels) + ", path=" + track_info_.file_path);
            av_packet_unref(impl_->packet);
            continue;
        }
        // av_seek_frame lands on a packet boundary. Discard the preceding DSD
        // bytes so rebuilding a DoP output resumes at the playback clock.
        int skip_bytes = 0;
        if (impl_->dop_seek_byte > 0 && impl_->packet->pts != AV_NOPTS_VALUE) {
            const int64_t packet_byte = av_rescale_q(impl_->packet->pts, stream->time_base,
                AVRational{1, std::max(1, impl_->input_sample_rate)});
            skip_bytes = static_cast<int>(std::clamp<int64_t>(
                impl_->dop_seek_byte - packet_byte, 0, bytes_per_channel));
            if (skip_bytes == bytes_per_channel) {
                av_packet_unref(impl_->packet);
                continue;
            }
            impl_->dop_seek_byte = 0;
        }
        const size_t old_size = impl_->dop_bytes.size();
        impl_->dop_bytes.resize(old_size + static_cast<size_t>(bytes_per_channel - skip_bytes) * channels);
        for (int byte_index = skip_bytes; byte_index < bytes_per_channel; ++byte_index) {
            for (int channel = 0; channel < channels; ++channel) {
                const size_t source = impl_->dsd_planar
                    ? static_cast<size_t>(channel) * bytes_per_channel + byte_index
                    : static_cast<size_t>(byte_index) * channels + channel;
                impl_->dop_bytes[old_size + static_cast<size_t>(byte_index - skip_bytes) * channels + channel] = impl_->packet->data[source];
            }
        }
        av_packet_unref(impl_->packet);
    }
    return frames;
}
