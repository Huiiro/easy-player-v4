#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstring>
#include <mutex>
#include <vector>

// Lock-free Single-Producer Single-Consumer ring buffer for interleaved float PCM.
// Producer (DecoderThread) may block via CV wait when full.
// Consumer (AudioThread) never blocks — underflow returns silence.
class RingBuffer {
public:
    RingBuffer(int channels, int capacity_frames)
        : channels_(channels)
        , capacity_(capacity_frames)
        , buffer_(channels * capacity_frames, 0.0f)
        , write_pos_(0)
        , read_pos_(0)
    {}

    // Producer: write interleaved samples. Blocks until space is available or timeout.
    // Returns actual frames written.
    int write(const float* data, int frames, int timeout_ms = -1) {
        int total_samples = frames * channels_;
        int written = 0;

        while (written < total_samples) {
            int avail = write_available();
            if (avail == 0) {
                if (timeout_ms == 0) return written / channels_;
                std::unique_lock<std::mutex> lock(mutex_);
                if (timeout_ms < 0) {
                    cv_.wait(lock, [this] { return write_available() > 0; });
                } else {
                    cv_.wait_for(lock, std::chrono::milliseconds(timeout_ms),
                                 [this] { return write_available() > 0; });
                }
                continue;
            }

            int to_write = std::min(avail, total_samples - written);
            int pos = write_pos_.load(std::memory_order_relaxed) % buffer_.size();

            int first = std::min(to_write, (int)buffer_.size() - pos);
            std::memcpy(buffer_.data() + pos, data + written, first * sizeof(float));
            if (to_write > first) {
                std::memcpy(buffer_.data(), data + written + first,
                            (to_write - first) * sizeof(float));
            }

            write_pos_.fetch_add(to_write, std::memory_order_release);
            written += to_write;
        }
        return frames;
    }

    // Consumer: read interleaved samples. Never blocks.
    // Fills `data` with available samples; underflow region is zero-filled.
    // Returns actual frames read (may be less than `frames` on underflow).
    int read(float* data, int frames) {
        int total_samples = frames * channels_;
        int avail = read_available();
        int to_read = std::min(avail, total_samples);
        int underflow = total_samples - to_read;

        if (to_read > 0) {
            int pos = read_pos_.load(std::memory_order_relaxed) % buffer_.size();
            int first = std::min(to_read, (int)buffer_.size() - pos);
            std::memcpy(data, buffer_.data() + pos, first * sizeof(float));
            if (to_read > first) {
                std::memcpy(data + first, buffer_.data(),
                            (to_read - first) * sizeof(float));
            }
            read_pos_.fetch_add(to_read, std::memory_order_release);
        }

        if (underflow > 0) {
            std::memset(data + to_read, 0, underflow * sizeof(float));
        }

        cv_.notify_one(); // wake producer
        return (to_read + underflow) / channels_;
    }

    // Discard all buffered data (called on seek).
    void reset() {
        write_pos_.store(0, std::memory_order_release);
        read_pos_.store(0, std::memory_order_release);
        cv_.notify_one();
    }

    // Consumer: how many frames available to read.
    int frames_available() const {
        return read_available() / channels_;
    }

    // Producer: how much space is free (in samples).
    int write_available() const {
        int used = write_pos_.load(std::memory_order_acquire) -
                   read_pos_.load(std::memory_order_acquire);
        return (int)buffer_.size() - used;
    }

private:
    int read_available() const {
        int avail = write_pos_.load(std::memory_order_acquire) -
                    read_pos_.load(std::memory_order_acquire);
        return std::max(0, avail);
    }

    int channels_;
    int capacity_;
    std::vector<float> buffer_;

    std::atomic<int> write_pos_;
    std::atomic<int> read_pos_;

    std::mutex mutex_;
    std::condition_variable cv_;
};
