# Release smoke-test checklist

Run this checklist from a clean Windows x64 checkout before creating a release.

## Build gate

1. Run `npm run prepare:native` with VS2022 Desktop C++, Windows SDK, CMake and Git available. It builds the pinned audio-only dependencies; optionally set `VCPKG_ROOT` to an existing vcpkg Git checkout.
2. Run `npm ci`.
3. Run `npm run typecheck` and `npm run build:native`.
4. Run `npm run test:audio-core` and `npm run build:unpack`. Confirm `resources/native/` contains `easy_player_native.node`, five audio-profile FFmpeg DLLs, `ffmpeg.exe`, `ffmpeg-runtime.json`, `samplerate.dll`, and `SoundTouch.dll`. Run `node scripts/verify-windows-package.cjs`.
5. Start the unpacked application and confirm the native addon loads without an error panel entry.
6. Confirm Settings → Other → Build number and the `[Main] starting application` log show the same build number. It is generated from the UTC build time (`YYYYMMDDHHmmss`) once per `electron-vite` invocation. Rebuilding or restarting the development server generates a new number; restarting a packaged application keeps its original number. The release version in `package.json` remains independent.

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
