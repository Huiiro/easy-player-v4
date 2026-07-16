# Release smoke-test checklist

Run this checklist from a clean Windows x64 checkout before creating a release.

## Build gate

1. Set `VCPKG_ROOT` (or `VCPKG_INSTALLED_DIR`) to an installation containing `ffmpeg`, `libsamplerate`, and `soundtouch` for `x64-windows`.
2. Run `npm ci`.
3. Run `npm run typecheck` and `npm run build:native`.
4. Run `npm run build:unpack` and confirm `resources/native/` contains `easy_player_native.node`, FFmpeg DLLs, `samplerate.dll`, and `SoundTouch.dll`.
5. Start the unpacked application and confirm the native addon loads without an error panel entry.

## Playback regression

1. Play WAV, FLAC, MP3, and a tagged file; check metadata, seek, pause/resume, and track replacement.
2. Test DirectSound, WASAPI Shared, and WASAPI Exclusive with a 44.1 kHz then 48 kHz track; verify pitch and displayed output format update.
3. Enable each DSP node once, then disable it; verify bypass restores the expected sound.
4. Change device or disconnect/reconnect an output device during playback; verify a visible error or a clean recovery, never a process crash.
5. Confirm the analysis view updates during PCM playback and stops cleanly on pause/stop.

## DSD and release evidence

1. Verify DSD PCM conversion on a DSD64 file and capture the selected PCM output rate in logs.
2. Enable DoP only with a known compatible DAC. Capture the negotiated carrier rate and DAC indication; disable it immediately if noise occurs.
3. Do not mark any path bit-perfect without retained hardware verification evidence.

Record the Windows version, device/driver version, tested backend, output format, and any defects with the release candidate.
