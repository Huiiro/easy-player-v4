# Audio engine architecture

## Repository layout

```text
engine-core/       Cross-platform decoder, playback state, DSP and backend contracts
engine-windows/    WASAPI, ASIO, DirectSound and the Electron N-API adapter
engine-android/    AAudio backend, JNI bridge and Android build integration
src/               Existing Electron/Vue desktop application
mobile/            Reserved Flutter application
```

`src/main/native/CMakeLists.txt` remains the Windows Electron build entry point
because `npm run build:native` invokes it. It links `engine-core` with
`engine-windows`; it contains no engine implementation files itself.

## Core boundary

`AudioEngine` owns the parts that must behave consistently on every platform:

- FFmpeg demuxing and decoding;
- PCM/DoP buffering and seek coordination;
- DSP processing, including EQ, resampling, SoundTouch speed control,
  ReplayGain, transitions, channel matrix and analysis;
- playback state, timing and engine callbacks.

The core cannot instantiate a device itself. It receives an
`AudioBackendFactory`, which supplies `AudioBackend` instances and device
enumeration. This boundary prevents platform headers and output APIs from
entering `engine-core`.

## Output contracts

`AudioBackend::open()` receives a real-time callback that fills float PCM. The
backend must call it from its audio thread and must never introduce allocation,
locking or I/O on that callback path. The engine performs all decoding and DSP
before data reaches the backend.

The factory is responsible for platform policy:

- Windows creates the selected WASAPI shared/exclusive, ASIO or DirectSound
  backend and preserves the desktop device ordering.
- Android maps the engine's default device to AAudio low-latency output. Android
  owns physical device routing, so the initial implementation exposes one
  logical default endpoint.

## Thread model

```text
control thread ── open/play/seek/DSP configuration
decoder thread ── FFmpeg decode → PCM ring buffer
audio thread   ── ring buffer → DSP → AudioBackend callback
analysis thread ─ final PCM analysis → spectrum/loudness snapshot
```

Only the control thread changes engine configuration. The audio callback uses
preallocated buffers and atomics; changes to this requirement are regressions.

## Platform capability policy

Windows-only outputs (ASIO, WASAPI exclusive, DirectSound and DoP transport)
remain in `engine-windows`. Android initially supports PCM through AAudio. It
does not promise ASIO-equivalent routing, DoP, device enumeration or
bit-perfect output. Those capabilities require device-specific validation and
must be added as explicit Android features rather than assumed from the desktop
implementation.
