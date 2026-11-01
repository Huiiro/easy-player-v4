/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import ts from 'typescript'
import { performance } from 'node:perf_hooks'

const require = createRequire(import.meta.url)
if (!process.versions.electron) {
  const result = spawnSync(
    require('electron'),
    [path.resolve('scripts/test-duplicate-cache.mjs'), ...process.argv.slice(2)],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
      windowsHide: true
    }
  )
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
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
        setImmediate,
        require: (name) => {
          if (name in mocks) return mocks[name]
          if (!name.startsWith('.')) return require(name)
          const target = path.resolve(path.dirname(filename), name)
          return visit(existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'index.ts'))
        }
      },
      { filename }
    )
    return exports
  }
  return visit(file)
}
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ep-fingerprint-test-'))
const Database = require('better-sqlite3')
const { createDuplicateAnalysisCache } = load('src/main/service/duplicateAnalysisCache.ts')
const service = load('src/main/service/duplicateFileService.ts', {
  './playbackMode': { waitForBackgroundWork: async () => {} }
})
const tool = load('src/main/service/audioFingerprintService.ts', {
  './playbackMode': { waitForBackgroundWork: async () => {}, onPlaybackModeChanged: () => () => {} }
})
const matcher = load('src/main/service/audioFingerprintMatching.ts')
const pool = load('src/main/service/fingerprintTaskPool.ts')
const executable = path.resolve(
  'resources/lib/fpcalc',
  `${process.platform}-${process.arch}`,
  process.platform === 'win32' ? 'fpcalc.exe' : 'fpcalc'
)
const ffmpeg = path.resolve(
  'build/native-addon',
  process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
)
let db
function wav(seed) {
  const rate = 22050,
    seconds = 150,
    samples = rate * seconds
  const buffer = Buffer.alloc(44 + samples * 2)
  buffer.write('RIFF')
  buffer.writeUInt32LE(buffer.length - 8, 4)
  buffer.write('WAVEfmt ', 8)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(1, 22)
  buffer.writeUInt32LE(rate, 24)
  buffer.writeUInt32LE(rate * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(samples * 2, 40)
  const notes = []
  for (let beat = 0; beat < seconds * 4; beat++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    notes.push(45 + (seed % 28))
  }
  for (let index = 0; index < samples; index++) {
    const time = index / rate,
      beat = Math.floor(time * 4),
      phase = (time * 4) % 1
    const hz = 440 * 2 ** ((notes[beat] - 69) / 12)
    const sample =
      (Math.sin(2 * Math.PI * hz * time) * 0.35 +
        Math.sin(2 * Math.PI * hz * 1.5 * time) * 0.2 +
        Math.sin(2 * Math.PI * hz * 2 * time) * 0.1) *
      Math.exp(-phase * 2)
    buffer.writeInt16LE(Math.round(sample * 30000), 44 + index * 2)
  }
  return buffer
}
try {
  await tool.requireFingerprintTool(executable)
  const brokenAudio = path.join(temporary, 'broken-audio.flac')
  await fs.writeFile(brokenAudio, 'not an audio recording')
  await assert.rejects(
    tool.calculateAudioFingerprint(executable, brokenAudio),
    (error) => error.reason === 'decodeFailed' && error.exitCode !== 0 && !!error.stderr,
    'real fpcalc failures retain stderr and exit code'
  )
  const original = path.join(temporary, 'original.wav')
  const lossless = path.join(temporary, 'different-tags.flac')
  const lossy = path.join(temporary, 'different-name.m4a')
  const unrelated = path.join(temporary, 'unrelated.wav')
  await fs.writeFile(original, wav(123))
  await fs.writeFile(unrelated, wav(4567))
  for (const [file, codec] of [
    [lossless, 'flac'],
    [lossy, 'aac']
  ]) {
    const result = spawnSync(
      ffmpeg,
      ['-hide_banner', '-loglevel', 'error', '-i', original, '-c:a', codec, file],
      { windowsHide: true, encoding: 'utf8' }
    )
    assert.equal(result.status, 0, result.stderr)
  }
  const songs = [original, lossless, lossy, unrelated].map((audio, index) => ({
    id: index + 1,
    audio,
    title: `Different title ${index}`,
    artist: `Different artist ${index}`,
    album: null,
    duration: 150,
    format: path.extname(audio),
    bitrate: null,
    sampleRate: null,
    bitDepth: null
  }))
  const dbPath = path.join(temporary, 'cache.sqlite')
  db = new Database(dbPath)
  let cache = createDuplicateAnalysisCache(db)
  let calculations = 0
  let activeExtractions = 0
  let maximumExtractions = 0
  const extractedFingerprints = new Map()
  const extract = async (file, signal, sampleSeconds) => {
    calculations++
    activeExtractions++
    maximumExtractions = Math.max(maximumExtractions, activeExtractions)
    try {
      const result = await tool.calculateAudioFingerprint(executable, file, signal, sampleSeconds)
      extractedFingerprints.set(file, result)
      return result
    } finally {
      activeExtractions--
    }
  }
  const scan = (force = false, sampleSeconds = 60, concurrency = 2) =>
    service.detectDuplicateFiles(songs, () => {}, undefined, {
      deep: true,
      force,
      cache,
      sampleSeconds,
      concurrency,
      fingerprint: (file, signal) => extract(file, signal, sampleSeconds)
    })
  const first = await scan()
  assert.equal(calculations, 4)
  assert.equal(first.concurrency, 2)
  assert.equal(maximumExtractions, 2, 'default extraction must actually run two jobs concurrently')
  assert.equal(activeExtractions, 0)
  assert.equal(first.sampleSeconds, 60, 'default deep scans should analyze the first 60 seconds')
  assert.ok(first.timings.totalMs >= first.timings.fingerprintMs && first.timings.fingerprintMs > 0)
  assert.equal(first.fingerprintSkipped.length, 0)
  const { compatibleFingerprint } = load('src/main/service/fingerprintCompatibilityDecoder.ts', {
    './playbackMode': {
      waitForBackgroundWork: async () => {},
      onPlaybackModeChanged: () => () => {}
    }
  })
  const { FingerprintExtractionError } = load('src/main/service/fingerprintExtractionError.ts')
  const compatible = await compatibleFingerprint(
    ffmpeg,
    original,
    60,
    150,
    (wav) => tool.calculateAudioFingerprint(executable, wav),
    new FingerprintExtractionError('decodeFailed', 'unsupported input', 2)
  )
  assert.equal(compatible.duration, 150)
  assert.equal(compatible.notices.at(-1).reason, 'compatibilityDecode')
  assert.equal(
    matcher.compareFingerprints(extractedFingerprints.get(original), compatible).matched,
    true,
    'real FFmpeg fallback produces matching audio fingerprints'
  )

  const audioGroup = first.groups.find((group) => group.kind === 'audio')
  assert.ok(
    audioGroup,
    JSON.stringify(
      first.groups.map((group) => ({ kind: group.kind, ids: group.files.map((file) => file.id) }))
    )
  )
  assert.equal(
    audioGroup.files.map((file) => file.id).join(','),
    '1,2,3',
    'fingerprints must find same recording across lossless/lossy formats and unrelated tags'
  )
  assert.ok(audioGroup.audioMatch.score >= 0.9 && audioGroup.audioMatch.coverage >= 0.85)
  assert.ok(
    !audioGroup.files.some((file) => file.id === 4),
    'an unrelated recording must not be grouped'
  )
  const second = await scan(false, 60, 4)
  assert.equal(second.cacheHits.report, 1)
  assert.equal(
    second.concurrency,
    4,
    'report cache hits must reflect current scheduling without invalidating results'
  )
  assert.equal(
    second.timings.fingerprintMs,
    0,
    'cached reports should not show the previous extraction time'
  )
  assert.equal(calculations, 4, 'unchanged scans must reuse the full report')
  const expectedGroups = JSON.stringify(first.groups)
  for (const concurrency of [1, 2, 4, 99]) {
    let active = 0,
      maximum = 0
    const completed = []
    const result = await service.detectDuplicateFiles(
      songs,
      (progress) => {
        if (progress.phase === 'fingerprinting') completed.push(progress.current)
      },
      undefined,
      {
        deep: true,
        concurrency,
        fingerprint: async (file) => {
          active++
          maximum = Math.max(maximum, active)
          try {
            // Finish in a different order from the library to exercise deterministic grouping.
            await new Promise((resolve) =>
              setTimeout(resolve, 40 - songs.findIndex((song) => song.audio === file) * 8)
            )
            return extractedFingerprints.get(file)
          } finally {
            active--
          }
        }
      }
    )
    assert.equal(
      maximum,
      concurrency === 99 ? 2 : concurrency,
      'pool must enforce the chosen cap and normalize invalid values'
    )
    assert.equal(active, 0)
    assert.equal(
      JSON.stringify(result.groups),
      expectedGroups,
      'completion order must not change the comparison report'
    )
    assert.equal(completed.join(','), '0,1,2,3,4', 'parallel completion progress must be monotonic')
  }
  // Exercise cancellation and lightweight-mode pause with actual extraction subprocesses.
  const playback = load('src/main/service/playbackMode.ts')
  const controlledService = load('src/main/service/duplicateFileService.ts', {
    './playbackMode': playback
  })
  const controlledTool = load('src/main/service/audioFingerprintService.ts', {
    './playbackMode': playback
  })
  async function controlledRun(cancel) {
    const controller = new AbortController()
    let active = 0,
      started = 0,
      settled = false
    let ready
    const bothStarted = new Promise((resolve) => {
      ready = resolve
    })
    const run = controlledService.detectDuplicateFiles(songs, () => {}, controller.signal, {
      deep: true,
      concurrency: 2,
      fingerprint: async (file, signal) => {
        active++
        started++
        if (started === 2) ready()
        try {
          return await controlledTool.calculateAudioFingerprint(executable, file, signal)
        } finally {
          active--
        }
      }
    })
    const outcome = run.then(
      (value) => {
        settled = true
        return value
      },
      (error) => {
        settled = true
        throw error
      }
    )
    // Attach rejection handling before triggering cancellation.
    const rejected = cancel ? assert.rejects(outcome) : undefined
    try {
      await Promise.race([
        bothStarted,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Concurrent workers did not start')), 3000)
        )
      ])
      await new Promise(setImmediate)
      if (cancel) {
        controller.abort()
        await rejected
        assert.equal(started, 2, 'cancellation must not start pending tasks')
      } else {
        playback.setPlaybackOnly(true)
        await new Promise((resolve) => setTimeout(resolve, 50))
        assert.equal(started, 2, 'paused playback mode must not start queued extractions')
        assert.equal(
          settled,
          false,
          'paused extraction should wait for resume rather than skip files'
        )
        playback.setPlaybackOnly(false)
        const report = await outcome
        assert.equal(report.fingerprintSkipped.length, 0)
        assert.equal(started, 4)
        assert.equal(JSON.stringify(report.groups), expectedGroups)
      }
      assert.equal(active, 0, 'the scan must drain extraction subprocesses before settling')
    } finally {
      controller.abort()
      playback.setPlaybackOnly(false)
    }
  }
  await controlledRun(true)
  await controlledRun(false)
  songs[0].title = 'Metadata changed'
  const metadataChanged = await scan()
  assert.equal(metadataChanged.cacheHits.report, 0)
  assert.equal(metadataChanged.cacheHits.sha256, 4)
  assert.equal(metadataChanged.cacheHits.fingerprint, 4)
  assert.ok(
    metadataChanged.cacheHits.matches > 0,
    'pair scores should survive metadata-only changes'
  )
  assert.equal(calculations, 4)
  const stat = await fs.stat(original)
  const changed = await fs.readFile(original)
  changed[changed.length - 2] ^= 1
  await fs.writeFile(original, changed)
  await fs.utimes(original, stat.atime, stat.mtime)
  const fileChanged = await scan()
  assert.equal(
    fileChanged.cacheHits.sha256,
    3,
    'same-size edits with restored mtime must invalidate file cache via ctime'
  )
  assert.equal(fileChanged.cacheHits.fingerprint, 3)
  assert.equal(calculations, 5)
  db.close()
  db = new Database(dbPath)
  cache = createDuplicateAnalysisCache(db)
  const restarted = await scan()
  assert.equal(restarted.cacheHits.report, 1, 'analysis must persist across database reopen')
  assert.equal(calculations, 5)
  const forced = await scan(true)
  assert.equal(
    forced.cacheHits.sha256 +
      forced.cacheHits.fingerprint +
      forced.cacheHits.matches +
      forced.cacheHits.report,
    0
  )
  assert.equal(calculations, 9, 'force should bypass all cache layers')
  const longer = await scan(false, 120)
  assert.equal(longer.sampleSeconds, 120)
  assert.equal(longer.cacheHits.sha256, 4, 'changing sample length must reuse file SHA-256 values')
  assert.equal(
    longer.cacheHits.fingerprint + longer.cacheHits.matches + longer.cacheHits.report,
    0,
    '60s and 120s derived results must not be mixed'
  )
  assert.equal(calculations, 13)
  assert.equal(
    longer.groups
      .find((group) => group.kind === 'audio')
      .files.map((file) => file.id)
      .join(','),
    '1,2,3'
  )
  assert.equal((await scan(false, 120)).cacheHits.report, 1)
  assert.equal((await scan(false, 60)).cacheHits.report, 1)
  assert.equal(calculations, 13, 'switching lengths should preserve both cached reports')
  cache.clear()
  assert.equal(db.prepare('SELECT count(*) AS count FROM duplicate_analysis_cache').get().count, 0)
  // Matching accounts for start offsets rather than comparing encoded strings.
  const fingerprint = await tool.calculateAudioFingerprint(executable, original)
  const shifted = {
    duration: fingerprint.duration,
    data: [0x12345678, 0x87654321, ...fingerprint.data.slice(0, -2)]
  }
  assert.equal(matcher.compareFingerprints(fingerprint, shifted).matched, true)
  assert.deepEqual(
    JSON.parse(JSON.stringify(matcher.unpackFingerprint(matcher.packFingerprint(fingerprint)))),
    JSON.parse(JSON.stringify(fingerprint))
  )
  assert.equal(matcher.unpackFingerprint({ data: 'invalid', duration: 40 }), undefined)
  // Cleanup always rehashes live files instead of consulting cached scan conclusions.
  const cleanupReport = await scan()
  const target = cleanupReport.groups
    .find((group) => group.kind === 'audio')
    .files.find((file) => file.id === 2)
  const bytes = await fs.readFile(target.audio)
  bytes[bytes.length - 1] ^= 1
  await fs.writeFile(target.audio, bytes)
  await assert.rejects(
    service.validateDuplicateCleanup(cleanupReport, [2], (id) => ({
      audio: songs.find((song) => song.id === id).audio,
      sourceId: null
    })),
    /stale/
  )
  if (process.argv.includes('--benchmark')) {
    const records = { 60: [], 120: [] }
    const lengths = {}
    for (let round = 0; round < 3; round++) {
      for (const seconds of round % 2 ? [120, 60] : [60, 120]) {
        const started = performance.now()
        for (const file of [original, lossless, lossy]) {
          const result = await tool.calculateAudioFingerprint(executable, file, undefined, seconds)
          lengths[seconds] = result.data.length
        }
        records[seconds].push(performance.now() - started)
      }
    }
    const median = (values) => [...values].sort((a, b) => a - b)[1]
    const summary = {
      description:
        'Local fingerprint extraction only; three 150-second synthetic music recordings (WAV, FLAC, AAC); median of three batches; no fingerprint-cache reuse.',
      platform: `${process.platform}-${process.arch}`,
      cpu: os.cpus()[0].model,
      seconds60Ms: Math.round(median(records[60])),
      seconds120Ms: Math.round(median(records[120])),
      speedup: Number((median(records[120]) / median(records[60])).toFixed(2)),
      fingerprintFrames: lengths,
      firstDeepScanStagesMs: first.timings
    }
    assert.ok(
      lengths[60] < lengths[120] && lengths[60] < 500 && lengths[120] > 850,
      'the extraction limit must change the actual analyzed fingerprint length'
    )
    await fs.mkdir(path.resolve('build'), { recursive: true })
    await fs.writeFile(
      path.resolve('build/fingerprint-length-benchmark.json'),
      JSON.stringify(summary, null, 2) + '\n'
    )
    console.log(JSON.stringify(summary, null, 2))
    const tasks = Array.from({ length: 12 }, (_, index) => [original, lossless, lossy][index % 3])
    const parallelTimes = { 1: [], 2: [], 4: [] }
    for (let round = 0; round < 3; round++) {
      for (const concurrency of round % 2 ? [4, 2, 1] : [1, 2, 4]) {
        const started = performance.now()
        await pool.runFingerprintTasks(tasks, concurrency, async (file, _index, signal) => {
          await tool.calculateAudioFingerprint(executable, file, signal, 60)
        })
        parallelTimes[concurrency].push(performance.now() - started)
      }
    }
    const concurrentSummary = {
      description:
        'Fingerprint extraction only; 12 tasks cycling WAV/FLAC/AAC 150-second synthetic recordings; 60-second analysis; median of 3 batches; no fingerprint-cache reuse; OS file cache may be warm.',
      platform: `${process.platform}-${process.arch}`,
      cpu: os.cpus()[0].model,
      serialMs: Math.round(median(parallelTimes[1])),
      twoTasksMs: Math.round(median(parallelTimes[2])),
      fourTasksMs: Math.round(median(parallelTimes[4])),
      speedup2: Number((median(parallelTimes[1]) / median(parallelTimes[2])).toFixed(2)),
      speedup4: Number((median(parallelTimes[1]) / median(parallelTimes[4])).toFixed(2))
    }
    await fs.writeFile(
      path.resolve('build/fingerprint-concurrency-benchmark.json'),
      JSON.stringify(concurrentSummary, null, 2) + '\n'
    )
    console.log(JSON.stringify(concurrentSummary, null, 2))
  }
  console.log(
    'Audio fingerprint/cache tests passed: WAV/FLAC/AAC matching, unrelated recording rejection, offset alignment, compressed persistence, full-report reuse, SHA/fingerprint/pair reuse, file-change invalidation, force, clear, live cleanup verification.'
  )
} finally {
  db?.close()
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()))
  assert.ok(path.basename(temporary).startsWith('ep-fingerprint-test-'))
  await fs.rm(temporary, { recursive: true, force: true })
}
