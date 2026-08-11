# Engine build and integration

## Windows desktop

The existing commands are unchanged:

```powershell
npm run build:native
npm run dev
```

The Windows build needs FFmpeg, libsamplerate and SoundTouch as configured by
`src/main/native/CMakeLists.txt`. That CMake file builds `easy_player_engine_core`
first, then links it into the Electron N-API module with `engine-windows`.

## Android

`engine-android/CMakeLists.txt` builds `libeasy_player_engine_android.so` for
one Android ABI. Its minimum API is 26 because it uses AAudio.

Place or point `EASY_PLAYER_ANDROID_DEPS_ROOT` at ABI-specific prebuilt
dependencies:

```text
engine-android/deps/<abi>/
  include/
  lib/libavcodec.so lib/libavformat.so lib/libavutil.so lib/libswresample.so
  lib/libsamplerate.so lib/libSoundTouch.so
```

The Android application must package these dependency libraries alongside the
JNI library. `NativePlaybackService` owns the Kotlin `NativeAudioEngine` wrapper
on a single HandlerThread, including audio focus, media-session state, and
foreground playback notifications. Flutter communicates with that service via a
platform channel; Dart must not run engine control commands directly from
arbitrary UI isolates.

## Test checklist

Windows regression checks:

```powershell
npm run typecheck:node
cmake --build build/native-addon --config Release --target easy_player_native
node -e "const a=require('./build/native-addon/easy_player_native.node'); console.log(new a.AudioEngine().getVersion())"
```

Android acceptance checks, after an NDK host exists:

1. Build `arm64-v8a` and `armeabi-v7a` JNI libraries.
2. Open and play MP3, FLAC and WAV files through `NativeAudioEngine`.
3. Exercise pause, seek, stop and repeated open/close cycles.
4. Verify a Bluetooth route change and an AAudio stream error recover cleanly.
5. Run DSP effects while monitoring underruns and battery use.
