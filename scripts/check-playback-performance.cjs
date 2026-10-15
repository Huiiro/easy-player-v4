/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
// Isolated native playback benchmark. No user library or preferences are read.
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const addon = path.resolve(
  process.env.PERF_ADDON || path.join(root, 'build/native-addon/easy_player_native.node')
)
const output = path.join(root, 'build/playback-performance.json')
const fixture = path.join(root, 'build/performance-tone.wav')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function worker(mode) {
  const { AudioEngine } = require(addon)
  const engine = new AudioEngine()
  engine.onLog((level, message) => {
    if (level >= 2) process.stderr.write(message + '\n')
  })
  engine.setBackend('wasapi_shared')
  assert.equal(engine.open(fixture), true, 'open synthetic WAV')
  engine.setVolume(0)
  engine.setAnalysisEnabled(mode === 'analysis')
  engine.setSpectrumAnalysisEnabled(mode === 'analysis')
  engine.setLoudnessAnalysisEnabled(mode === 'analysis')
  engine.setPlaybackOnly(mode === 'extreme')
  assert.equal(engine.play(), true, 'start silent playback')
  await sleep(1500)
  const startPosition = engine.getStatus().positionMs
  const cpu = process.cpuUsage()
  const start = performance.now()
  const memory = []
  for (let i = 0; i < 12; i++) {
    await sleep(500)
    memory.push(process.memoryUsage())
    if (mode === 'analysis') engine.getAudioAnalysis(true)
  }
  const elapsedMs = performance.now() - start
  const used = process.cpuUsage(cpu)
  const endPosition = engine.getStatus().positionMs
  assert.ok(endPosition - startPosition > 4500, 'playback progresses')
  assert.equal(engine.pause(), true)
  engine.setPlaybackOnly(false)
  engine.setAnalysisEnabled(true)
  assert.equal(engine.seek(1000), true, 'seek after mode switch')
  assert.equal(engine.play(), true, 'resume after mode switch')
  await sleep(300)
  const glitches = engine.getGlitchCount()
  engine.stop()
  process.stdout.write(
    JSON.stringify({
      mode,
      elapsedMs,
      cpuPercentOneCore: (used.user + used.system) / (elapsedMs * 10),
      averageRssMiB: memory.reduce((sum, m) => sum + m.rss, 0) / memory.length / 1048576,
      rssGrowthMiB: (memory.at(-1).rss - memory[0].rss) / 1048576,
      heapUsedMiB: memory.at(-1).heapUsed / 1048576,
      glitches,
      playbackAdvancedMs: endPosition - startPosition
    })
  )
}

async function main() {
  if (process.argv[2]) return worker(process.argv[2])
  const rate = 48000,
    frames = rate * 30
  const wav = Buffer.alloc(44 + frames * 4)
  wav.write('RIFF')
  wav.writeUInt32LE(wav.length - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(2, 22)
  wav.writeUInt32LE(rate, 24)
  wav.writeUInt32LE(rate * 4, 28)
  wav.writeUInt16LE(4, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(frames * 4, 40)
  for (let i = 0; i < frames; i++) {
    const sample = Math.round(Math.sin((i * 440 * Math.PI * 2) / rate) * 3000)
    wav.writeInt16LE(sample, 44 + i * 4)
    wav.writeInt16LE(sample, 46 + i * 4)
  }
  fs.writeFileSync(fixture, wav)
  const results = []
  try {
    for (let round = 0; round < 2; round++) {
      for (const mode of round
        ? ['extreme', 'normal', 'analysis']
        : ['analysis', 'normal', 'extreme']) {
        const child = spawnSync(process.execPath, [__filename, mode], {
          cwd: root,
          encoding: 'utf8',
          timeout: 20000
        })
        if (child.status !== 0) throw new Error(`${mode}: ${child.stderr || child.stdout}`)
        results.push(JSON.parse(child.stdout))
      }
    }
    const report = {
      timestamp: new Date().toISOString(),
      platform: process.platform,
      node: process.version,
      fixture:
        '48 kHz stereo PCM16, WASAPI shared, silent output; two fresh processes per scenario',
      scope:
        'Native engine only. RSS and CPU do not include Electron renderer, GPU or user library. Analysis scenario is a workload comparison, not a pre-change application baseline.',
      results
    }
    fs.writeFileSync(output, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
  } finally {
    fs.unlinkSync(fixture)
  }
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
