#pragma once
#include <cstdint>
#include <memory>
#include <string>

struct TrackInfo {
    std::string file_path;
    std::string format;         // "WAV", "FLAC", "MP3", "DSD64", etc.
    int sample_rate = 0;
    int bit_depth = 0;
    int channels = 0;
    double duration_ms = 0.0;
    int bitrate_kbps = 0;
    std::string codec_name;
    bool is_dsd = false;
    int dsd_sample_rate = 0;       // Raw one-bit stream rate, e.g. 2822400 for DSD64.
    std::string dsd_transport;     // "pcm_conversion", "dop", or "native_dsd".

    struct Metadata {
        std::string title;
        std::string artist;
        std::string album;
        int track_number = 0;
        std::string genre;
        float replaygain_track_db = 0.0f;
        float replaygain_album_db = 0.0f;
        float replaygain_track_peak = 0.0f;
        float replaygain_album_peak = 0.0f;
        bool has_replaygain_track = false;
        bool has_replaygain_album = false;
    } metadata;
};

class Decoder {
public:
    Decoder();
    ~Decoder();

    // Open file and probe format. Returns false on failure.
    bool open(const std::string& file_path);

    // Close current file.
    void close();

    // Decode frames of interleaved f32 PCM at the source sample rate.
    // Returns actual frames decoded (0 = EOF, <0 = error).
    int decode(float* output, int max_frames);

    // Switch the demuxer to raw DSD packet reading for a future DoP path.
    // Each output frame is 24-bit PCM-shaped DoP data (3 * channels bytes).
    bool begin_dop();
    int read_dop(uint8_t* output, int max_frames);

    // Seek to a sample position.
    bool seek(int64_t sample_position);

    // Current position in samples.
    int64_t position() const;

    // Track info after successful open().
    const TrackInfo& track_info() const { return track_info_; }

    // Total samples in the file (duration * sample_rate * channels).
    int64_t total_samples() const;

    void swap(Decoder& other) noexcept {
        using std::swap;
        swap(impl_, other.impl_);
        swap(track_info_, other.track_info_);
    }

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    TrackInfo track_info_;
};
