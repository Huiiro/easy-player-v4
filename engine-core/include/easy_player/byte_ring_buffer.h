#pragma once

#include <atomic>
#include <cstdint>
#include <cstring>
#include <vector>

// Lock-free SPSC byte-frame queue for encoded transports (DoP/Native DSD).
// Producer and consumer exchange complete frames only; no PCM conversion is
// possible through this type.
class ByteRingBuffer {
public:
    ByteRingBuffer(int bytes_per_frame, int capacity_frames)
        : bytes_per_frame_(bytes_per_frame), capacity_(capacity_frames + 1),
          data_(static_cast<size_t>(capacity_) * bytes_per_frame_) {}

    int write(const uint8_t* source, int frames) {
        const int readable = readable_frames();
        const int count = frames < (capacity_ - 1 - readable) ? frames : (capacity_ - 1 - readable);
        uint64_t write = write_.load(std::memory_order_relaxed);
        for (int i = 0; i < count; ++i) {
            std::memcpy(&data_[static_cast<size_t>(write % capacity_) * bytes_per_frame_],
                        source + static_cast<size_t>(i) * bytes_per_frame_, bytes_per_frame_);
            ++write;
        }
        write_.store(write, std::memory_order_release);
        return count;
    }

    int read(uint8_t* destination, int frames) {
        const int count = frames < readable_frames() ? frames : readable_frames();
        uint64_t read = read_.load(std::memory_order_relaxed);
        for (int i = 0; i < count; ++i) {
            std::memcpy(destination + static_cast<size_t>(i) * bytes_per_frame_,
                        &data_[static_cast<size_t>(read % capacity_) * bytes_per_frame_], bytes_per_frame_);
            ++read;
        }
        read_.store(read, std::memory_order_release);
        return count;
    }

    int readable_frames() const {
        return static_cast<int>(write_.load(std::memory_order_acquire) - read_.load(std::memory_order_acquire));
    }
    int writable_frames() const { return capacity_ - 1 - readable_frames(); }
    void reset() { write_.store(0, std::memory_order_seq_cst); read_.store(0, std::memory_order_seq_cst); }

private:
    int bytes_per_frame_;
    int capacity_;
    std::vector<uint8_t> data_;
    std::atomic<uint64_t> write_{0};
    std::atomic<uint64_t> read_{0};
};
