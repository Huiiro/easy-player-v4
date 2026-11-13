cmake_minimum_required(VERSION 3.15)
project(easy_player_native LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# macOS uses the portable engine core plus the CoreAudio shared-output backend.
if(APPLE)
    enable_language(OBJCXX)
    include("${CMAKE_CURRENT_LIST_DIR}/native-deps/macos-dependencies.cmake")

    find_path(FFMPEG_INCLUDE_DIR libavcodec/avcodec.h
        PATHS "${AUDIO_DEPS_ROOT}/include" NO_DEFAULT_PATH)
    find_library(AVCODEC_LIB avcodec PATHS "${AUDIO_DEPS_ROOT}/lib" NO_DEFAULT_PATH)
    find_library(AVFORMAT_LIB avformat PATHS "${AUDIO_DEPS_ROOT}/lib" NO_DEFAULT_PATH)
    find_library(AVUTIL_LIB avutil PATHS "${AUDIO_DEPS_ROOT}/lib" NO_DEFAULT_PATH)
    find_library(SWRESAMPLE_LIB swresample PATHS "${AUDIO_DEPS_ROOT}/lib" NO_DEFAULT_PATH)
    find_path(SAMPLERATE_INCLUDE_DIR samplerate.h
        PATHS "${AUDIO_DEPS_ROOT}/include" NO_DEFAULT_PATH)
    find_library(SAMPLERATE_LIB samplerate
        PATHS "${AUDIO_DEPS_ROOT}/lib" NO_DEFAULT_PATH)
    # engine-core includes <soundtouch/SoundTouch.h>, so retain the include
    # root rather than the nested soundtouch directory.
    find_path(SOUNDTOUCH_INCLUDE_DIR soundtouch/SoundTouch.h
        PATHS "${AUDIO_DEPS_ROOT}/include" NO_DEFAULT_PATH)
    find_library(SOUNDTOUCH_LIB SoundTouch
        PATHS "${AUDIO_DEPS_ROOT}/lib" NO_DEFAULT_PATH)

    if(NOT FFMPEG_INCLUDE_DIR OR NOT AVCODEC_LIB OR NOT AVFORMAT_LIB OR NOT AVUTIL_LIB OR
       NOT SWRESAMPLE_LIB OR NOT SAMPLERATE_INCLUDE_DIR OR NOT SAMPLERATE_LIB OR
       NOT SOUNDTOUCH_INCLUDE_DIR OR NOT SOUNDTOUCH_LIB)
        message(FATAL_ERROR
              "macOS engine dependencies are missing. Run npm run prepare:native.")
    endif()

    include("${CMAKE_CURRENT_LIST_DIR}/../../engine-core/engine_core_sources.cmake")
    add_library(easy_player_engine_core STATIC ${EASY_PLAYER_ENGINE_CORE_SOURCES})
    target_include_directories(easy_player_engine_core PUBLIC
        "${FFMPEG_INCLUDE_DIR}" "${SAMPLERATE_INCLUDE_DIR}" "${SOUNDTOUCH_INCLUDE_DIR}"
        "${EASY_PLAYER_ENGINE_CORE_INCLUDE_DIR}")

    set(SOURCES
        "${CMAKE_CURRENT_LIST_DIR}/../../engine-windows/src/addon.cpp"
        "${CMAKE_CURRENT_LIST_DIR}/../../engine-macos/src/macos_audio_backend.mm"
        "${CMAKE_CURRENT_LIST_DIR}/../../engine-macos/src/macos_backend_factory.cpp")
    if(DEFINED CMAKE_JS_SRC)
        list(APPEND SOURCES ${CMAKE_JS_SRC})
    endif()
    add_library(${PROJECT_NAME} SHARED ${SOURCES})
    get_filename_component(NODE_ADDON_API_DIR
        "${CMAKE_SOURCE_DIR}/../../node_modules/node-addon-api" ABSOLUTE)
    target_compile_definitions(${PROJECT_NAME} PRIVATE EASY_PLAYER_MACOS=1)
    target_include_directories(${PROJECT_NAME} PRIVATE
        "${FFMPEG_INCLUDE_DIR}" "${SAMPLERATE_INCLUDE_DIR}" "${SOUNDTOUCH_INCLUDE_DIR}"
        "${EASY_PLAYER_ENGINE_CORE_INCLUDE_DIR}"
        "${CMAKE_CURRENT_LIST_DIR}/../../engine-macos/src"
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
include("${CMAKE_CURRENT_LIST_DIR}/native-deps/audio-dependencies.cmake")

# ── FFmpeg ──
# Expected layout (vcpkg or manual):
#   FFMPEG_ROOT/
#     include/  (libavcodec/, libavformat/, libswresample/, libavutil/)
#     lib/      (avcodec.lib, avformat.lib, swresample.lib, avutil.lib)
#     bin/      (avcodec-*.dll, avformat-*.dll, ...)

find_library(AVCODEC_LIB    avcodec    PATHS "${FFMPEG_ROOT}/lib" NO_DEFAULT_PATH)
find_library(AVFORMAT_LIB   avformat   PATHS "${FFMPEG_ROOT}/lib" NO_DEFAULT_PATH)
find_library(AVUTIL_LIB     avutil     PATHS "${FFMPEG_ROOT}/lib" NO_DEFAULT_PATH)
find_library(SWRESAMPLE_LIB swresample PATHS "${FFMPEG_ROOT}/lib" NO_DEFAULT_PATH)

if(NOT AVCODEC_LIB OR NOT AVFORMAT_LIB OR NOT AVUTIL_LIB OR NOT SWRESAMPLE_LIB)
    message(FATAL_ERROR
        "FFmpeg libraries not found in ${FFMPEG_ROOT}/lib.\n"
        "Run npm run prepare:native.")
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
include("${CMAKE_CURRENT_LIST_DIR}/../../engine-core/engine_core_sources.cmake")

add_library(easy_player_engine_core STATIC ${EASY_PLAYER_ENGINE_CORE_SOURCES})
target_include_directories(easy_player_engine_core PUBLIC
    "${FFMPEG_ROOT}/include"
    "${SAMPLERATE_INCLUDE_DIR}"
    "${SOUNDTOUCH_INCLUDE_DIR}"
    "${EASY_PLAYER_ENGINE_CORE_INCLUDE_DIR}"
)

# ── Windows Electron adapter ──
set(SOURCES
    "${CMAKE_CURRENT_LIST_DIR}/../../engine-windows/src/addon.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/../../engine-windows/src/dsound_backend.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/../../engine-windows/src/wasapi_backend.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/../../engine-windows/src/asio_backend.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/../../engine-windows/src/windows_backend_factory.cpp"
)

# Add cmake-js delay-load hook if available
if(DEFINED CMAKE_JS_SRC)
    list(APPEND SOURCES ${CMAKE_JS_SRC})
endif()

# ── Addon target ──
add_library(${PROJECT_NAME} SHARED ${SOURCES})

# Resolve node-addon-api to absolute path (CMAKE_SOURCE_DIR = resources/lib, go up 2 levels)
get_filename_component(NODE_ADDON_API_DIR
    "${CMAKE_SOURCE_DIR}/../../node_modules/node-addon-api"
    ABSOLUTE)

target_include_directories(${PROJECT_NAME} PRIVATE
    "${FFMPEG_ROOT}/include"
    "${SAMPLERATE_INCLUDE_DIR}"
    "${SOUNDTOUCH_INCLUDE_DIR}"
    "${EASY_PLAYER_ENGINE_CORE_INCLUDE_DIR}"
    "${CMAKE_CURRENT_LIST_DIR}/../../engine-windows/src"
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
find_program(EASY_PLAYER_NODE_EXECUTABLE NAMES node)
if(NOT EASY_PLAYER_NODE_EXECUTABLE)
    message(FATAL_ERROR "Node.js is required to stage the Windows native runtime")
endif()
add_custom_command(TARGET ${PROJECT_NAME} POST_BUILD
    COMMAND "${EASY_PLAYER_NODE_EXECUTABLE}"
        "${CMAKE_CURRENT_LIST_DIR}/../../scripts/copy-native-assets.js"
        "${CMAKE_BINARY_DIR}" "$<CONFIG>"
    VERBATIM)

# ── Install ──
# Copy FFmpeg DLLs alongside the .node binary
install(TARGETS ${PROJECT_NAME} DESTINATION lib)
install(DIRECTORY "${FFMPEG_ROOT}/bin/" DESTINATION bin
        FILES_MATCHING PATTERN "*.dll")
install(FILES "${SAMPLERATE_DLL}" DESTINATION bin)
install(FILES "${SOUNDTOUCH_DLL}" DESTINATION bin)

# Small Node-API module for Windows taskbar artwork; independent of the audio engine.
if(WIN32)
add_library(easy_player_smtc SHARED "${CMAKE_CURRENT_LIST_DIR}/../../engine-windows/src/smtc.cpp" ${CMAKE_JS_SRC})
add_executable(easy_player_smtc_probe EXCLUDE_FROM_ALL "${CMAKE_CURRENT_LIST_DIR}/../../engine-windows/tests/smtc_probe.cpp")
# C++/WinRT needs standard coroutines: C++17 selects experimental/coroutine,
# which MSVC 14.51 and newer reject with STL1011.
target_compile_features(easy_player_smtc PRIVATE cxx_std_20)
target_compile_features(easy_player_smtc_probe PRIVATE cxx_std_20)
target_link_libraries(easy_player_smtc_probe PRIVATE windowsapp ole32)
target_compile_options(easy_player_smtc_probe PRIVATE /EHsc /permissive-)
target_include_directories(easy_player_smtc PRIVATE ${CMAKE_JS_INC} "${NODE_ADDON_API_DIR}")
target_link_libraries(easy_player_smtc PRIVATE ${CMAKE_JS_LIB} windowsapp ole32 user32)
target_compile_options(easy_player_smtc PRIVATE /EHsc /permissive-)
set_target_properties(easy_player_smtc PROPERTIES PREFIX "" SUFFIX ".node" MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
add_custom_command(TARGET easy_player_smtc POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different "$<TARGET_FILE:easy_player_smtc>" "${CMAKE_BINARY_DIR}/easy_player_smtc.node")
add_library(easy_player_window SHARED "${CMAKE_CURRENT_LIST_DIR}/../../engine-windows/src/window_preview.cpp" ${CMAKE_JS_SRC})
target_include_directories(easy_player_window PRIVATE ${CMAKE_JS_INC} "${NODE_ADDON_API_DIR}")
target_link_libraries(easy_player_window PRIVATE ${CMAKE_JS_LIB} dwmapi user32 gdi32)
set_target_properties(easy_player_window PROPERTIES PREFIX "" SUFFIX ".node" MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
add_custom_command(TARGET easy_player_window POST_BUILD
    COMMAND ${CMAKE_COMMAND} -E copy_if_different "$<TARGET_FILE:easy_player_window>" "${CMAKE_BINARY_DIR}/easy_player_window.node")
endif()
