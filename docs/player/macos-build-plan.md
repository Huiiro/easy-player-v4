# macOS build and playback plan

## Current deliverable

The macOS arm64 build uses the native `engine-core` decoder/DSP pipeline with a
CoreAudio AudioQueue output backend. It keeps local playback, pause, stop,
seek, progress events, volume persistence and queue auto-advance working
without loading the Windows N-API binary.

It intentionally does not expose output-device selection, DoP or bit-perfect
claims. The first native backend uses the system default shared output; device
routing and exclusive-mode features remain out of scope.

## Build locally

```bash
nvm use
npm install
npm run build:native
npm run build:mac
```

The resulting files are:

- `dist/easy-player-<version>.dmg`
- `dist/Easy Player-<version>-arm64-mac.zip`

The build requires Node 22.20.0 (recorded in `.nvmrc`) and:

```bash
brew install ffmpeg libsamplerate sound-touch
```

No Windows native binary is included in the macOS bundle. `build:mac` copies
the native module's Homebrew dylib closure into `native/deps` and rewrites the
Mach-O loader paths, so the resulting app does not require Homebrew at runtime.

## Phase 1: release-quality compatibility backend

1. Clearly mark unavailable device/DoP/bit-perfect settings in the macOS UI.
2. Validate MP3, AAC/M4A, ALAC, WAV and FLAC playback on Apple Silicon and
   Intel macOS.
3. Sign with a Developer ID certificate and notarize the DMG/ZIP in CI.

Acceptance: opening a local supported audio file, play/pause/stop, queue
advance, tray actions and reopening the application all work on macOS.

## Phase 2: native CoreAudio engine

1. Move the N-API wrapper out of `engine-windows` into a shared desktop adapter.
2. Expose CoreAudio's default device first; add stable device IDs and route
   change handling before presenting device selection in the UI.
3. Implement device selection and route-change recovery.

Acceptance: MP3/FLAC/WAV playback, pause/seek/reopen, DSP regression suite and
device route changes run through the same `AudioEngineManager` IPC contract as
Windows.

## Phase 3: distribution and regression coverage

1. Build `arm64` and `x64`, then use `electron-builder --mac --universal` once
   native dependencies are universal or separately rebuilt per architecture.
2. Add a macOS CI job for `npm run typecheck`, `npm run build:mac`, bundle
   inspection and a smoke test against the native addon.
3. Add notarization credentials only in CI secrets; do not commit certificates
   or Apple credentials.
