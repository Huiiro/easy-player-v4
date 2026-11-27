#pragma once

// FFmpeg resources and buffered transport state shared by the decoder implementations.

#include "decoder.h"
#include <vector>

#ifdef _WIN32
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#endif

extern "C" {
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/error.h>
#include <libswresample/swresample.h>
}

namespace decoder_detail {

// Convert FFmpeg error code to human-readable string
inline std::string av_err_str(int errnum) {
    char buf[256];
    av_strerror(errnum, buf, sizeof(buf));
    return std::string(buf);
}

} // namespace decoder_detail

struct Decoder::Impl {
    AVFormatContext* fmt_ctx = nullptr;
#ifdef _WIN32
    HANDLE file_handle = INVALID_HANDLE_VALUE;
    AVIOContext* file_io = nullptr;
#endif
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
    int64_t dop_seek_byte = 0;
    uint8_t dop_marker = 0x05;
    bool dop_mode = false;
    bool eof = false;
    bool swr_flushed = false;
    std::string last_error;
    int consecutive_bad_frames = 0;
    bool fatal_error = false;
};
