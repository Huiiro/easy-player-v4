# Android native engine

This package links the shared `AudioEngine`/FFmpeg/DSP core to Android's AAudio
output API and exposes basic lifecycle controls through `NativeAudioEngine`.
The checked-in Gradle module defaults to `arm64-v8a`. For an x86_64 emulator,
provide matching dependencies and add `easyPlayerAndroidAbis=x86_64` plus an
`easyPlayerAndroidDepsRoot` pointing to `x64-android` in `local.properties`
(or pass both values with `-P` on the command line).

## Requirements

- `minSdk` 28 (Android 9; required by the static FFmpeg `avformat` build).
- An Android NDK installation.
- FFmpeg, libsamplerate and SoundTouch built for each shipped ABI and placed at.
  Both shared-library prebuilts and vcpkg static libraries are supported:

```text
engine-android/deps/<abi>/
  include/
  lib/libavcodec.{so,a} lib/libavformat.{so,a} lib/libavutil.{so,a}
  lib/libswresample.{so,a} lib/libsamplerate.{so,a} lib/libSoundTouch.{so,a}
```

For the local vcpkg Android triplet, invoke Gradle with:

```powershell
.\gradlew.bat :engine-android:assembleDebug -PeasyPlayerEngineEnabled=true `
  -PeasyPlayerAndroidDepsRoot=D:/program/vcpkg/installed/arm64-android
```

## Gradle integration

Configure `externalNativeBuild.cmake.path` to `engine-android/CMakeLists.txt`,
set `minSdk = 26`. Shared dependencies must be packaged in `jniLibs/<abi>`;
vcpkg static libraries are linked into the JNI library directly.

`NativePlaybackService` is the service-oriented host for the JNI engine. It
keeps all native calls on one HandlerThread, publishes Android media-session
state, requests audio focus, and starts foreground playback notifications.
Flutter should bind to that service through a platform channel rather than
invoking JNI directly.

AAudio has no public device enumeration API. Android's routing layer selects
Bluetooth, USB DAC, or the built-in endpoint; the initial engine therefore
exposes one logical `default` output device.
