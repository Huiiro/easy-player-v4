# Single source of truth for the portable decoder/DSP engine. Both the desktop
# N-API target and Android JNI target compile these sources for their ABI.
set(EASY_PLAYER_ENGINE_CORE_SOURCES
    "${CMAKE_CURRENT_LIST_DIR}/src/audio_engine.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/src/decoder.cpp"
)

set(EASY_PLAYER_ENGINE_CORE_INCLUDE_DIR "${CMAKE_CURRENT_LIST_DIR}/include/easy_player")
