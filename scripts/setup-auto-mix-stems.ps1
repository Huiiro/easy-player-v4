param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$stemRepoRoot = Split-Path -Parent $PSScriptRoot
$stemRuntime = Join-Path $stemRepoRoot 'build\stem-runtime'
$stemPython = Join-Path $stemRuntime 'Scripts\python.exe'
$stemCache = Join-Path $stemRepoRoot 'build\stem-pip-cache'
function Invoke-StemCommand([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Stem runtime setup failed: $Executable ($LASTEXITCODE)" }
}
Invoke-StemCommand $Python @('-m', 'venv', $stemRuntime)
Invoke-StemCommand $stemPython @('-m', 'pip', 'install', '--disable-pip-version-check', '--cache-dir', $stemCache,
    'torch==2.5.1', 'torchaudio==2.5.1', '--index-url', 'https://download.pytorch.org/whl/cpu')
Invoke-StemCommand $stemPython @('-m', 'pip', 'install', '--disable-pip-version-check', '--cache-dir', $stemCache,
    'dora-search', 'einops', 'julius', 'lameenc', 'openunmix', 'pyyaml', 'tqdm', 'soundfile', 'scipy')
# Demucs 4.0.1 declares an older torchaudio constraint; this worker uses tensors
# and FFmpeg, avoiding its legacy torchaudio.load/save APIs. Validate with warmup.
Invoke-StemCommand $stemPython @('-m', 'pip', 'install', '--disable-pip-version-check', '--cache-dir', $stemCache,
    'demucs==4.0.1', '--no-deps')
Invoke-StemCommand $stemPython @((Join-Path $stemRepoRoot 'resources\auto-mix\stem_worker.py'), '--cache',
    (Join-Path $stemRepoRoot 'build\auto-mix-stems'), '--warmup')
Write-Output 'Local CPU stem runtime is ready. Restart the player to use it.'
