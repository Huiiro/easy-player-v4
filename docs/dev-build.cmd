@echo off
REM Quick build & run script for easy-player development
REM Usage: docs\dev-build.cmd [--no-run]
cd /d "%~dp0\.."

echo === Killing existing Electron processes ===
taskkill /F /IM electron.exe 2>nul
timeout /t 1 /nobreak >nul

echo === Setting up CMake ===
set "PATH=D:\application\VisualStudio\IDE\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin;%PATH%"

echo === Compiling native addon ===
call npx cmake-js compile --directory src/main/native --out build/native-addon
if %ERRORLEVEL% neq 0 (
    echo ERROR: cmake-js compile failed
    exit /b 1
)

echo === Copying .node and FFmpeg DLLs ===
del /f build\native-addon\easy_player_native.node 2>nul
copy /y build\native-addon\Release\easy_player_native.dll build\native-addon\easy_player_native.node

set "FFMPEG_BIN=src\main\native\deps\ffmpeg\ffmpeg-master-latest-win64-gpl-shared\bin"
for %%f in (avcodec-63.dll avformat-63.dll avutil-61.dll swresample-7.dll) do (
    copy /y "%FFMPEG_BIN%\%%f" build\native-addon\
)

echo === Build complete ===

if "%1"=="--no-run" (
    echo Skipping run (--no-run)
    exit /b 0
)

echo === Starting Electron ===
set ELECTRON_RUN_AS_NODE=
call npx electron-vite dev
