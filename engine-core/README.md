# Easy Player engine core

Platform-neutral C++ playback implementation shared by Windows and Android.
It owns FFmpeg decoding, DSP, buffering, playback state and the output-backend
contract. It must not include Electron, Node/N-API, Win32, AAudio, JNI or UI
code.

See [`docs/engine/architecture.md`](../docs/engine/architecture.md) for the
complete boundary and threading rules.
