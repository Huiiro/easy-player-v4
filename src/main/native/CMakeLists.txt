cmake_minimum_required(VERSION 3.15)
project(easy_player_native LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Node.js & N-API ──
# cmake-js sets CMAKE_JS_SRC, CMAKE_JS_INC, CMAKE_JS_LIB automatically
# when invoked via cmake-js.

# ── FFmpeg ──
# Expected layout (vcpkg or manual):
#   FFMPEG_ROOT/
#     include/  (libavcodec/, libavformat/, libswresample/, libavutil/)
#     lib/      (avcodec.lib, avformat.lib, swresample.lib, avutil.lib)
#     bin/      (avcodec-*.dll, avformat-*.dll, ...)

if(NOT DEFINED FFMPEG_ROOT)
    # Default to BtbN extracted layout: deps/ffmpeg/ffmpeg-master-latest-win64-gpl-shared/
    file(GLOB FFMPEG_DIRS "${CMAKE_SOURCE_DIR}/deps/ffmpeg/ffmpeg-*")
    if(FFMPEG_DIRS)
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
    # Windows multimedia for DirectSound & WASAPI
    winmm
    dsound
    dxguid
    ole32
    uuid
)

# ── Install ──
# Copy FFmpeg DLLs alongside the .node binary
install(TARGETS ${PROJECT_NAME} DESTINATION lib)
install(DIRECTORY "${FFMPEG_ROOT}/bin/" DESTINATION bin
        FILES_MATCHING PATTERN "*.dll")
