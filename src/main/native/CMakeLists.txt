cmake_minimum_required(VERSION 3.15)
project(easy_player_native LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# macOS uses the portable engine core plus the CoreAudio shared-output backend.
# Keep this branch self-contained so the existing Windows/vcpkg configuration
# remains unchanged below.
if(APPLE)
    enable_language(OBJCXX)

    if(CMAKE_OSX_ARCHITECTURES)
        set(EASY_PLAYER_MACOS_ARCH "${CMAKE_OSX_ARCHITECTURES}")
    elseif(CMAKE_HOST_SYSTEM_PROCESSOR STREQUAL "arm64")
        set(EASY_PLAYER_MACOS_ARCH arm64)
    else()
        set(EASY_PLAYER_MACOS_ARCH x86_64)
    endif()

    set(HOMEBREW_PREFIX "/opt/homebrew")
    if(EASY_PLAYER_MACOS_ARCH STREQUAL "x86_64")
        set(HOMEBREW_PREFIX "/usr/local")
    endif()
    set(EASY_PLAYER_MACOS_DEPS_PREFIX "${HOMEBREW_PREFIX}/opt" CACHE PATH
        "Homebrew opt directory containing FFmpeg, libsamplerate and SoundTouch")

    find_path(FFMPEG_INCLUDE_DIR libavcodec/avcodec.h
        PATHS "${EASY_PLAYER_MACOS_DEPS_PREFIX}/ffmpeg/include" NO_DEFAULT_PATH)
    find_library(AVCODEC_LIB avcodec PATHS "${EASY_PLAYER_MACOS_DEPS_PREFIX}/ffmpeg/lib" NO_DEFAULT_PATH)
    find_library(AVFORMAT_LIB avformat PATHS "${EASY_PLAYER_MACOS_DEPS_PREFIX}/ffmpeg/lib" NO_DEFAULT_PATH)
    find_library(AVUTIL_LIB avutil PATHS "${EASY_PLAYER_MACOS_DEPS_PREFIX}/ffmpeg/lib" NO_DEFAULT_PATH)
    find_library(SWRESAMPLE_LIB swresample PATHS "${EASY_PLAYER_MACOS_DEPS_PREFIX}/ffmpeg/lib" NO_DEFAULT_PATH)
    find_path(SAMPLERATE_INCLUDE_DIR samplerate.h
        PATHS "${EASY_PLAYER_MACOS_DEPS_PREFIX}/libsamplerate/include" NO_DEFAULT_PATH)
    find_library(SAMPLERATE_LIB samplerate
        PATHS "${EASY_PLAYER_MACOS_DEPS_PREFIX}/libsamplerate/lib" NO_DEFAULT_PATH)
    # engine-core includes <soundtouch/SoundTouch.h>, so retain the include
    # root rather than the nested soundtouch directory.
    find_path(SOUNDTOUCH_INCLUDE_DIR soundtouch/SoundTouch.h
        PATHS "${EASY_PLAYER_MACOS_DEPS_PREFIX}/sound-touch/include" NO_DEFAULT_PATH)
    find_library(SOUNDTOUCH_LIB SoundTouch
        PATHS "${EASY_PLAYER_MACOS_DEPS_PREFIX}/sound-touch/lib" NO_DEFAULT_PATH)

    if(NOT FFMPEG_INCLUDE_DIR OR NOT AVCODEC_LIB OR NOT AVFORMAT_LIB OR NOT AVUTIL_LIB OR
       NOT SWRESAMPLE_LIB OR NOT SAMPLERATE_INCLUDE_DIR OR NOT SAMPLERATE_LIB OR
       NOT SOUNDTOUCH_INCLUDE_DIR OR NOT SOUNDTOUCH_LIB)
        message(FATAL_ERROR
            "macOS engine dependencies are missing. Install them with:\n"
            "  brew install ffmpeg libsamplerate sound-touch\n"
            "or set EASY_PLAYER_MACOS_DEPS_PREFIX to the Homebrew opt directory.")
    endif()

    include("${CMAKE_CURRENT_LIST_DIR}/../../../engine-core/engine_core_sources.cmake")
    add_library(easy_player_engine_core STATIC ${EASY_PLAYER_ENGINE_CORE_SOURCES})
    target_include_directories(easy_player_engine_core PUBLIC
        "${FFMPEG_INCLUDE_DIR}" "${SAMPLERATE_INCLUDE_DIR}" "${SOUNDTOUCH_INCLUDE_DIR}"
        "${EASY_PLAYER_ENGINE_CORE_INCLUDE_DIR}")

    set(SOURCES
        "${CMAKE_CURRENT_LIST_DIR}/../../../engine-windows/src/addon.cpp"
        "${CMAKE_CURRENT_LIST_DIR}/../../../engine-macos/src/macos_audio_backend.mm"
        "${CMAKE_CURRENT_LIST_DIR}/../../../engine-macos/src/macos_backend_factory.cpp")
    if(DEFINED CMAKE_JS_SRC)
        list(APPEND SOURCES ${CMAKE_JS_SRC})
    endif()
    add_library(${PROJECT_NAME} SHARED ${SOURCES})
    get_filename_component(NODE_ADDON_API_DIR
        "${CMAKE_SOURCE_DIR}/../../../node_modules/node-addon-api" ABSOLUTE)
    target_compile_definitions(${PROJECT_NAME} PRIVATE EASY_PLAYER_MACOS=1)
    target_include_directories(${PROJECT_NAME} PRIVATE
        "${FFMPEG_INCLUDE_DIR}" "${SAMPLERATE_INCLUDE_DIR}" "${SOUNDTOUCH_INCLUDE_DIR}"
        "${EASY_PLAYER_ENGINE_CORE_INCLUDE_DIR}"
        "${CMAKE_CURRENT_LIST_DIR}/../../../engine-macos/src"
        ${CMAKE_JS_INC} "${NODE_ADDON_API_DIR}")
    target_link_libraries(${PROJECT_NAME} PRIVATE
        easy_player_engine_core ${CMAKE_JS_LIB}
        ${AVCODEC_LIB} ${AVFORMAT_LIB} ${AVUTIL_LIB} ${SWRESAMPLE_LIB}
        ${SAMPLERATE_LIB} ${SOUNDTOUCH_LIB}
        "-framework AudioToolbox" "-framework CoreAudio" "-framework Foundation")
    set_target_properties(${PROJECT_NAME} PROPERTIES PREFIX "" SUFFIX ".node")
    add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
        COMMAND ${CMAKE_COMMAND} -E copy_if_different
            "$<TARGET_FILE:${PROJECT_NAME}>" "${CMAKE_BINARY_DIR}/easy_player_native.node")
    return()
endif()

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

# ── Engine core ──
# This target must remain free of N-API and Windows output code. Platform
# packages (Windows today, Android later) link it and provide an
# AudioBackendFactory implementation.
include("${CMAKE_CURRENT_LIST_DIR}/../../../engine-core/engine_core_sources.cmake")

add_library(easy_player_engine_core STATIC ${EASY_PLAYER_ENGINE_CORE_SOURCES})
target_include_directories(easy_player_engine_core PUBLIC
    "${FFMPEG_ROOT}/include"
    "${SAMPLERATE_INCLUDE_DIR}"
    "${SOUNDTOUCH_INCLUDE_DIR}"
    "${EASY_PLAYER_ENGINE_CORE_INCLUDE_DIR}"
)

# ── Windows Electron adapter ──
set(SOURCES
    "${CMAKE_CURRENT_LIST_DIR}/../../../engine-windows/src/addon.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/../../../engine-windows/src/dsound_backend.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/../../../engine-windows/src/wasapi_backend.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/../../../engine-windows/src/asio_backend.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/../../../engine-windows/src/windows_backend_factory.cpp"
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
    "${EASY_PLAYER_ENGINE_CORE_INCLUDE_DIR}"
    "${CMAKE_CURRENT_LIST_DIR}/../../../engine-windows/src"
    ${CMAKE_JS_INC}
    "${NODE_ADDON_API_DIR}"
)

target_link_libraries(${PROJECT_NAME} PRIVATE
    easy_player_engine_core
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
