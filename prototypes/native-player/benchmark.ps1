param(
    [ValidateRange(6, 300)]
    [int] $Seconds = 60,
    [ValidateSet('Slint', 'GPUI')]
    [string] $Ui = 'Slint'
)

$ErrorActionPreference = 'Stop'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$binary = if ($Ui -eq 'GPUI') {
    Join-Path $PSScriptRoot '../gpui-player/target/release/easy-player-gpui-ui.exe'
} else {
    Join-Path $PSScriptRoot 'target/release/easy-player-native-ui.exe'
}
$deps = if ($env:EASY_PLAYER_AUDIO_DEPS) { $env:EASY_PLAYER_AUDIO_DEPS } else {
    Join-Path $repo 'build/native-deps/installed/x64-windows-audio'
}
$deps = (Resolve-Path $deps).Path
if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) {
    throw 'Build the Release binary with cargo build --locked --release first.'
}

$fixture = Join-Path $repo ('build/native-ui-performance-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $fixture | Out-Null
$audio = Join-Path $fixture 'tone.wav'
$lyrics = Join-Path $fixture 'tone.lrc'
$lyricsCount = [Math]::Max(100, [Math]::Ceiling(($Seconds + 12) / 2))
$lines = for ($index = 0; $index -lt $lyricsCount; $index++) {
    $time = $index * 2
    '[{0:00}:{1:00}.00]Performance lyric {2}' -f [Math]::Floor($time / 60), ($time % 60), $index
}
[IO.File]::WriteAllLines($lyrics, $lines)
$rate = 48000
$tone = [int16[]]::new($rate * 2)
for ($frame = 0; $frame -lt $rate; $frame++) {
    $sample = [int16][Math]::Round(3000 * [Math]::Sin(2 * [Math]::PI * 440 * $frame / $rate))
    $tone[2 * $frame] = $sample
    $tone[2 * $frame + 1] = $sample
}
$chunk = [byte[]]::new($rate * 4)
[Buffer]::BlockCopy($tone, 0, $chunk, 0, $chunk.Length)
$fileSeconds = $Seconds + 15
$size = $fileSeconds * $chunk.Length
$writer = [IO.BinaryWriter]::new([IO.File]::Create($audio))
try {
    $writer.Write([Text.Encoding]::ASCII.GetBytes('RIFF'))
    $writer.Write([int](36 + $size))
    $writer.Write([Text.Encoding]::ASCII.GetBytes('WAVEfmt '))
    $writer.Write([int]16)
    $writer.Write([int16]1)
    $writer.Write([int16]2)
    $writer.Write([int]$rate)
    $writer.Write([int]($rate * 4))
    $writer.Write([int16]4)
    $writer.Write([int16]16)
    $writer.Write([Text.Encoding]::ASCII.GetBytes('data'))
    $writer.Write([int]$size)
    for ($i = 0; $i -lt $fileSeconds; $i++) { $writer.Write($chunk) }
} finally {
    $writer.Dispose()
}

$start = [Diagnostics.ProcessStartInfo]::new($binary)
$start.UseShellExecute = $false
$start.CreateNoWindow = $true
$start.RedirectStandardOutput = $true
$start.RedirectStandardError = $true
$start.Environment['PATH'] = (Join-Path $deps 'bin') + ';' + $env:Path
if ($Ui -eq 'Slint') {
    $start.Environment['SLINT_BACKEND'] = 'winit-femtovg'
    $start.Environment['EASY_PLAYER_UI_SNAPSHOT'] = Join-Path $fixture 'window.png'
}
foreach ($arg in @('--measure', "$Seconds", $audio, $lyrics)) { $start.ArgumentList.Add($arg) }
$player = [Diagnostics.Process]::Start($start)
$stderr = $player.StandardError.ReadToEndAsync()

try {
    $ready = $player.StandardOutput.ReadLineAsync()
    if (-not $ready.Wait(20000) -or $ready.Result -ne 'READY') {
        throw 'The player failed to begin the steady-state benchmark.'
    }

    $clock = [Diagnostics.Stopwatch]::StartNew()
    $cpuStart = $player.TotalProcessorTime.TotalMilliseconds
    $samples = @()
    while (-not $player.HasExited -and $clock.Elapsed.TotalSeconds -lt ($Seconds + 5)) {
        $player.Refresh()
        try {
            $samples += [pscustomobject]@{
                workingMiB = $player.WorkingSet64 / 1MB
                privateMiB = $player.PrivateMemorySize64 / 1MB
                cpuPercentOneCore = 100 * ($player.TotalProcessorTime.TotalMilliseconds - $cpuStart) / [Math]::Max(1, $clock.Elapsed.TotalMilliseconds)
            }
        } catch [InvalidOperationException] {
            if (-not $player.HasExited) { throw }
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not $player.WaitForExit(5000) -or $player.ExitCode -ne 0) {
        throw 'The player did not finish the playback and scrolling checks.'
    }
    $metrics = $player.StandardOutput.ReadToEnd() | ConvertFrom-Json
    $report = [ordered]@{
        timestamp = (Get-Date).ToString('o')
        fixture = '48 kHz stereo PCM16, WASAPI shared, volume 0, line-synced LRC'
        renderer = if ($Ui -eq 'GPUI') { 'gpui-directx' } else { 'slint-winit-femtovg' }
        lyricLines = $lyricsCount
        metrics = $metrics
        avgWorkingMiB = [Math]::Round(($samples | Measure-Object workingMiB -Average).Average, 2)
        avgPrivateMiB = [Math]::Round(($samples | Measure-Object privateMiB -Average).Average, 2)
        avgCpuPercentOneCore = [Math]::Round($samples[-1].cpuPercentOneCore, 2)
        memorySamples = $samples.Count
    }
    $json = $report | ConvertTo-Json -Depth 4
    $json | Set-Content (Join-Path $fixture 'report.json') -Encoding utf8
    $json
    Write-Host "Report: $(Join-Path $fixture 'report.json')"
} finally {
    if (-not $player.HasExited) {
        $player.Kill()
        $player.WaitForExit()
    }
    if ($stderr.Result) { Write-Host $stderr.Result }
    $player.Dispose()
}
