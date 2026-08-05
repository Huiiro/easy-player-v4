cmake_minimum_required(VERSION 3.22.1)
project(easy_player_engine_android LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include("${CMAKE_CURRENT_LIST_DIR}/../engine-core/engine_core_sources.cmake")

# Dependencies may be supplied as shared-library prebuilts or static vcpkg
# libraries. Pass EASY_PLAYER_ANDROID_DEPS_ROOT per developer/CI environment.
set(EASY_PLAYER_ANDROID_DEPS_ROOT
    "${CMAKE_CURRENT_LIST_DIR}/deps/${ANDROID_ABI}" CACHE PATH
    "Root containing Android FFmpeg, libsamplerate and SoundTouch prebuilts")

set(EASY_PLAYER_ANDROID_REQUIRED_HEADERS
    "${EASY_PLAYER_ANDROID_DEPS_ROOT}/include/libavcodec/avcodec.h"
    "${EASY_PLAYER_ANDROID_DEPS_ROOT}/include/libavformat/avformat.h"
    "${EASY_PLAYER_ANDROID_DEPS_ROOT}/include/libavutil/avutil.h"
    "${EASY_PLAYER_ANDROID_DEPS_ROOT}/include/libswresample/swresample.h"
    "${EASY_PLAYER_ANDROID_DEPS_ROOT}/include/samplerate.h"
)

foreach(required_file IN LISTS EASY_PLAYER_ANDROID_REQUIRED_HEADERS)
    if(NOT EXISTS "${required_file}")
        message(FATAL_ERROR
            "Missing Android engine dependency for ABI '${ANDROID_ABI}': ${required_file}\n"
            "Provide FFmpeg, libsamplerate and SoundTouch under "
            "${EASY_PLAYER_ANDROID_DEPS_ROOT}; see engine-android/README.md.")
    endif()
endforeach()

if(EXISTS "${EASY_PLAYER_ANDROID_DEPS_ROOT}/include/SoundTouch.h")
    set(SOUNDTOUCH_INCLUDE_DIR "${EASY_PLAYER_ANDROID_DEPS_ROOT}/include")
elseif(EXISTS "${EASY_PLAYER_ANDROID_DEPS_ROOT}/include/soundtouch/SoundTouch.h")
    set(SOUNDTOUCH_INCLUDE_DIR "${EASY_PLAYER_ANDROID_DEPS_ROOT}/include/soundtouch")
else()
    message(FATAL_ERROR
        "Missing SoundTouch.h under ${EASY_PLAYER_ANDROID_DEPS_ROOT}/include "
        "(checked the root and soundtouch/ subdirectory).")
endif()

foreach(required_library avcodec avformat avutil swresample samplerate SoundTouch)
    if(NOT EXISTS "${EASY_PLAYER_ANDROID_DEPS_ROOT}/lib/lib${required_library}.so"
       AND NOT EXISTS "${EASY_PLAYER_ANDROID_DEPS_ROOT}/lib/lib${required_library}.a")
        message(FATAL_ERROR
            "Missing Android engine library for ABI '${ANDROID_ABI}': "
            "lib${required_library}.{so,a} in ${EASY_PLAYER_ANDROID_DEPS_ROOT}/lib\n"
            "Provide FFmpeg, libsamplerate and SoundTouch; see engine-android/README.md.")
    endif()
endforeach()

function(resolve_android_prebuilt output library_name)
    set(shared_library "${EASY_PLAYER_ANDROID_DEPS_ROOT}/lib/lib${library_name}.so")
    set(static_library "${EASY_PLAYER_ANDROID_DEPS_ROOT}/lib/lib${library_name}.a")
    if(EXISTS "${shared_library}")
        set(${output} "${shared_library}" PARENT_SCOPE)
    elseif(EXISTS "${static_library}")
        set(${output} "${static_library}" PARENT_SCOPE)
    else()
        message(FATAL_ERROR "Unable to resolve lib${library_name}.{so,a}.")
    endif()
endfunction()

resolve_android_prebuilt(AVCODEC_LIB avcodec)
resolve_android_prebuilt(AVFORMAT_LIB avformat)
resolve_android_prebuilt(AVUTIL_LIB avutil)
resolve_android_prebuilt(SWRESAMPLE_LIB swresample)
resolve_android_prebuilt(SAMPLERATE_LIB samplerate)
resolve_android_prebuilt(SOUNDTOUCH_LIB SoundTouch)
find_library(AAUDIO_LIB aaudio REQUIRED)
find_library(LOG_LIB log REQUIRED)
find_library(ANDROID_LIB android REQUIRED)
find_library(MEDIANDK_LIB mediandk REQUIRED)
find_library(M_LIB m REQUIRED)
find_library(Z_LIB z REQUIRED)
find_library(DL_LIB dl REQUIRED)

add_library(easy_player_engine_android SHARED
    ${EASY_PLAYER_ENGINE_CORE_SOURCES}
    src/android_aaudio_backend.cpp
    src/android_backend_factory.cpp
    src/android_jni.cpp
)

target_include_directories(easy_player_engine_android PRIVATE
    "${EASY_PLAYER_ENGINE_CORE_INCLUDE_DIR}"
    "${EASY_PLAYER_ANDROID_DEPS_ROOT}/include"
    "${SOUNDTOUCH_INCLUDE_DIR}"
)

target_link_libraries(easy_player_engine_android PRIVATE
    ${AVCODEC_LIB} ${AVFORMAT_LIB} ${AVUTIL_LIB} ${SWRESAMPLE_LIB}
    ${SAMPLERATE_LIB} ${SOUNDTOUCH_LIB}
    ${AAUDIO_LIB} ${LOG_LIB} ${ANDROID_LIB} ${MEDIANDK_LIB} ${M_LIB} ${Z_LIB} ${DL_LIB}
)

# Android 15 devices and recent emulators can run with 16 KB memory pages.
# Apply the alignment to the final JNI shared object, including statically
# linked decoder/DSP dependencies.
target_link_options(easy_player_engine_android PRIVATE
    "-Wl,-z,max-page-size=16384"
    "-Wl,-z,common-page-size=16384"
)
