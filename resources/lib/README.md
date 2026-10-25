# Local libraries and tools

- `CMakeLists.txt`: native audio addon build entry point.
- `ffmpeg/`: local FFmpeg development headers, libraries and executables.
- `yt-dlp/`: local download executables, excluded from Git.

Run `npm run prepare:ytdlp` to prepare yt-dlp for the current platform. Existing
local executables are retained. CI runs this before packaging. Set
`EASY_PLAYER_YTDLP_RELEASE` to a release tag to select a specific version;
otherwise the script uses the latest release from the
[official yt-dlp releases](https://github.com/yt-dlp/yt-dlp/releases).

```text
yt-dlp/
  win/yt-dlp.exe
  mac/yt-dlp
  linux/x64/yt-dlp
  linux/arm64/yt-dlp
```

The installer includes only its target platform's executable at
`lib/yt-dlp/yt-dlp[.exe]`. During development, the app uses the corresponding
file under `resources/lib/yt-dlp/`. If the bundled tool is absent, it falls back
to `EASY_PLAYER_YTDLP_PATH` or `yt-dlp` on `PATH`.
