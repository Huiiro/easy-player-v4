# Use the same audio codec/container/filter allowlist as Windows. The Windows
# feature disables are recognized by FFmpeg on all platforms and remain off.
include("${CMAKE_CURRENT_LIST_DIR}/ffmpeg-profile.cmake")
string(APPEND OPTIONS
    " --disable-appkit --disable-avfoundation --disable-coreimage"
    " --disable-videotoolbox --disable-audiotoolbox"
    " --enable-securetransport")
