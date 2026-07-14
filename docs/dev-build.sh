#!/bin/bash
# Quick build & run script for easy-player development
# Usage: bash docs/dev-build.sh [--no-run]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "=== Killing existing Electron processes ==="
taskkill /F /IM electron.exe 2>/dev/null || true
sleep 1

echo "=== Setting up CMake ==="
export PATH="/d/application/VisualStudio/IDE/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin:$PATH"

echo "=== Compiling native addon ==="
npx cmake-js compile --directory src/main/native --out build/native-addon

echo "=== Copying .node and FFmpeg DLLs ==="
rm -f build/native-addon/easy_player_native.node
cp build/native-addon/Release/easy_player_native.dll build/native-addon/easy_player_native.node

FFMPEG_BIN="src/main/native/deps/ffmpeg/ffmpeg-master-latest-win64-gpl-shared/bin"
for dll in avcodec-63.dll avformat-63.dll avutil-61.dll swresample-7.dll; do
    cp "$FFMPEG_BIN/$dll" build/native-addon/
done

echo "=== Build complete ==="

if [ "$1" = "--no-run" ]; then
    echo "Skipping run (--no-run)"
    exit 0
fi

echo "=== Starting Electron ==="
unset ELECTRON_RUN_AS_NODE
npx electron-vite dev
