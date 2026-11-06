/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync, existsSync, lstatSync, unlinkSync } from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { EventEmitter } from 'node:events'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

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

const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'ep-duplicate-test-'))
const playback = load('src/main/service/playbackMode.ts')
const service = load('src/main/service/duplicateFileService.ts', { './playbackMode': playback })
const songs = []
async function song(id, name, contents) {
  const audio = path.join(temporary, name)
  if (contents !== null) await fs.writeFile(audio, contents)
  const entry = {
    id,
    audio,
    title: `Title | row\nbreak ${id}`,
    artist: 'Singer',
    album: 'Album',
    duration: 120,
    format: 'FLAC',
    bitrate: 900,
    sampleRate: 44100,
    bitDepth: 16
  }
  songs.push(entry)
  return entry
}
const currentSong = (id) => {
  const entry = songs.find((song) => song.id === id)
  return entry && { audio: entry.audio, sourceId: null }
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
try {
  const contents = Buffer.alloc(128 * 1024, 42)
  await song(1, 'original.flac', contents)
  await song(2, 'renamed.flac', contents)
  await song(3, 'third.flac', contents)
  await song(4, 'same-size-different.flac', Buffer.alloc(contents.length, 43))
  await song(5, 'unique.mp3', 'unique-length')
  await song(6, 'missing.mp3', null)
  const empty = await song(7, 'empty.mp3', '')
  const snapshot = new Map(
    await Promise.all(
      songs
        .filter((song) => song.id !== 6)
        .map(async (song) => [
          song.audio,
          { bytes: await fs.readFile(song.audio), mtimeMs: lstatSync(song.audio).mtimeMs }
        ])
    )
  )
  const steps = []
  const report = await service.detectDuplicateFiles(songs, (step) => steps.push(step))
  assert.equal(report.groups.length, 1)
  assert.equal(report.groups[0].files.length, 3)
  assert.equal(report.groups[0].kind, 'exact')
  assert.equal(report.exactGroups, 1)
  assert.equal(report.similarGroups, 0)
  assert.equal(report.extraFiles, 2)
  assert.equal(report.extraBytes, contents.length * 2)
  assert.equal(report.hashed, 4, 'size-unique files should not be hashed')
  assert.equal(report.skipped.length, 2, 'missing and empty files must be reported')
  assert.ok(steps.some((step) => step.phase === 'checking'))
  assert.ok(steps.some((step) => step.phase === 'hashing'))
  for (const [audio, before] of snapshot) {
    assert.deepEqual(await fs.readFile(audio), before.bytes, 'scan must never alter file contents')
    assert.equal(
      lstatSync(audio).mtimeMs,
      before.mtimeMs,
      'scan must not alter file modification time'
    )
  }
  const markdown = service.duplicateReportMarkdown(report)
  assert.ok(markdown.includes(report.groups[0].hash) && markdown.includes(songs[1].audio))
  assert.ok(markdown.includes('Title \\| row break'), 'report must escape table metadata')
  assert.ok(
    markdown.includes('44100') && markdown.includes('FLAC'),
    'report includes audio quality fields'
  )
  assert.equal((await service.validateDuplicateCleanup(report, [2, 3], currentSong)).length, 2)
  await assert.rejects(service.validateDuplicateCleanup(report, [1, 2, 3], currentSong), /invalid/)
  await assert.rejects(service.validateDuplicateCleanup(report, [999], currentSong), /invalid/)
  await assert.rejects(service.validateDuplicateCleanup(report, [], currentSong), /invalid/)
  await assert.rejects(
    service.validateDuplicateCleanup(report, [2], () => undefined),
    /stale/
  )
  const beforeMutation = lstatSync(songs[1].audio)
  await fs.writeFile(songs[1].audio, Buffer.alloc(contents.length, 99))
  await fs.utimes(songs[1].audio, beforeMutation.atime, beforeMutation.mtime)
  await assert.rejects(
    service.validateDuplicateCleanup(report, [2], currentSong),
    /stale/,
    'cleanup must rehash even same-size files'
  )
  await fs.writeFile(songs[1].audio, contents)
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(service.detectDuplicateFiles(songs, () => {}, aborted.signal))
  playback.setPlaybackOnly(true)
  const pausedAbort = new AbortController()
  const pausedScan = service.detectDuplicateFiles(songs, () => {}, pausedAbort.signal)
  await delay(20)
  pausedAbort.abort()
  await Promise.race([
    assert.rejects(pausedScan),
    delay(500).then(() => {
      throw new Error('Paused scan cancellation timed out')
    })
  ])
  playback.setPlaybackOnly(false)

  const variantA = await song(8, 'variant.mp3', Buffer.alloc(1234, 8))
  Object.assign(variantA, {
    title: 'Song - Name',
    artist: 'Alice / Bob',
    duration: 180,
    format: 'MP3',
    bitrate: 192
  })
  const variantB = await song(9, 'variant.flac', Buffer.alloc(2345, 9))
  Object.assign(variantB, {
    title: ' SONG — NAME ',
    artist: 'Bob；Alice',
    duration: 182,
    format: 'FLAC',
    bitrate: 900
  })
  const live = await song(10, 'live.mp3', Buffer.alloc(1111, 10))
  Object.assign(live, { title: 'Song Name (Live)', artist: 'Alice / Bob', duration: 180 })
  const cover = await song(11, 'cover.mp3', Buffer.alloc(1112, 11))
  Object.assign(cover, { title: 'Song Name', artist: 'Other Artist', duration: 180 })
  const unknown = await song(12, 'unknown.mp3', Buffer.alloc(1113, 12))
  Object.assign(unknown, { title: 'Song Name', artist: 'Unknown Artist', duration: 180 })
  const farDuration = await song(13, 'extended.mp3', Buffer.alloc(1114, 13))
  Object.assign(farDuration, { title: 'Song Name', artist: 'Alice / Bob', duration: 210 })
  const similarReport = await service.detectDuplicateFiles(songs)
  assert.equal(similarReport.exactGroups, 1)
  assert.equal(
    similarReport.similarGroups,
    1,
    'different encodings/size with nearby duration should be reported as similar'
  )
  const similarGroup = similarReport.groups.find((group) => group.kind === 'similar')
  assert.equal(similarGroup.files.map((file) => file.id).join(','), '8,9')
  assert.equal(similarGroup.durationSpread, 2)
  assert.equal(
    similarGroup.hash,
    undefined,
    'similarity must never claim matching full file hashes'
  )
  assert.notEqual(similarGroup.files[0].sha256, similarGroup.files[1].sha256)
  assert.equal(
    (await service.validateDuplicateCleanup(similarReport, [9], currentSong))[0].id,
    9,
    'similar cleanup must validate each file against its own hash'
  )
  await assert.rejects(
    service.validateDuplicateCleanup(similarReport, [8, 9], currentSong),
    /invalid/
  )
  const similarMarkdown = service.duplicateReportMarkdown(similarReport)
  assert.ok(similarMarkdown.includes('疑似同曲') && !similarMarkdown.includes('review required'))
  const englishMarkdown = service.duplicateReportMarkdown(similarReport, 'en')
  assert.ok(
    englishMarkdown.includes('review required') && !/[\u4e00-\u9fff]/u.test(englishMarkdown),
    'English authored report contains no Chinese labels'
  )
  assert.ok(
    !similarMarkdown.includes('Duplicate file comparison report') &&
      !similarMarkdown.includes('checkingMs'),
    'Chinese report translates labels and metric keys'
  )
  for (const file of similarGroup.files) assert.ok(similarMarkdown.includes(file.sha256))
  const matching = load('src/main/service/duplicateSongMatching.ts')
  const chain = [100, 103, 106, 109].map((duration, index) => ({
    ...similarGroup.files[0],
    id: 20 + index,
    duration,
    sha256: String(index)
  }))
  const chainGroups = matching.buildDuplicateGroups(chain)
  assert.ok(
    chainGroups.every((group) => group.durationSpread <= 3),
    'near-duration matches must not form an unlimited transitive chain'
  )
  const mixedGroup = matching.buildDuplicateGroups([
    { ...similarGroup.files[0], id: 30, sha256: 'same' },
    { ...similarGroup.files[0], id: 31, sha256: 'same' },
    { ...similarGroup.files[1], id: 32, sha256: 'different' }
  ])
  assert.equal(
    mixedGroup.length,
    1,
    'exact copies plus a different encoding must produce one nonoverlapping group'
  )
  assert.equal(mixedGroup[0].files.length, 3)
  assert.equal(mixedGroup[0].kind, 'similar')

  // IPC tests call the actual scanner and validator; deletion is scoped to test fixtures.
  const handlers = new Map()
  const deletes = []
  const exclusions = []
  const notifications = []
  let exportPath
  let saveDialogs = 0
  const sender = Object.assign(new EventEmitter(), {
    id: 1,
    isDestroyed: () => false,
    send: (...args) => notifications.push(args)
  })
  const otherSender = Object.assign(new EventEmitter(), {
    id: 2,
    isDestroyed: () => false,
    send() {}
  })
  const ipc = load('src/main/ipc/duplicateFileIpcHandlers.ts', {
    '../service/duplicateAnalysisCache': {
      createDuplicateAnalysisCache: () => undefined,
      duplicateTaskCache: () => undefined
    },
    '../service/duplicateTaskStore': {
      createDuplicateTaskStore: () => ({
        load: () => ({ task: null, report: null, retainedIds: null }),
        replace() {},
        saveState() {},
        saveResult() {},
        saveSelection() {},
        clear() {}
      })
    },
    electron: {
      ipcMain: { handle: (name, fn) => handlers.set(name, fn) },
      BrowserWindow: {
        fromWebContents: () => null,
        getAllWindows: () => [{ webContents: sender }, { webContents: otherSender }]
      },
      dialog: {
        showSaveDialog: async () => {
          saveDialogs++
          return { canceled: !exportPath, filePath: exportPath }
        }
      }
    },
    '../database': {
      getDatabase: () => ({ prepare: () => ({ all: () => songs, get: currentSong }) })
    },
    '../database/repository/songs': {
      deleteSongs: (ids, deleteLocalFiles) => {
        deletes.push({ ids, deleteLocalFiles })
        if (deleteLocalFiles)
          for (const id of ids) {
            const target = currentSong(id).audio
            assert.equal(path.dirname(target), temporary)
            unlinkSync(target)
          }
        return {
          deleted: ids.length,
          deletedFiles: deleteLocalFiles ? ids.length : 0,
          failedFiles: []
        }
      }
    },
    '../service/libraryAutoImport': {
      excludeAutoImportFiles: (files) => exclusions.push(...files)
    },
    '../service/duplicateFileService': service,
    '../service/loggerService': { Logger: { warn() {} } },
    '../service/operationLogger': { logError: String }
  })
  ipc.registerDuplicateFileIpcHandlers()
  const invoke = (name, payload, from = sender) => handlers.get(name)({ sender: from }, payload)
  playback.setPlaybackOnly(true)
  const started = await invoke('library:start-duplicate-task', { deep: false })
  assert.equal(started.success, true)
  assert.equal(
    started.data.status,
    'running',
    'task start returns immediately before the scan finishes'
  )
  sender.emit('destroyed')
  assert.equal((await invoke('library:start-duplicate-task')).error, 'busy')
  playback.setPlaybackOnly(false)
  for (
    let attempt = 0;
    attempt < 100 && (await invoke('library:duplicate-task-state')).status === 'running';
    attempt++
  )
    await delay(10)
  assert.equal(
    (await invoke('library:duplicate-task-state')).status,
    'completed',
    'destroying the initiating renderer cannot cancel the task'
  )
  let scan = await invoke('library:detect-duplicates')
  assert.equal(scan.success, true)
  assert.equal(deletes.length, 0, 'detection and report generation must not delete library entries')
  assert.ok(notifications.some(([name]) => name === 'library:duplicate-progress'))
  const sharedDetails = await invoke('library:duplicate-task-details', undefined, otherSender)
  assert.equal(
    sharedDetails.report.id,
    scan.data.id,
    'application reports must survive the original window'
  )
  let result
  result = await invoke('library:clean-duplicates', {
    reportId: scan.data.id,
    songIds: [1, 2, 3],
    deleteLocalFiles: true
  })
  assert.equal(result.error, 'invalid')
  assert.equal(deletes.length, 0)
  result = await invoke('library:export-duplicate-report', scan.data.id)
  assert.equal(result.data, false)
  assert.equal(saveDialogs, 1)
  exportPath = path.join(temporary, 'report.md')
  result = await invoke('library:export-duplicate-report', scan.data.id)
  assert.equal(result.data, true)
  assert.ok((await fs.readFile(exportPath, 'utf8')).includes(scan.data.groups[0].hash))
  await handlers.get('library:export-duplicate-report')({ sender }, scan.data.id, 'en')
  assert.ok(
    (await fs.readFile(exportPath, 'utf8')).includes('Duplicate file comparison report'),
    'export IPC uses the requested UI language'
  )
  result = await invoke('library:clean-duplicates', {
    reportId: scan.data.id,
    songIds: [2],
    deleteLocalFiles: false
  })
  assert.equal(result.success, true)
  assert.equal(deletes[0].deleteLocalFiles, false)
  assert.ok(
    exclusions.includes(songs[1].audio),
    'library-only removal must be excluded from automatic reimport'
  )
  assert.deepEqual(
    await fs.readFile(songs[1].audio),
    contents,
    'library-only cleanup must retain the local file'
  )
  result = await invoke('library:clean-duplicates', {
    reportId: scan.data.id,
    songIds: [3],
    deleteLocalFiles: true
  })
  assert.equal(result.error, 'stale', 'reports must be invalidated after cleanup')
  scan = await invoke('library:detect-duplicates')
  result = await invoke('library:clean-duplicates', {
    reportId: scan.data.id,
    songIds: [3],
    deleteLocalFiles: true
  })
  assert.equal(result.success, true)
  assert.equal(deletes[1].deleteLocalFiles, true)
  assert.ok(!existsSync(songs[2].audio))
  assert.ok(
    existsSync(songs[0].audio) && existsSync(songs[1].audio),
    'cleanup must retain unselected files'
  )
  assert.ok(existsSync(empty.audio))
  console.log(
    'Duplicate file tests passed: read-only SHA-256 scan, report export, content differences, skipped files, cancellation, preserved copy, stale reports, application-owned reports, both cleanup modes, reimport exclusion.'
  )
} finally {
  playback.setPlaybackOnly(false)
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()))
  assert.ok(path.basename(temporary).startsWith('ep-duplicate-test-'))
  await fs.rm(temporary, { recursive: true, force: true })
}
