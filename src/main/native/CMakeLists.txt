cmake_minimum_required(VERSION 3.15)
project(easy_player_native LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Node.js & N-API ──
# cmake-js sets CMAKE_JS_SRC, CMAKE_JS_INC, CMAKE_JS_LIB automatically
# when invoked via cmake-js.

# ── Dependency roots ──
# A local vcpkg checkout is optional. CI and other machines may provide
# VCPKG_ROOT or VCPKG_INSTALLED_DIR instead; never depend on one developer's
# absolute installation path.
if(NOT DEFINED VCPKG_INSTALLED_ROOT)
    if(DEFINED ENV{VCPKG_INSTALLED_DIR})
        set(VCPKG_INSTALLED_ROOT "$ENV{VCPKG_INSTALLED_DIR}/x64-windows")
    elseif(DEFINED ENV{VCPKG_ROOT})
        set(VCPKG_INSTALLED_ROOT "$ENV{VCPKG_ROOT}/installed/x64-windows")
    endif()
endif()

# ── FFmpeg ──
# Expected layout (vcpkg or manual):
#   FFMPEG_ROOT/
#     include/  (libavcodec/, libavformat/, libswresample/, libavutil/)
#     lib/      (avcodec.lib, avformat.lib, swresample.lib, avutil.lib)
#     bin/      (avcodec-*.dll, avformat-*.dll, ...)

if(NOT DEFINED FFMPEG_ROOT)
    # Default to BtbN extracted layout: deps/ffmpeg/ffmpeg-master-latest-win64-gpl-shared/
    file(GLOB FFMPEG_DIRS "${CMAKE_SOURCE_DIR}/deps/ffmpeg/ffmpeg-*")
    if(DEFINED VCPKG_INSTALLED_ROOT AND EXISTS "${VCPKG_INSTALLED_ROOT}/include/libavcodec")
        set(FFMPEG_DEFAULT "${VCPKG_INSTALLED_ROOT}")
    elseif(FFMPEG_DIRS)
        list(GET FFMPEG_DIRS 0 FFMPEG_DEFAULT)
    else()
        set(FFMPEG_DEFAULT "${CMAKE_SOURCE_DIR}/deps/ffmpeg")
    endif()
    set(FFMPEG_ROOT "${FFMPEG_DEFAULT}" CACHE PATH "FFmpeg install prefix")
endif()

find_library(AVCODEC_LIB    avcodec    PATHS "${FFMPEG_ROOT}/lib" NO_DEFAULT_PATH)
find_library(AVFORMAT_LIB   avformat   PATHS "${FFMPEG_ROOT}/lib" NO_DEFAULT_PATH)
find_library(AVUTIL_LIB     avutil     PATHS "${FFMPEG_ROOT}/lib" NO_DEFAULT_PATH)
find_library(SWRESAMPLE_LIB swresample PATHS "${FFMPEG_ROOT}/lib" NO_DEFAULT_PATH)

if(NOT AVCODEC_LIB OR NOT AVFORMAT_LIB OR NOT AVUTIL_LIB OR NOT SWRESAMPLE_LIB)
    message(FATAL_ERROR
        "FFmpeg libraries not found in ${FFMPEG_ROOT}/lib.\n"
        "Install FFmpeg development files or set FFMPEG_ROOT.\n"
        "  vcpkg install ffmpeg[core,avcodec,avformat,swresample]:x64-windows")
endif()

# ── libsamplerate ──
# Default to the local vcpkg installation; SAMPLERATE_ROOT may be overridden
# for CI or a manually installed package.
if(NOT DEFINED SAMPLERATE_ROOT)
    if(DEFINED VCPKG_INSTALLED_ROOT)
        set(SAMPLERATE_ROOT "${VCPKG_INSTALLED_ROOT}" CACHE PATH "libsamplerate install prefix")
    else()
        set(SAMPLERATE_ROOT "" CACHE PATH "libsamplerate install prefix")
    endif()
endif()
find_path(SAMPLERATE_INCLUDE_DIR samplerate.h
          PATHS "${SAMPLERATE_ROOT}/include" NO_DEFAULT_PATH)
find_library(SAMPLERATE_LIB samplerate
             PATHS "${SAMPLERATE_ROOT}/lib" NO_DEFAULT_PATH)
find_file(SAMPLERATE_DLL samplerate.dll
          PATHS "${SAMPLERATE_ROOT}/bin" NO_DEFAULT_PATH)

if(NOT SAMPLERATE_INCLUDE_DIR OR NOT SAMPLERATE_LIB OR NOT SAMPLERATE_DLL)
    message(FATAL_ERROR
        "libsamplerate not found under ${SAMPLERATE_ROOT}.\n"
        "Install libsamplerate:x64-windows or set SAMPLERATE_ROOT.")
endif()

if(NOT DEFINED SOUNDTOUCH_ROOT)
    if(DEFINED VCPKG_INSTALLED_ROOT)
        set(SOUNDTOUCH_ROOT "${VCPKG_INSTALLED_ROOT}" CACHE PATH "SoundTouch install prefix")
    else()
        set(SOUNDTOUCH_ROOT "" CACHE PATH "SoundTouch install prefix")
    endif()
endif()
find_path(SOUNDTOUCH_INCLUDE_DIR soundtouch/SoundTouch.h PATHS "${SOUNDTOUCH_ROOT}/include" NO_DEFAULT_PATH)
find_library(SOUNDTOUCH_LIB SoundTouch PATHS "${SOUNDTOUCH_ROOT}/lib" NO_DEFAULT_PATH)
find_file(SOUNDTOUCH_DLL SoundTouch.dll PATHS "${SOUNDTOUCH_ROOT}/bin" NO_DEFAULT_PATH)
if(NOT SOUNDTOUCH_INCLUDE_DIR OR NOT SOUNDTOUCH_LIB OR NOT SOUNDTOUCH_DLL)
    message(FATAL_ERROR "SoundTouch not found under ${SOUNDTOUCH_ROOT}. Install soundtouch:x64-windows or set SOUNDTOUCH_ROOT.")
endif()

# ── Sources ──
set(SOURCES
    src/addon.cpp
    src/audio_engine.cpp
    src/dsound_backend.cpp
    src/wasapi_backend.cpp
    src/asio_backend.cpp
    src/decoder.cpp
)

# Add cmake-js delay-load hook if available
if(DEFINED CMAKE_JS_SRC)
    list(APPEND SOURCES ${CMAKE_JS_SRC})
endif()

# ── Addon target ──
add_library(${PROJECT_NAME} SHARED ${SOURCES})

# Resolve node-addon-api to absolute path (CMAKE_SOURCE_DIR = src/main/native, go up 3 levels)
get_filename_component(NODE_ADDON_API_DIR
    "${CMAKE_SOURCE_DIR}/../../../node_modules/node-addon-api"
    ABSOLUTE)

target_include_directories(${PROJECT_NAME} PRIVATE
    "${FFMPEG_ROOT}/include"
    "${SAMPLERATE_INCLUDE_DIR}"
    "${SOUNDTOUCH_INCLUDE_DIR}"
    src/
    ${CMAKE_JS_INC}
    "${NODE_ADDON_API_DIR}"
)

target_link_libraries(${PROJECT_NAME} PRIVATE
    ${CMAKE_JS_LIB}
    ${AVCODEC_LIB}
    ${AVFORMAT_LIB}
    ${AVUTIL_LIB}
    ${SWRESAMPLE_LIB}
    ${SAMPLERATE_LIB}
    ${SOUNDTOUCH_LIB}
    # Windows multimedia for DirectSound & WASAPI
    winmm
    dsound
    dxguid
    ole32
    uuid
)

# Development loads the addon directly from build/native-addon. cmake-js
# normally invokes scripts/copy-native-assets.js, but a direct CMake build
# does not. Copy the module and libsamplerate runtime for both workflows.
add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "$<TARGET_FILE:${PROJECT_NAME}>" "${CMAKE_BINARY_DIR}/easy_player_native.node"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${SAMPLERATE_DLL}" "${CMAKE_BINARY_DIR}/samplerate.dll"
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        "${SOUNDTOUCH_DLL}" "${CMAKE_BINARY_DIR}/SoundTouch.dll"
)

# ── Install ──
# Copy FFmpeg DLLs alongside the .node binary
install(TARGETS ${PROJECT_NAME} DESTINATION lib)
install(DIRECTORY "${FFMPEG_ROOT}/bin/" DESTINATION bin
        FILES_MATCHING PATTERN "*.dll")
install(FILES "${SAMPLERATE_DLL}" DESTINATION bin)
install(FILES "${SOUNDTOUCH_DLL}" DESTINATION bin)
