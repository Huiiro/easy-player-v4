#include "../../engine-core/include/easy_player/dop_packer.h"
#include <array>
#include <algorithm>

int main() {
    const uint8_t msb_source[] = {0x80, 0x01, 0x4A, 0x2C};
    std::array<uint8_t, 6> packed{};
    dop::pack_frame(msb_source, 2, false, 0x05, packed.data());
    // The earliest DSD bit occupies bit 15 of each DoP sample.
    if (packed != std::array<uint8_t, 6>{0x01, 0x80, 0x05, 0x2C, 0x4A, 0x05}) return 1;

    const uint8_t lsb_source[] = {0x01, 0x80};
    dop::pack_frame(lsb_source, 1, true, 0xFA, packed.data());
    if (!std::equal(packed.begin(), packed.begin() + 3,
                    std::array<uint8_t, 3>{0x01, 0x80, 0xFA}.begin())) return 2;
    if (!dop::self_test()) return 3;
    return 0;
}
