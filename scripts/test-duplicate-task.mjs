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

const require = createRequire(import.meta.url)
if (!process.versions.electron) {
  const result = spawnSync(
    require('electron'),
    [path.resolve('scripts/test-duplicate-task.mjs'), ...process.argv.slice(2)],
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
          return visit(existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'colors.ts'))
        }
      },
      { filename }
    )
    return exports
  }
  return visit(file)
}

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ep-duplicate-task-'))
const Database = require('better-sqlite3')
const { DuplicateScanTask } = load('src/main/service/duplicateScanTask.ts')
const { createDuplicateTaskStore } = load('src/main/service/duplicateTaskStore.ts')
const { createDuplicateAnalysisCache, duplicateTaskCache } = load(
  'src/main/service/duplicateAnalysisCache.ts'
)
const scanner = load('src/main/service/duplicateFileService.ts', {
  './playbackMode': { waitForBackgroundWork: async () => {} }
})
const dbPath = path.join(temporary, 'task.db')
let db = new Database(dbPath)
const songs = []
for (let id = 1; id <= 4; id++) {
  const audio = path.join(temporary, `${id}.flac`)
  await fs.writeFile(audio, Buffer.alloc(512 * 1024, 42))
  songs.push({
    id,
    audio,
    title: 'Same song',
    artist: 'Artist',
    album: 'Album',
    duration: 60,
    format: 'FLAC',
    bitrate: 900,
    sampleRate: 44100,
    bitDepth: 16
  })
}
const noop = () => {}
try {
  let interrupted = false
  let first
  first = new DuplicateScanTask({
    store: createDuplicateTaskStore(db),
    changed: noop,
    run: (options, progress, signal, taskId) =>
      scanner.detectDuplicateFiles(
        songs,
        (value) => {
          progress(value)
          if (value.phase === 'hashing' && value.current === 1 && !interrupted) {
            interrupted = true
            first.shutdown()
            // The real shutdown path closes SQLite before the async run drains.
            db.close()
          }
        },
        signal,
        { cache: duplicateTaskCache(createDuplicateAnalysisCache(db), taskId, options.force) }
      )
  })
  const original = first.start({ force: true, concurrency: 4, sampleSeconds: 120 })
  assert.throws(() => first.start(), /busy/, 'one application task at a time')
  await first.wait()
  assert.equal(interrupted, true)
  db = new Database(dbPath)
  let details = createDuplicateTaskStore(db).load()
  assert.equal(details.task.status, 'interrupted')
  assert.equal(details.task.progress.current, 1, 'shutdown saves latest progress synchronously')
  assert.equal(
    details.task.settling,
    false,
    'previous process draining state must not survive restart'
  )
  assert.equal(details.report, null)
  let runs = 0
  const restored = new DuplicateScanTask({
    store: createDuplicateTaskStore(db),
    changed: noop,
    run: (options, progress, signal, taskId) => {
      runs++
      assert.equal(taskId, original.id)
      assert.equal(options.force, true)
      assert.equal(options.sampleSeconds, 120)
      return scanner.detectDuplicateFiles(songs, progress, signal, {
        cache: duplicateTaskCache(createDuplicateAnalysisCache(db), taskId, options.force)
      })
    }
  })
  restored.restore()
  assert.equal(restored.getState().recovering, true)
  await restored.wait()
  details = restored.getDetails()
  assert.equal(runs, 1)
  assert.equal(details.task.status, 'completed')
  assert.equal(details.task.resumeCount, 1)
  assert.equal(
    details.report.cacheHits.sha256,
    1,
    'a resumed forced job reuses its own completed hashes'
  )
  assert.equal(details.report.groups.length, 1)
  assert.equal(details.report.groups[0].files.length, 4)
  const reportId = details.report.id
  assert.throws(() => restored.saveSelection(reportId, []), /invalid/)
  assert.throws(() => restored.saveSelection(reportId, [999]), /invalid/)
  restored.saveSelection(reportId, [2])
  restored.shutdown()
  db.close()
  db = new Database(dbPath)
  const completed = new DuplicateScanTask({
    store: createDuplicateTaskStore(db),
    changed: noop,
    run: async () => {
      throw new Error('completed report should not scan again')
    }
  })
  completed.restore()
  assert.equal(completed.busy, false)
  assert.equal(completed.getDetails().report.id, reportId)
  assert.deepEqual(Array.from(completed.getDetails().retainedIds), [2])
  createDuplicateAnalysisCache(db).clear()
  assert.equal(
    createDuplicateTaskStore(db).load().report.id,
    reportId,
    'clearing derived caches preserves reports and user decisions'
  )
  // Independent force jobs ignore global cache, but same-job resume uses batch checkpoints.
  const cache = createDuplicateAnalysisCache(db)
  cache.set('match', 'old', { matched: true })
  const scoped = duplicateTaskCache(cache, 'force-a', true)
  assert.equal(scoped.get('match', 'old'), undefined)
  scoped.setMany('match', [
    { key: 'p1', value: { matched: false } },
    { key: 'p2', value: { matched: true } }
  ])
  assert.equal(duplicateTaskCache(cache, 'force-a', true).getMany('match', ['p1', 'p2']).size, 2)
  assert.equal(duplicateTaskCache(cache, 'force-b', true).get('match', 'p1'), undefined)
  assert.equal(cache.get('match', 'p1').matched, false)

  // Resume a deep forced scan; a changed completed file must be recomputed.
  for (const [index, song] of songs.entries())
    await fs.writeFile(song.audio, Buffer.alloc(64 * 1024, index + 1))
  let fpCalls = 0,
    deepInterrupted = false,
    deepTask
  const fingerprint = {
    duration: 60,
    data: Array.from({ length: 200 }, (_, index) => Math.imul(index + 1, 2654435761) >>> 0)
  }
  const deepRun = (options, progress, signal, taskId) =>
    scanner.detectDuplicateFiles(
      songs,
      (value) => {
        progress(value)
        if (value.phase === 'fingerprinting' && value.current === 2 && !deepInterrupted) {
          deepInterrupted = true
          deepTask.shutdown()
          db.close()
        }
      },
      signal,
      {
        deep: true,
        concurrency: 1,
        cache: duplicateTaskCache(createDuplicateAnalysisCache(db), taskId, options.force),
        fingerprint: async () => {
          fpCalls++
          return fingerprint
        }
      }
    )
  deepTask = new DuplicateScanTask({
    store: createDuplicateTaskStore(db),
    changed: noop,
    run: deepRun
  })
  deepTask.start({ deep: true, force: true, concurrency: 1 })
  await deepTask.wait()
  assert.equal(fpCalls, 2)
  await fs.writeFile(songs[0].audio, Buffer.alloc(64 * 1024, 77))
  db = new Database(dbPath)
  deepTask = new DuplicateScanTask({
    store: createDuplicateTaskStore(db),
    changed: noop,
    run: deepRun
  })
  deepTask.restore()
  await deepTask.wait()
  const deepReport = deepTask.getDetails().report
  assert.equal(deepTask.getState().status, 'completed')
  assert.equal(deepReport.cacheHits.sha256, 3)
  assert.equal(deepReport.cacheHits.fingerprint, 1, 'reuse completed unchanged fingerprints only')
  assert.equal(fpCalls, 5, 'changed file plus unfinished files are extracted after restart')
  assert.ok(deepReport.matchingStats.comparisons > 0)
  assert.equal(deepReport.audioGroups, 1)
  // Pause drains work before allowing resume, and an explicit pause survives restart.
  let runnerSignal, emitProgress, release
  const paused = new DuplicateScanTask({
    store: createDuplicateTaskStore(db),
    changed: noop,
    run: async (_options, progress, signal) => {
      runnerSignal = signal
      emitProgress = progress
      progress({ phase: 'matching', current: 9, total: 40, comparedPairs: 128 })
      await new Promise((resolve) => {
        release = resolve
      })
      signal.throwIfAborted()
      return details.report
    }
  })
  paused.start({ deep: true })
  await Promise.resolve()
  paused.pause()
  assert.equal(runnerSignal.aborted, true)
  assert.equal(paused.getState().status, 'paused')
  assert.equal(paused.getState().settling, true)
  assert.throws(() => paused.resume(), /busy/)
  emitProgress({ phase: 'matching', current: 40, total: 40 })
  assert.equal(
    paused.getState().progress.current,
    9,
    'late worker progress cannot advance a paused task'
  )
  paused.shutdown()
  db.close()
  release()
  await paused.wait()
  db = new Database(dbPath)
  const afterPause = new DuplicateScanTask({
    store: createDuplicateTaskStore(db),
    changed: noop,
    run: async () => details.report
  })
  afterPause.restore()
  assert.equal(afterPause.busy, false, 'explicitly paused tasks do not auto resume on launch')
  assert.equal(afterPause.getState().status, 'paused')
  assert.equal(afterPause.getState().settling, false)
  afterPause.resume()
  await afterPause.wait()
  assert.equal(afterPause.getState().status, 'completed')

  // Sudden process loss leaves status running; startup restores it too.
  const store = createDuplicateTaskStore(db)
  store.replace({
    ...original,
    status: 'running',
    progress: { phase: 'fingerprinting', current: 2, total: 4 }
  })
  let crashResumes = 0
  const crashed = new DuplicateScanTask({
    store,
    changed: noop,
    run: async () => {
      crashResumes++
      return details.report
    }
  })
  crashed.restore()
  await crashed.wait()
  assert.equal(crashResumes, 1)
  assert.equal(crashed.getState().status, 'completed')

  // Synchronous runner failures must release the task slot.
  const failed = new DuplicateScanTask({
    store,
    changed: noop,
    run: () => {
      throw new Error('fingerprintMissing')
    }
  })
  failed.start({ deep: true })
  await failed.wait()
  assert.equal(failed.busy, false)
  assert.equal(failed.getState().error, 'fingerprintMissing')
  failed.resume()
  await failed.wait()
  assert.equal(failed.busy, false)
  // Quitting before the scheduled run begins must never touch the closed database.
  let lateRuns = 0
  const immediateQuit = new DuplicateScanTask({
    store,
    changed: noop,
    run: async () => {
      lateRuns++
      return details.report
    }
  })
  immediateQuit.start()
  immediateQuit.shutdown()
  db.close()
  await immediateQuit.wait()
  assert.equal(lateRuns, 0)
  for (const song of songs)
    assert.equal(
      (await fs.stat(song.audio)).size,
      64 * 1024,
      'all detection/resume paths preserve audio files'
    )
  console.log(
    'Duplicate task tests passed: real SQLite restart, interrupted forced-scan checkpoints, report and choices persistence, batch cache isolation, pause draining, crash recovery, immediate quit and no file operations.'
  )
} finally {
  if (db.open) db.close()
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()))
  assert.ok(path.basename(temporary).startsWith('ep-duplicate-task-'))
  await fs.rm(temporary, { recursive: true, force: true })
}
