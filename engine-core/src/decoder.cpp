// FFmpeg input setup, stream selection, track metadata and resource lifetime.

#include "decoder_impl.h"
#include "dop_packer.h"
#include "ffmpeg_logging.h"
#include "logger.h"
#include <algorithm>
#include <cctype>
#include <cerrno>
#include <cmath>
#include <cstdlib>
#include <cstring>
#ifndef _WIN32
#include <fstream>
#endif

extern "C" {
#include <libavutil/opt.h>
}

using decoder_detail::av_err_str;

namespace {

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

// Let metadata replacement publish a new file while playback keeps reading the old handle.
int read_shared_file(void* opaque, uint8_t* buffer, int size) {
    DWORD received = 0;
    if (!ReadFile(static_cast<HANDLE>(opaque), buffer, static_cast<DWORD>(size), &received, nullptr))
        return GetLastError() == ERROR_HANDLE_EOF ? AVERROR_EOF : AVERROR(EIO);
    return received ? static_cast<int>(received) : AVERROR_EOF;
}
int64_t seek_shared_file(void* opaque, int64_t offset, int whence) {
    const auto handle = static_cast<HANDLE>(opaque);
    LARGE_INTEGER result;
    if (whence & AVSEEK_SIZE) return GetFileSizeEx(handle, &result) ? result.QuadPart : AVERROR(EIO);
    whence &= ~AVSEEK_FORCE;
    const DWORD method = whence == SEEK_SET ? FILE_BEGIN : whence == SEEK_CUR ? FILE_CURRENT : whence == SEEK_END ? FILE_END : MAXDWORD;
    if (method == MAXDWORD) return AVERROR(EINVAL);
    LARGE_INTEGER distance; distance.QuadPart = offset;
    return SetFilePointerEx(handle, distance, &result, method) ? result.QuadPart : AVERROR(EIO);
}

// Check if a file exists and is readable using wide-char path (Windows)
bool file_exists(const std::string& utf8_path) {
    std::wstring wpath = utf8_to_wide(utf8_path);
    DWORD attrs = GetFileAttributesW(wpath.c_str());
    return attrs != INVALID_FILE_ATTRIBUTES && !(attrs & FILE_ATTRIBUTE_DIRECTORY);
}
#else
// POSIX: standard ifstream check works with UTF-8
bool file_exists(const std::string& path) {
    std::ifstream test(path, std::ios::binary);
    return test.is_open();
}
#endif

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

void read_lyrics_metadata(const AVDictionary* dictionary, TrackInfo::Metadata& metadata) {
    if (!dictionary) return;
    std::string fallback;
    AVDictionaryEntry* tag = nullptr;
    while ((tag = av_dict_get(dictionary, "", tag, AV_DICT_IGNORE_SUFFIX))) {
        std::string key = tag->key;
        std::transform(key.begin(), key.end(), key.begin(), [](unsigned char c) {
            return static_cast<char>(std::tolower(c));
        });
        const std::string value = tag->value ? tag->value : "";
        if (value.empty()) continue;
        // Prefer timed variants whenever a container exposes both forms.
        if (key == "syncedlyrics" || key == "synced_lyrics" || key == "sylt") {
            metadata.lyrics = value;
            return;
        }
        if (fallback.empty() && (key == "lyrics" || key == "unsyncedlyrics" ||
            key == "unsynced_lyrics" || key == "uslt")) {
            fallback = value;
        }
    }
    if (metadata.lyrics.empty()) metadata.lyrics = fallback;
}

} // namespace

Decoder::Decoder() : impl_(std::make_unique<Impl>()) {
    initialize_ffmpeg_logging();
    impl_->frame = av_frame_alloc();
    impl_->packet = av_packet_alloc();
}

Decoder::~Decoder() {
    close();
    av_frame_free(&impl_->frame);
    av_packet_free(&impl_->packet);
}

bool Decoder::open(const std::string& file_path, int pcm_rate, int pcm_channels) {
    ScopedFFmpegLogContext log_context(file_path, "open/probe");
    close();

    // Verify file exists and is readable (uses wide-char API on Windows)
    if (!file_exists(file_path)) {
        LOG_ERROR("File not found or not readable: " + file_path);
        return false;
    }

    LOG_DEBUG("Opening file: " + file_path);
#ifdef _WIN32
    impl_->file_handle = CreateFileW(utf8_to_wide(file_path).c_str(), GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (impl_->file_handle == INVALID_HANDLE_VALUE) {
        LOG_ERROR("Unable to open decoder file: win32=" + std::to_string(GetLastError()) + ", path=" + file_path);
        return false;
    }
    auto* buffer = static_cast<unsigned char*>(av_malloc(32768));
    if (!buffer) { close(); return false; }
    impl_->file_io = avio_alloc_context(buffer, 32768, 0, impl_->file_handle, read_shared_file, nullptr, seek_shared_file);
    if (!impl_->file_io) { av_free(buffer); close(); return false; }
    impl_->fmt_ctx = avformat_alloc_context();
    if (!impl_->fmt_ctx) { close(); return false; }
    impl_->fmt_ctx->pb = impl_->file_io;
    impl_->fmt_ctx->flags |= AVFMT_FLAG_CUSTOM_IO;
#endif
    int ret = avformat_open_input(&impl_->fmt_ctx, file_path.c_str(), nullptr, nullptr);

    if (ret < 0) {
        LOG_ERROR("avformat_open_input failed: code=" + std::to_string(ret) + ", error=" + av_err_str(ret) + ", path=" + file_path);
        close();
        return false;
    }

    ret = avformat_find_stream_info(impl_->fmt_ctx, nullptr);
    if (ret < 0) {
        LOG_WARN("avformat_find_stream_info incomplete: code=" + std::to_string(ret) + ", error=" + av_err_str(ret) + ", path=" + file_path);
    }

    // Find best audio stream
    impl_->stream_index = av_find_best_stream(impl_->fmt_ctx, AVMEDIA_TYPE_AUDIO,
                                               -1, -1, nullptr, 0);
    if (impl_->stream_index < 0) {
        LOG_ERROR("No audio stream found: code=" + std::to_string(impl_->stream_index) +
                  ", error=" + av_err_str(impl_->stream_index) + ", path=" + file_path);
        close();
        return false;
    }

    AVStream* stream = impl_->fmt_ctx->streams[impl_->stream_index];
    const AVCodec* codec = avcodec_find_decoder(stream->codecpar->codec_id);
    if (!codec) {
        LOG_ERROR("No decoder found for codec: " +
                  std::string(avcodec_get_name(stream->codecpar->codec_id)) + ", path=" + file_path +
                  ", stream=" + std::to_string(impl_->stream_index));
        close();
        return false;
    }

    impl_->codec_ctx = avcodec_alloc_context3(codec);
    avcodec_parameters_to_context(impl_->codec_ctx, stream->codecpar);
    impl_->codec_ctx->pkt_timebase = stream->time_base;

    ret = avcodec_open2(impl_->codec_ctx, codec, nullptr);
    if (ret < 0) {
        LOG_ERROR("avcodec_open2 failed: code=" + std::to_string(ret) + ", error=" + av_err_str(ret) +
                  ", path=" + file_path + ", codec=" + codec->name +
                  ", sample_rate=" + std::to_string(impl_->codec_ctx->sample_rate) +
                  ", channels=" + std::to_string(impl_->codec_ctx->ch_layout.nb_channels));
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

    if (!source_is_dsd && pcm_rate >= 8000 && pcm_rate <= 384000)
        impl_->output_sample_rate = pcm_rate;
    const int output_channels = !source_is_dsd && pcm_channels >= 1 && pcm_channels <= 8
        ? pcm_channels : impl_->codec_ctx->ch_layout.nb_channels;
    const bool format_conversion = impl_->output_sample_rate != impl_->input_sample_rate ||
        output_channels != impl_->codec_ctx->ch_layout.nb_channels;
    // Setup resampler: native format to interleaved f32 in the session format.
    AVChannelLayout out_ch_layout;
    av_channel_layout_default(&out_ch_layout, output_channels);

    ret = swr_alloc_set_opts2(&impl_->swr_ctx,
                              &out_ch_layout, AV_SAMPLE_FMT_FLT, impl_->output_sample_rate,
                              &impl_->codec_ctx->ch_layout, impl_->codec_ctx->sample_fmt, impl_->codec_ctx->sample_rate,
                              0, nullptr);
    av_channel_layout_uninit(&out_ch_layout);
    if ((source_is_dsd || format_conversion) && impl_->swr_ctx) {
        // DSD decoder output is intentionally decimated before entering the
        // PCM/DSP path.  Keep this conversion deterministic and use a longer
        // low-pass filter than the swresample default; float output must not
        // be dithered at this stage.
        av_opt_set_int(impl_->swr_ctx, "filter_size", 64, 0);
        av_opt_set_int(impl_->swr_ctx, "phase_shift", 10, 0);
        av_opt_set_double(impl_->swr_ctx, "cutoff", 0.97, 0);
        av_opt_set_int(impl_->swr_ctx, "dither_method", SWR_DITHER_NONE, 0);
        LOG_DEBUG(std::string(source_is_dsd ? "DSD PCM conversion: " : "Auto Mix PCM conversion: ") +
                 std::to_string(impl_->input_sample_rate) + "Hz -> " +
                 std::to_string(impl_->output_sample_rate) + "Hz (64-tap, no dither)");
    }
    const int swr_init_result = ret >= 0 && impl_->swr_ctx ? swr_init(impl_->swr_ctx) : ret;
    if (ret < 0 || !impl_->swr_ctx || swr_init_result < 0) {
        LOG_ERROR("Swresample initialization failed: alloc_code=" + std::to_string(ret) +
                  ", init_code=" + std::to_string(swr_init_result) + ", path=" + file_path +
                  ", input_rate=" + std::to_string(impl_->input_sample_rate) +
                  ", output_rate=" + std::to_string(impl_->output_sample_rate) +
                  ", channels=" + std::to_string(impl_->codec_ctx->ch_layout.nb_channels) +
                  std::string(source_is_dsd || format_conversion ? "; required format conversion unavailable" : "; falling back to native format"));
        swr_free(&impl_->swr_ctx);
        if (source_is_dsd || format_conversion) {
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
    track_info_.channels = output_channels;
    track_info_.original_sample_rate = impl_->input_sample_rate;
    track_info_.original_channels = impl_->codec_ctx->ch_layout.nb_channels;
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
    impl_->last_error.clear();
    impl_->consecutive_bad_frames = 0;
    impl_->fatal_error = false;
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
    if (tag) {
        // Common tags are "1/12" or even non-numeric.  Metadata must never
        // take down the playback process.
        try { track_info_.metadata.track_number = std::stoi(tag->value); }
        catch (...) { LOG_WARN("Ignoring non-numeric track metadata: " + std::string(tag->value)); }
    }
    tag = av_dict_get(impl_->fmt_ctx->metadata, "genre", nullptr, 0);
    if (tag) track_info_.metadata.genre = tag->value;

    read_replaygain_metadata(impl_->fmt_ctx->metadata, track_info_.metadata);
    read_replaygain_metadata(stream->metadata, track_info_.metadata);
    read_lyrics_metadata(impl_->fmt_ctx->metadata, track_info_.metadata);
    if (track_info_.metadata.lyrics.empty()) read_lyrics_metadata(stream->metadata, track_info_.metadata);

    LOG_DEBUG("Decoder opened: " + file_path + " [" + track_info_.format + ", " +
             std::to_string(track_info_.sample_rate) + "Hz, " +
             std::to_string(track_info_.channels) + "ch, " +
             std::to_string(track_info_.duration_ms) + "ms]");
    if (track_info_.is_dsd) {
        LOG_DEBUG("DSD source recognized: " + track_info_.format + " at " +
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
#ifdef _WIN32
    if (impl_->file_io) {
        av_freep(&impl_->file_io->buffer);
        avio_context_free(&impl_->file_io);
    }
    if (impl_->file_handle != INVALID_HANDLE_VALUE) {
        CloseHandle(impl_->file_handle);
        impl_->file_handle = INVALID_HANDLE_VALUE;
    }
#endif
    impl_->stream_index = -1;
    impl_->eof = false;
    impl_->swr_flushed = false;
    impl_->last_error.clear();
    impl_->consecutive_bad_frames = 0;
    impl_->fatal_error = false;
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

int64_t Decoder::position() const {
    return impl_->current_pts;
}

const std::string& Decoder::last_error() const {
    return impl_->last_error;
}

int64_t Decoder::total_samples() const {
    return impl_->total_samples_;
}
