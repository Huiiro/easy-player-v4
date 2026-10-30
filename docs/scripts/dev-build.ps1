# Quick build & run script for easy-player development
# Usage: .\docs\scripts\dev-build.ps1 [-NoRun]

param([switch]$NoRun)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path))
Set-Location $ProjectDir

Write-Host "=== Building native addon with pinned audio dependencies ===" -ForegroundColor Cyan
npm run build:native
if ($LASTEXITCODE -ne 0) { throw "Native audio build failed" }

Write-Host "=== Build complete ===" -ForegroundColor Green

if ($NoRun) {
    Write-Host "Skipping run (-NoRun)"
    exit 0
}

Write-Host "=== Starting Electron ===" -ForegroundColor Cyan
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
npm run dev
