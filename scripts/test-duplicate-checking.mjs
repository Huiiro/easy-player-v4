/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import ts from 'typescript'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
function load(file, mocks = {}) {
  const cache = new Map()
  function visit(filename) {
    filename = path.resolve(filename)
    if (cache.has(filename)) return cache.get(filename)
    const exports = {}
    cache.set(filename, exports)
    vm.runInNewContext(
      ts.transpileModule(readFileSync(filename, 'utf8'), {
        compilerOptions: {
          module: ts.ModuleKind.CommonJS,
          target: ts.ScriptTarget.ES2022,
          esModuleInterop: true
        }
      }).outputText,
      {
        exports,
        process,
        Buffer,
        Error,
        AbortController,
        setTimeout,
        clearTimeout,
        require: (name) => {
          if (name in mocks) return mocks[name]
          if (!name.startsWith('.')) return require(name)
          const target = path.resolve(path.dirname(filename), name)
          return visit(existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'colors.ts'))
        }
      },
      { filename }
    )
    return exports
  }
  return visit(file)
}

const playback = load('src/main/service/playbackMode.ts')
const { checkDuplicateFileStates } = load('src/main/service/duplicateFileChecking.ts', {
  './playbackMode': playback
})
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const songs = Array.from({ length: 80 }, (_, id) => ({
  id,
  audio: path.resolve(`test-check-${id}.flac`)
}))
const stat = { isFile: () => true, size: 123 }
let active = 0,
  peak = 0
const progress = []
const outcome = await checkDuplicateFileStates(
  [...songs, { ...songs[0], id: 999 }],
  (value) => progress.push(value),
  undefined,
  {
    stat: async (file) => {
      active++
      peak = Math.max(peak, active)
      const id = Number(file.match(/test-check-(\d+)/)[1])
      try {
        await delay((7 - (id % 8)) * 2 + 1)
        if (id === 3) throw new Error('unavailable')
        return id === 6 ? { ...stat, isFile: () => false } : id === 9 ? { ...stat, size: 0 } : stat
      } finally {
        active--
      }
    }
  }
)
assert.equal(peak, 8)
assert.equal(active, 0)
assert.equal(
  outcome.files.map((entry) => entry.song.id).join(','),
  songs
    .filter((song) => ![3, 6, 9].includes(song.id))
    .map((song) => song.id)
    .join(','),
  'completion order cannot reorder the library or duplicate ownership'
)
assert.equal(
  outcome.skipped.map((entry) => entry.path).join(','),
  [3, 6, 9].map((id) => songs[id].audio).join(','),
  'skipped-file order stays deterministic'
)
assert.equal(progress.at(-1).current, 81)
assert.ok(progress.every((value, index) => !index || value.current >= progress[index - 1].current))
assert.ok(progress.every((value) => value.activeChecks <= 8))

let sidecarStats = 0
const sidecars = await checkDuplicateFileStates(
  [
    { id: 1, audio: path.resolve('._song.flac') },
    { id: 2, audio: path.resolve('__MACOSX', 'song.wav') }
  ],
  () => {},
  undefined,
  {
    stat: async () => {
      sidecarStats++
      return stat
    }
  }
)
assert.equal(sidecarStats, 0)
assert.equal(sidecars.skipped.length, 2)
assert.ok(sidecars.skipped.every((file) => file.reason === 'sidecar'))
const controller = new AbortController()
let started = 0
const releases = []
const cancelProgress = []
const running = checkDuplicateFileStates(
  songs,
  (value) => cancelProgress.push(value),
  controller.signal,
  {
    stat: async () => {
      started++
      await new Promise((resolve) => releases.push(resolve))
      return stat
    }
  }
)
const rejected = assert.rejects(running)
await delay(10)
assert.equal(started, 8)
controller.abort(new Error('cancelled'))
const beforeCancel = cancelProgress.length
releases.forEach((release) => release())
await rejected
assert.equal(started, 8, 'cancellation cannot schedule more files')
assert.equal(cancelProgress.length, beforeCancel, 'cancelled workers cannot send stale progress')

playback.setPlaybackOnly(true)
let pausedCalls = 0
const pauseProgress = []
const paused = checkDuplicateFileStates(
  songs.slice(0, 2),
  (value) => pauseProgress.push(value),
  undefined,
  {
    stat: async () => {
      pausedCalls++
      return stat
    }
  }
)
await delay(10)
assert.equal(pausedCalls, 0)
assert.equal(pauseProgress[0].waitingForPlayback, true)
playback.setPlaybackOnly(false)
await paused
assert.equal(pausedCalls, 2)

const slowProgress = []
const slow = await checkDuplicateFileStates(
  songs.slice(0, 1),
  (value) => slowProgress.push(value),
  undefined,
  {
    stat: async () => {
      await delay(1100)
      return stat
    }
  }
)
assert.equal(slow.slowFiles.length, 1)
assert.ok(
  slowProgress.some((value) => value.activeChecks === 1 && value.currentPath === songs[0].audio),
  'waiting checks report the active path even when no files complete'
)
assert.ok(slow.slowFiles[0].elapsedMs >= 1000)
const after = slowProgress.length
await delay(50)
assert.equal(slowProgress.length, after)

// Controlled I/O latency proves overlap without assuming a particular disk speed.
const synthetic = songs.slice(0, 64)
const times = []
for (const concurrency of [1, 8]) {
  const begin = performance.now()
  await checkDuplicateFileStates(synthetic, () => {}, undefined, {
    concurrency,
    stat: async () => {
      await delay(3)
      return stat
    }
  })
  times.push(performance.now() - begin)
}
assert.ok(times[1] < times[0] * 0.6, 'bounded parallel checks should overlap I/O waits')
console.log(
  `File checking tests passed: 8-request bound, stable order/deduplication, inaccessible files, monotonic progress, cancellation drain, playback pause, slow-path diagnostics. Controlled I/O: ${times[0].toFixed(1)}ms serial / ${times[1].toFixed(1)}ms parallel.`
)

if (process.argv.includes('--benchmark')) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ep-check-bench-'))
  try {
    const fixtures = Array.from({ length: 4000 }, (_, id) => ({
      id,
      audio: path.join(temporary, `${id}.flac`)
    }))
    for (let offset = 0; offset < fixtures.length; offset += 64)
      await Promise.all(
        fixtures.slice(offset, offset + 64).map((song) => fs.writeFile(song.audio, 'fixture'))
      )
    await checkDuplicateFileStates(fixtures, () => {})
    const results = []
    for (const concurrency of [1, 8]) {
      const begin = performance.now()
      const checked = await checkDuplicateFileStates(fixtures, () => {}, undefined, { concurrency })
      assert.equal(checked.files.length, 4000)
      results.push({ concurrency, elapsedMs: Number((performance.now() - begin).toFixed(1)) })
    }
    console.log(
      JSON.stringify({
        workload: '4000 local tiny files, warm metadata; excludes audio decoding',
        results
      })
    )
  } finally {
    assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()))
    assert.ok(path.basename(temporary).startsWith('ep-check-bench-'))
    await fs.rm(temporary, { recursive: true, force: true })
  }
}
