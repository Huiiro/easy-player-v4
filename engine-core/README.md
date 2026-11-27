# Easy Player engine core

The portable C++ playback core is shared by Windows, macOS and Android. It owns
FFmpeg decoding, DSP, buffering, playback state and the output-backend
contract. Platform output implementations and application bindings live in the
platform engine directories.

## Source modules

The implementations below live in [src/](src/). Public interfaces and reusable
processors live in [include/easy_player/](include/easy_player/).

| Files | Responsibility |
| --- | --- |
| [audio_engine.cpp](src/audio_engine.cpp) | Playback lifecycle, seeking, position and state changes. |
| [audio_engine_output.cpp](src/audio_engine_output.cpp) | Device selection, PCM and DoP format negotiation, startup and backend recovery. |
| [audio_engine_stream.cpp](src/audio_engine_stream.cpp) | Decoder producer, PCM and DoP callbacks, and deferred position and end-of-track events. |
| [audio_engine_transitions.cpp](src/audio_engine_transitions.cpp) | Gapless playback and crossfade settings, incoming decoder preparation and track handoff. |
| [audio_engine_auto_mix.cpp](src/audio_engine_auto_mix.cpp) | Background analysis, cached overlap plans and vocal stem coordination. |
| [audio_engine_analysis.cpp](src/audio_engine_analysis.cpp) | Spectrum, beat and loudness snapshots from the PCM analysis worker. |
| [audio_engine_dsp.cpp](src/audio_engine_dsp.cpp) | Engine-level DSP settings, including ReplayGain, impulse response loading and output-resampler settings. |
| [decoder.cpp](src/decoder.cpp), [decoder_pcm.cpp](src/decoder_pcm.cpp), [decoder_dop.cpp](src/decoder_dop.cpp) | FFmpeg setup and metadata, PCM decoding and seeking, and raw DSD packet transport. |
| [dsp_pipeline.cpp](src/dsp_pipeline.cpp) | PCM format conversion, processing order, stream draining and audio-chain status. |
| [dsp_effects.cpp](src/dsp_effects.cpp), [dsp_equalizer.cpp](src/dsp_equalizer.cpp), [dsp_convolution.cpp](src/dsp_convolution.cpp) | Effects and stereo controls, parametric EQ, and partitioned impulse-response convolution. |
| [ffmpeg_logging.cpp](src/ffmpeg_logging.cpp) | Routes FFmpeg logs through the engine logger with decoder operation context. |

[engine_core_sources.cmake](engine_core_sources.cmake) lists the shared desktop,
Android and native test sources. It also exposes the DSP sources separately for
standalone tests.

See the [engine architecture](../docs/engine/architecture.md) for the backend
boundary and threading rules.
