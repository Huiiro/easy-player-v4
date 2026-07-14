# Quick build & run script for easy-player development
# Usage: .\docs\dev-build.ps1 [-NoRun]

param([switch]$NoRun)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $ProjectDir

Write-Host "=== Killing existing Electron processes ===" -ForegroundColor Cyan
taskkill /F /IM electron.exe 2>$null | Out-Null
Start-Sleep 1

Write-Host "=== Setting up CMake ===" -ForegroundColor Cyan
$cmakePath = "D:\application\VisualStudio\IDE\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin"
$env:Path = "$cmakePath;$env:Path"

Write-Host "=== Compiling native addon ===" -ForegroundColor Cyan
npx cmake-js compile --directory src/main/native --out build/native-addon
if ($LASTEXITCODE -ne 0) { throw "cmake-js compile failed" }

Write-Host "=== Copying .node and FFmpeg DLLs ===" -ForegroundColor Cyan
Remove-Item -Force build/native-addon/easy_player_native.node -ErrorAction SilentlyContinue
Copy-Item build/native-addon/Release/easy_player_native.dll build/native-addon/easy_player_native.node

$ffmpegBin = "src/main/native/deps/ffmpeg/ffmpeg-master-latest-win64-gpl-shared/bin"
@("avcodec-63.dll", "avformat-63.dll", "avutil-61.dll", "swresample-7.dll") | ForEach-Object {
    Copy-Item "$ffmpegBin/$_" build/native-addon/
}

Write-Host "=== Build complete ===" -ForegroundColor Green

if ($NoRun) {
    Write-Host "Skipping run (-NoRun)"
    exit 0
}

Write-Host "=== Starting Electron ===" -ForegroundColor Cyan
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npx electron-vite dev
