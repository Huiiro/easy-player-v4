# yt-dlp runtime

Place the official release binaries in these paths before packaging:

- `win/yt-dlp.exe`: Windows x64 `yt-dlp.exe`.
- `mac/yt-dlp`: macOS universal `yt-dlp_macos`, renamed to `yt-dlp` and marked executable.
- `linux/x64/yt-dlp`: Linux x64 `yt-dlp_linux`, renamed to `yt-dlp` and marked executable.
- `linux/arm64/yt-dlp`: Linux ARM64 `yt-dlp_linux_aarch64`, renamed to `yt-dlp` and marked executable.

Each electron-builder target imports only its own file into `resources/tools/yt-dlp/` in the final app. For the Unix binaries, run `chmod +x` after downloading (and commit the executable bit when applicable).

Easy Player resolves this bundled executable before falling back to `EASY_PLAYER_YTDLP_PATH` and then the system `PATH`.
