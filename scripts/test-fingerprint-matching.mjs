/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import ts from 'typescript'
import { build } from 'esbuild'

const require = createRequire(import.meta.url)
if (!process.versions.electron) {
  const result = spawnSync(
    require('electron'),
    [path.resolve('scripts/test-fingerprint-matching.mjs'), ...process.argv.slice(2)],
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
// Frozen pre-optimization scorer: equivalence oracle, including anchor limits and tie ordering.
function legacyCompare(a, b) {
  const frameSeconds = 4096 / 3 / 11025
  const offsets = new Map([[0, 0]])
  const anchors = new Map()
  for (let index = 0; index < a.data.length; index++) {
    const key = a.data[index] >>> 16
    const positions = anchors.get(key) ?? []
    if (positions.length <= 32) positions.push(index)
    anchors.set(key, positions)
  }
  for (let index = 0; index < b.data.length; index++) {
    const positions = anchors.get(b.data[index] >>> 16)
    if (!positions || positions.length > 32) continue
    for (const position of positions) {
      const offset = position - index
      if (Math.abs(offset * frameSeconds) <= 10) offsets.set(offset, (offsets.get(offset) ?? 0) + 1)
    }
  }
  let best = { score: 0, coverage: 0, offsetSeconds: 0, matched: false }
  for (const [offset] of [...offsets].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
    const startA = Math.max(0, offset),
      startB = Math.max(0, -offset)
    const count = Math.min(a.data.length - startA, b.data.length - startB)
    const coverage = count / Math.max(a.data.length, b.data.length)
    if (count < 100 || coverage < 0.85) continue
    let errors = 0
    for (let index = 0; index < count; index++) {
      let value = a.data[startA + index] ^ b.data[startB + index]
      value -= (value >>> 1) & 0x55555555
      value = (value & 0x33333333) + ((value >>> 2) & 0x33333333)
      errors += (((value + (value >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
    }
    const score = 1 - errors / (count * 32)
    if (score > best.score)
      best = { score, coverage, offsetSeconds: offset * frameSeconds, matched: score >= 0.9 }
  }
  return best
}
const playback = load('src/main/service/playbackMode.ts')
const matcher = load('src/main/service/audioFingerprintMatching.ts')
const engine = load('src/main/service/fingerprintMatchingEngine.ts', { './playbackMode': playback })
const { FingerprintComparisonWorker } = load('src/main/service/fingerprintComparisonWorker.ts')
const { createDuplicateAnalysisCache } = load('src/main/service/duplicateAnalysisCache.ts')
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ep-match-test-'))
const workerPath = path.join(temporary, 'worker.cjs')
let db, worker
let seed = 3781
function random() {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed
}
function fingerprint(length = 463, duration = 180) {
  return {
    duration,
    data: Array.from({ length }, () => {
      const value = random()
      return (((value % 2048) << 16) | (value >>> 16)) >>> 0
    })
  }
}
const plain = (value) => JSON.parse(JSON.stringify(value))
try {
  await build({
    entryPoints: ['src/main/service/fingerprintMatchWorker.ts'],
    outfile: workerPath,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node22'
  })
  for (let index = 0; index < 150; index++) {
    const a = fingerprint(index % 2 ? 463 : 948)
    let b
    if (index % 3 === 0) b = fingerprint(a.data.length)
    else {
      const shift = index % 2 ? index % 81 : -(index % 81)
      const data = [...a.data]
      if (shift > 0) {
        data.splice(0, shift)
        data.push(...Array.from({ length: shift }, random))
      } else if (shift < 0) {
        data.splice(data.length + shift)
        data.unshift(...Array.from({ length: -shift }, random))
      }
      b = {
        duration: a.duration,
        data: data.map((value, i) => (i % 17 ? value : (value ^ 3) >>> 0))
      }
    }
    assert.deepEqual(
      plain(
        matcher.comparePreparedFingerprints(
          matcher.prepareFingerprint(a),
          matcher.prepareFingerprint(b)
        )
      ),
      legacyCompare(a, b),
      'optimized scores, coverage, match and offset must preserve the legacy algorithm'
    )
  }
  for (const length of [100, 463, 948, 2000]) {
    const a = { duration: 180, data: Array(length).fill(0x12345678) }
    assert.deepEqual(
      plain(matcher.compareFingerprints(a, a)),
      legacyCompare(a, a),
      'repeated anchors retain the original cap and zero-offset tie'
    )
  }
  const count = process.argv.includes('--benchmark') ? 600 : 120
  const items = Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    sha256: (index + 1).toString(16).padStart(64, '0'),
    fingerprint: fingerprint(463, 180 + (index % 30) * 60)
  }))
  items[1].fingerprint = {
    duration: items[0].fingerprint.duration + 2,
    data: items[0].fingerprint.data.map((value, i) => (i % 13 ? value : (value ^ 3) >>> 0))
  }
  const byId = new Map(items.map((item) => [item.id, item]))
  const legacyStart = performance.now()
  const broadPairs = matcher.fingerprintCandidatePairs(items)
  const eligible = broadPairs.filter(
    ([a, b]) =>
      byId.get(a).sha256 !== byId.get(b).sha256 &&
      Math.abs(byId.get(a).fingerprint.duration - byId.get(b).fingerprint.duration) <= 10
  )
  const legacyIndexMs = performance.now() - legacyStart
  const streamed = []
  for await (const batch of matcher.fingerprintCandidateBatches(
    items,
    async () => {},
    () => {}
  )) {
    assert.ok(batch.length <= 128, 'candidate working batches are bounded')
    streamed.push(...batch)
  }
  const keys = (pairs) =>
    Array.from(pairs, (pair) =>
      Array.from(pair)
        .sort((a, b) => a - b)
        .join(':')
    ).sort()
  assert.deepEqual(
    keys(plain(streamed)),
    keys(eligible),
    'prefiltered streaming candidates must equal all previously eligible comparisons'
  )
  db = new (require('better-sqlite3'))(path.join(temporary, 'cache.sqlite'))
  db.pragma('journal_mode = WAL')
  const cache = createDuplicateAnalysisCache(db)
  let bulkReads = 0,
    bulkWrites = 0
  const measuredCache = {
    ...cache,
    getMany: (...args) => {
      bulkReads++
      return cache.getMany(...args)
    },
    setMany: (...args) => {
      bulkWrites++
      return cache.setMany(...args)
    }
  }
  const legacyPairs = []
  const scoreStarted = performance.now()
  for (const [a, b] of eligible) {
    const ordered = byId.get(a).sha256 < byId.get(b).sha256 ? [a, b] : [b, a]
    const score = legacyCompare(byId.get(ordered[0]).fingerprint, byId.get(ordered[1]).fingerprint)
    if (score.matched)
      legacyPairs.push({
        a,
        b,
        score: score.score,
        coverage: score.coverage,
        offsetSeconds: Math.abs(score.offsetSeconds)
      })
  }
  const legacyScoringMs = performance.now() - scoreStarted
  const progress = []
  let ticks = 0
  const timer = setInterval(() => ticks++, 5)
  const optimizedStart = performance.now()
  let result
  try {
    result = await engine.matchFingerprintFiles(items, {
      version: matcher.fingerprintVersion(),
      cache: measuredCache,
      progress: (value) => progress.push(plain(value)),
      compareBatch: async (all, pairs, signal) => {
        worker ??= new FingerprintComparisonWorker(all, signal, workerPath)
        return worker.compare(pairs)
      }
    })
  } finally {
    clearInterval(timer)
    await worker?.close()
    worker = undefined
  }
  const optimizedMs = performance.now() - optimizedStart
  const normalized = (pairs) =>
    plain(pairs)
      .map((pair) => ({ ...pair, key: [pair.a, pair.b].sort((a, b) => a - b).join(':') }))
      .sort((a, b) => a.key.localeCompare(b.key))
  assert.deepEqual(
    normalized(result.pairs),
    normalized(legacyPairs),
    'the real Worker must preserve every legacy positive match and evidence'
  )
  assert.equal(result.stats.candidatePairs, eligible.length)
  assert.equal(result.stats.comparisons, eligible.length)
  assert.ok(ticks > 0, 'the main event loop must stay responsive while matching')
  assert.ok(progress.some((value) => value.phase === 'indexing'))
  const matchingProgress = progress.filter((value) => value.phase === 'matching')
  assert.ok(
    matchingProgress.every(
      (value, index) => !index || value.current >= matchingProgress[index - 1].current
    )
  )
  assert.ok(
    bulkReads > 0 && bulkWrites > 0 && bulkWrites <= Math.ceil(eligible.length / 128),
    'persistent cache I/O must be batched'
  )
  const warm = await engine.matchFingerprintFiles(items, {
    version: matcher.fingerprintVersion(),
    cache,
    compareBatch: async () => {
      throw new Error('Cached comparisons must not start a worker')
    }
  })
  assert.equal(warm.stats.comparisons, 0)
  assert.equal(warm.stats.reusedPairs, eligible.length)
  assert.deepEqual(normalized(warm.pairs), normalized(result.pairs))
  const controller = new AbortController()
  worker = new FingerprintComparisonWorker(items, controller.signal, workerPath)
  const cancelled = assert.rejects(worker.compare(Array(1000).fill([1, 2])))
  controller.abort()
  await cancelled
  await worker.close()
  worker = undefined
  const indexCancel = new AbortController()
  await assert.rejects(
    engine.matchFingerprintFiles(
      items,
      {
        version: matcher.fingerprintVersion(),
        progress: (value) => {
          if (value.phase === 'indexing' && value.current > 0) indexCancel.abort()
        }
      },
      indexCancel.signal
    )
  )
  playback.setPlaybackOnly(true)
  const pausedCancel = new AbortController()
  const paused = engine.matchFingerprintFiles(
    items,
    { version: matcher.fingerprintVersion() },
    pausedCancel.signal
  )
  pausedCancel.abort()
  await assert.rejects(paused)
  playback.setPlaybackOnly(false)
  if (process.argv.includes('--benchmark')) {
    const legacyWriteStart = performance.now()
    for (let index = 0; index < eligible.length; index++)
      cache.set('legacy-benchmark', String(index), {
        matched: false,
        score: 0.6,
        coverage: 1,
        offsetSeconds: 0
      })
    const legacyCacheWritesMs = performance.now() - legacyWriteStart
    const summary = {
      description:
        '600 synthetic 60-second fingerprints across 30 duration buckets; same eligibility and exact matching rules; legacy candidate/scoring + per-row SQLite WAL commits vs streaming + real Worker + batched cache commits.',
      files: items.length,
      broadCandidatePairs: broadPairs.length,
      eligibleComparisons: eligible.length,
      legacyIndexMs: Math.round(legacyIndexMs),
      legacyScoringMs: Math.round(legacyScoringMs),
      legacyCacheWritesMs: Math.round(legacyCacheWritesMs),
      legacyTotalMs: Math.round(legacyIndexMs + legacyScoringMs + legacyCacheWritesMs),
      optimizedWorkerAndCacheMs: Math.round(optimizedMs),
      speedup: Number(
        ((legacyIndexMs + legacyScoringMs + legacyCacheWritesMs) / optimizedMs).toFixed(2)
      ),
      bulkCacheReads: bulkReads,
      bulkCacheWrites: bulkWrites
    }
    await fs.mkdir(path.resolve('build'), { recursive: true })
    await fs.writeFile(
      path.resolve('build/fingerprint-matching-benchmark.json'),
      JSON.stringify(summary, null, 2) + '\n'
    )
    console.log(JSON.stringify(summary, null, 2))
  }
  console.log(
    'Fingerprint matching tests passed: legacy score/offset equivalence, duration-prefiltered candidate equivalence, actual Worker results, batched cache, warm reuse, progress, cancellation and paused cancellation.'
  )
} finally {
  playback.setPlaybackOnly(false)
  await worker?.close()
  db?.close()
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()))
  assert.ok(path.basename(temporary).startsWith('ep-match-test-'))
  await fs.rm(temporary, { recursive: true, force: true })
}
