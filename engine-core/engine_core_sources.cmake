# DSP can also be built without FFmpeg for the standalone native tests.
set(EASY_PLAYER_DSP_SOURCES
    "${CMAKE_CURRENT_LIST_DIR}/src/dsp_pipeline.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/src/dsp_effects.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/src/dsp_equalizer.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/src/dsp_convolution.cpp"
)

# Shared by the desktop addon, Android JNI and full core native tests.
set(EASY_PLAYER_ENGINE_CORE_SOURCES
    "${CMAKE_CURRENT_LIST_DIR}/src/audio_engine.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/src/audio_engine_analysis.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/src/audio_engine_auto_mix.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/src/audio_engine_dsp.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/src/audio_engine_output.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/src/audio_engine_stream.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/src/audio_engine_transitions.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/src/decoder.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/src/decoder_dop.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/src/decoder_pcm.cpp"
    "${CMAKE_CURRENT_LIST_DIR}/src/ffmpeg_logging.cpp"
    ${EASY_PLAYER_DSP_SOURCES}
)

set(EASY_PLAYER_ENGINE_CORE_INCLUDE_DIR "${CMAKE_CURRENT_LIST_DIR}/include/easy_player")
