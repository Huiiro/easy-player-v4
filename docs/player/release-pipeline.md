# Desktop release pipeline

Pushing a tag named `v<package-version>` currently builds and publishes only
the Windows x64 installer. The release also includes its update manifest and
the optional Auto Mix component ZIP/JSON. The tag must match `package.json`;
keep both version fields in `package-lock.json` in sync. Commit the changes
before tagging so the workflow builds the intended source.

A version with a prerelease suffix, such as `3.3.1-beta.1`, creates a GitHub
prerelease and includes the matching update channel manifest. For prerelease
apps, the optional component downloader uses that exact version's release
assets; stable apps use the latest stable release.

Pull requests and ordinary branch pushes run the Windows, macOS, and Linux CI
workflows. They build the application but do not publish a release. Release
tags skip these duplicate CI builds. A manual run of **Release desktop apps**
defaults to Windows; select `all` to additionally build macOS/Linux artifacts.
Manual runs do not create a GitHub Release. Linux native audio packaging still
needs separate validation before publishing Linux builds.

## Windows build and validation

Use Node.js from `.nvmrc` (22.20.0), Visual Studio 2022 with Desktop C++ and
Windows SDK, CMake and Git. Run `npm run prepare:native` to build the pinned
FFmpeg 8.1.2 audio profile, libsamplerate and SoundTouch. `VCPKG_ROOT` may point
to an existing Git checkout; otherwise the script creates one under `build`.
Both CI and local builds use `resources/lib/native-deps/vcpkg.json`, the same
overlay profile and the release-only `x64-windows-audio` triplet. Runtime files
and SDK headers are generated under
`build/native-deps/installed/x64-windows-audio`. The old full-featured
`resources/lib/ffmpeg` SDK is no longer selected.

The profile retains common audio/DSD decoding, HTTPS/HLS audio, artwork,
metadata remuxing, audio resampling and PCM output for the optional stem worker.
FFmpeg CLI requires a small avfilter library. Video encoders, hardware video,
device capture, swscale, subtitles and external video/GPU libraries are omitted.
The package contains exactly five manifest-verified FFmpeg DLLs and rejects
video/device DLLs or an FFmpeg runtime over 15 MiB.
SoundTouch 2.4.0 is pinned to an official Git commit and checked archive hash
in `sources.json`, avoiding a regenerated upstream tag archive.

Native compilation explicitly configures the installed Electron headers even
when reusing an old build directory. Windows packaging defaults to BCJ/level 9
locally and in CI. A running player can retain an old mapped DLL; the build
preserves it as a backup outside packaging patterns. Restart to load the new
runtime.

Windows stages the required VC++ runtime DLLs from Visual Studio's x64
redistributable directory and follows their PE imports recursively. They are
packaged beside both the application EXE and the native FFmpeg CLI. Package
verification checks their architecture, SHA-256 and dependency closure. Set
`EASY_PLAYER_VC_REDIST_DIR` only when using a custom Visual Studio layout.

yt-dlp is pinned across platforms in `resources/lib/ytdlp-release.json`.
Preparation replaces stale caches, verifies official size/SHA-256 and executes
`--version` before activation. Run `npm run update:ytdlp` to refresh the lock
from the latest stable release and install the host asset. Commit the updated
lock so Windows/macOS/Linux CI all use the same version.

The Windows command runs both TypeScript checks and prepares yt-dlp/FFmpeg:

```powershell
npm ci
npm run prepare:native
npm run build:win -- --publish never
node scripts/verify-windows-package.cjs
node scripts/test-native-runtime-paths.cjs
npm run test:audio-core
npm run test:packaging-deps
npm run test:auto-mix-runtime
```

Python 3.12.10 is a build dependency for the optional component, not for the
base installer or users' systems. Its preparation downloads a CPU-only runtime
and model, strips build/test files, and emits a separate archive:
Build-time model downloads stay under `build/stem-downloads/model-cache`,
separate from the application's installed components and stem cache.

```powershell
npm run package:auto-mix
npm run test:bundled-auto-mix
npm run test:auto-mix-component-install
```

Publish the installer, its `*.yml` update manifest, any blockmap, and both
`easy-player-auto-mix-win32-x64-*.zip` and `easy-player-auto-mix-win32-x64.json`.
The component JSON contains the archive size and SHA-256 and must accompany
the corresponding ZIP. The release workflow runs these checks automatically
and rejects base installers over 250 MiB. Component tests use isolated data
directories and do not uninstall or clear the user's real component/cache.

## macOS Apple Silicon build and validation

The `macOS build` workflow builds ARM64 DMG/ZIP artifacts on a `macos-14`
runner, with macOS 12.0 as the minimum deployment target. It builds the same
pinned audio-only FFmpeg, libsamplerate and SoundTouch sources as Windows,
using the `arm64-osx-audio` triplet. Homebrew supplies build tools only.
Neither the old local FFmpeg SDK nor Homebrew audio libraries are selected.

```sh
brew install ninja autoconf automake libtool pkg-config
npm ci
npm run build:mac -- --publish never
npm run test:audio-core
npm run test:macos-package
```

Use native ARM64 Node.js. The build command prepares yt-dlp and native
dependencies, checks TypeScript, builds the app and validates its packaged
audio engine, SQLite and Sharp under Electron. CI also runs native DSP,
Remix and backend recovery tests, then hides the SDK and repeats package
loading and decoding checks. Artifacts are named
`easy-player-<version>-mac-arm64.dmg` and `.zip`.

The native audio runtime uses bundled `@loader_path` dylibs with no residual
SDK search paths. Package checks reject missing/wrong-architecture libraries,
newer deployment targets, video libraries and an audio runtime over 25 MiB.
Official yt-dlp bytes are verified before signing; packaged execution, version
and signature are verified afterwards.

This is an Apple Silicon test build, using a complete ad-hoc app signature.
The Mac test configuration sets `identity: '-'`, `hardenedRuntime: false` and
`notarize: false`; package verification checks the whole bundle signature.
For public distribution, replace the identity, enable hardened runtime and
configure notarization. Developer ID
signing/notarization, Intel/universal validation and the optional Mac Python
stem component remain separate work. CoreAudio currently supports the system
default shared PCM output. Real-device playback and installation still need
manual checks. See [Mac build and testing](macos-build.md).

## Repository secrets

The current workflow uses unsigned Windows packages and ad-hoc signed Mac test
packages. To distribute binaries signed with a publisher identity, add the
following secrets and wire them into the matching package job. For Mac, also
override the test identity/hardened-runtime/notarization options above:

| Platform           | Secret                        | Value                                                                            |
| ------------------ | ----------------------------- | -------------------------------------------------------------------------------- |
| Windows            | `WINDOWS_CSC_LINK`            | Base64-encoded Authenticode `.pfx` certificate (or a supported certificate URL). |
| Windows            | `WINDOWS_CSC_KEY_PASSWORD`    | Password for the `.pfx` file.                                                    |
| macOS              | `MACOS_CSC_LINK`              | Base64-encoded Developer ID Application `.p12` certificate.                      |
| macOS              | `MACOS_CSC_KEY_PASSWORD`      | Password for the `.p12` file.                                                    |
| macOS notarization | `APPLE_ID`                    | Apple ID used for notarization.                                                  |
| macOS notarization | `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password generated by that Apple ID.                                |
| macOS notarization | `APPLE_TEAM_ID`               | Apple Developer Team ID.                                                         |

Electron Builder imports `CSC_LINK` automatically. When the macOS certificate
and all three Apple credentials are present, it signs the app and performs
Apple notarization; `stapler` runs as part of the notarization flow.

The macOS workflow uses `macos-14` and therefore produces an arm64 build. The
Windows workflow installs the native FFmpeg, libsamplerate and SoundTouch
development dependencies through vcpkg and packages the generated `.node` and
runtime DLL files.
