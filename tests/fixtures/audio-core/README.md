# Audio decoder fixtures

These seven 150 ms, 440 Hz tones are synthetic regression fixtures generated
locally, with no third-party recording. They cover MP3, AAC/M4A, ALAC/M4A,
FLAC, Vorbis/OGG, Opus and big-endian PCM/AIFF. Tests decode each to PCM with
the bundled FFmpeg and open each with the native playback engine. Fixture
generation is separate from runtime capabilities: shipping Vorbis/Opus/MP3
encoders is unnecessary for playback. This directory is excluded from packages.
