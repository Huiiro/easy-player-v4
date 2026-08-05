#pragma once

#include <cstdint>

// DoP carries two DSD bytes in the low 16 bits of each 24-bit PCM sample;
// the high byte alternates 0x05/0xFA.  The byte order here is the little
// endian byte layout required by a WASAPI PCM24 buffer.
namespace dop {

inline uint8_t reverse_bits(uint8_t value) {
    value = static_cast<uint8_t>(((value & 0x55u) << 1) | ((value >> 1) & 0x55u));
    value = static_cast<uint8_t>(((value & 0x33u) << 2) | ((value >> 2) & 0x33u));
    return static_cast<uint8_t>((value << 4) | (value >> 4));
}

// payload contains two consecutive source bytes for each channel:
// [L0, L1, R0, R1, ...].  `source_lsb_first` is true for DSF-style source
// data and normalizes it to the bit order expected by DoP receivers.
inline void pack_frame(const uint8_t* payload, int channels,
                       bool source_lsb_first, uint8_t marker,
                       uint8_t* destination) {
    for (int channel = 0; channel < channels; ++channel) {
        uint8_t first = payload[channel * 2];
        uint8_t second = payload[channel * 2 + 1];
        if (source_lsb_first) {
            first = reverse_bits(first);
            second = reverse_bits(second);
        }
        destination[channel * 3] = first;
        destination[channel * 3 + 1] = second;
        destination[channel * 3 + 2] = marker;
    }
}

inline bool self_test() {
    const uint8_t payload[] = {0x01, 0x80, 0x12, 0x34};
    uint8_t packed[6] = {};
    pack_frame(payload, 2, true, 0x05, packed);
    return packed[0] == 0x80 && packed[1] == 0x01 && packed[2] == 0x05 &&
           packed[3] == 0x48 && packed[4] == 0x2C && packed[5] == 0x05;
}

} // namespace dop
