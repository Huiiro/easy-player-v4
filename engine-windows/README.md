# Easy Player Windows engine adapter

Contains the Windows output backends (WASAPI, ASIO and DirectSound), their
factory, and the Electron N-API adapter. The desktop build is still launched
from `src/main/native/CMakeLists.txt` for compatibility with `cmake-js`.

This directory must not contain decoder or DSP implementation. Those belong in
`../engine-core`.
