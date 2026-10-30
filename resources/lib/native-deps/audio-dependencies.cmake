# One Windows dependency root for CMake, JavaScript packaging, and CI.
get_filename_component(AUDIO_DEPS_CONFIG "${CMAKE_CURRENT_LIST_DIR}" ABSOLUTE)
get_filename_component(AUDIO_DEPS_ROOT "${AUDIO_DEPS_CONFIG}/../../../build/native-deps/installed/x64-windows-audio" ABSOLUTE)
file(SHA256 "${AUDIO_DEPS_CONFIG}/ffmpeg-profile.cmake" PROFILE_SHA)
file(SHA256 "${AUDIO_DEPS_CONFIG}/vcpkg.json" MANIFEST_SHA)
file(SHA256 "${AUDIO_DEPS_CONFIG}/triplets/x64-windows-audio.cmake" TRIPLET_SHA)
file(SHA256 "${AUDIO_DEPS_CONFIG}/sources.json" SOURCES_SHA)
string(SHA256 EXPECTED_PROFILE_SHA "${PROFILE_SHA}\n${MANIFEST_SHA}\n${TRIPLET_SHA}\n${SOURCES_SHA}")
set(PROFILE_STAMP "${AUDIO_DEPS_ROOT}/share/ffmpeg/easy-player-profile.sha256")
if(NOT EXISTS "${PROFILE_STAMP}")
    message(FATAL_ERROR "Run npm run prepare:native to build the pinned audio dependencies")
endif()
file(READ "${PROFILE_STAMP}" INSTALLED_PROFILE_SHA)
string(STRIP "${INSTALLED_PROFILE_SHA}" INSTALLED_PROFILE_SHA)
if(NOT INSTALLED_PROFILE_SHA STREQUAL EXPECTED_PROFILE_SHA)
    message(FATAL_ERROR "Audio dependency profile changed. Run npm run prepare:native")
endif()
set(FFMPEG_ROOT "${AUDIO_DEPS_ROOT}" CACHE PATH "Pinned audio-only FFmpeg" FORCE)
set(SAMPLERATE_ROOT "${AUDIO_DEPS_ROOT}" CACHE PATH "Pinned libsamplerate" FORCE)
set(SOUNDTOUCH_ROOT "${AUDIO_DEPS_ROOT}" CACHE PATH "Pinned SoundTouch" FORCE)
# Rebind old build directories which previously linked another SDK.
foreach(VAR AVCODEC_LIB AVFORMAT_LIB AVUTIL_LIB SWRESAMPLE_LIB
        SAMPLERATE_INCLUDE_DIR SAMPLERATE_LIB SAMPLERATE_LIBRARY SAMPLERATE_DLL
        SOUNDTOUCH_INCLUDE_DIR SOUNDTOUCH_LIB SOUNDTOUCH_LIBRARY SOUNDTOUCH_DLL
        FFMPEG_TEST_INCLUDE FFMPEG_TEST_avcodec FFMPEG_TEST_avformat FFMPEG_TEST_avutil FFMPEG_TEST_swresample)
    unset(${VAR} CACHE)
endforeach()
list(PREPEND CMAKE_PREFIX_PATH "${AUDIO_DEPS_ROOT}")
