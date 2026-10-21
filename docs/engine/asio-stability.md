# ASIO stability fixes

The engine joins its position, decoder and analysis threads before releasing an
output device. Device switching and driver recovery preserve the source position.
ASIO creates, controls and releases IASIO on one dedicated thread, keeping its COM
STA apartment alive until after the interface is released. The control thread
pumps Windows messages while idle so drivers can service hidden windows.
ASIO4ALL registers ThreadingModel=Apartment; creating its custom IASIO interface
from MTA fails with E_NOINTERFACE because there is no cross-apartment proxy.

Every start initializes both driver buffers and renders buffer 1 before starting
the hardware. PCM short writes are padded with silence; DoP silence has valid
payload and continuous markers, including odd-sized buffers and pause/resume.

Driver reset, resync, buffer-size and sample-rate notifications are recorded with
atomics. The Windows host services them every 100 ms even while the renderer is
hidden. Recovery rebuilds the output and DSP from confirmed driver parameters;
paused playback defers reopening until resume. Latency changes refresh latency
without restarting playback. Recovery and seek restart failures stop playback
and report an error. Failed recovery requires restarting playback or selecting
another device; it does not retry forever.

Buffer constraints are queried after rate confirmation. Query errors, out-of-range
preferred sizes and invalid granularity are rejected instead of using 512 frames.
An already-correct sample clock is retained without calling setSampleRate.

## Regression tests (PowerShell, Windows)

```powershell
cmake -S tests/native -B build/asio-regression -A x64 '-DCMAKE_PREFIX_PATH=D:/program/vcpkg/installed/x64-windows'
cmake --build build/asio-regression --config Release
$env:PATH = "$PWD/src/main/native/deps/ffmpeg/bin;D:/program/vcpkg/installed/x64-windows/bin;$env:PATH"
ctest --test-dir build/asio-regression -C Release --output-on-failure
```

Adjust the dependency prefix for the local installation. The engine recovery test
is enabled when FFmpeg, libsamplerate and SoundTouch development files are found.
The fake IASIO server checks thread/apartment lifetime, initialization order,
driver buffer priming, constraint validation, singleton ownership, notifications,
restart failures and DoP markers without loading a real audio driver. The engine
test covers EOF/device-switch overlap, playing and paused recovery, and errors.

Hardware validation remains necessary: exercise PCM/DoP startup, pause/resume,
repeated seeks, 44.1/48/96/192 kHz track changes, driver panel buffer changes,
external clock loss and device disconnect/reconnect on the target driver.

`asio_activation_probe` compares real ASIO4ALL creation from MTA and STA without
initializing audio. `asio_backend_probe` explicitly opens the real driver and
renders silence for 500 ms, verifying callbacks and shutdown. Neither probe runs
as part of CTest; run them manually when hardware validation is intended.

On the development machine, the activation probe reproduced MTA=0x80004002 and
STA=S_OK. With the STA fix, the real ASIO4ALL backend opened at 48 kHz, stereo,
512 frames, delivered 12 callbacks during the short silent probe and stopped
successfully. This verifies driver startup, not audible playback quality.
