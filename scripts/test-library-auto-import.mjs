/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
function load(file, mocks = {}) {
  const exports = {}
  const filename = path.resolve(file)
  const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText
  vm.runInNewContext(
    code,
    {
      exports,
      process,
      console,
      Buffer,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      require: (name) => {
        if (name in mocks) return mocks[name]
        if (name.startsWith('.')) {
          const target = path.resolve(path.dirname(filename), name)
          return load(
            existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'index.ts'),
            mocks
          )
        }
        return require(name)
      }
    },
    { filename }
  )
  return exports
}

const { MusicFolderWatcher } = load('src/main/service/musicFolderWatcher.ts')
const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'easy-player-auto-import-'))
const root = path.join(temporary, 'music')
const known = new Set()
const imports = []
const errors = []
let paused = false
let inFlight = 0
let maxInFlight = 0
let watcher
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function until(check, label) {
  const deadline = Date.now() + 6000
  while (!check()) {
    assert.ok(Date.now() < deadline, `Timed out: ${label}`)
    await delay(20)
  }
}
function createWatcher(extra = {}) {
  return new MusicFolderWatcher({
    extensions: ['.mp3', '.flac'],
    knownFiles: () => new Set(known),
    isPaused: () => paused,
    debounceMs: 20,
    stabilityMs: 120,
    reconcileMs: 60_000,
    onError: (error) => errors.push(error),
    importFiles: async (directory, files, active) => {
      assert.equal(directory, root)
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await delay(30)
      if (active())
        for (const file of files) {
          assert.ok(!known.has(file), 'must not reimport known songs')
          imports.push({ file, content: await fs.readFile(file, 'utf8') })
          known.add(file)
        }
      inFlight--
      return true
    },
    ...extra
  })
}

try {
  await fs.mkdir(root)
  const existing = path.join(root, 'existing.mp3')
  await fs.writeFile(existing, 'already imported')
  known.add(existing)
  watcher = createWatcher()
  watcher.setDirectories([root, path.join(root, 'album'), root])
  await delay(100)
  assert.equal(imports.length, 0)

  const copied = path.join(root, 'copied.MP3')
  await fs.writeFile(copied, 'part1')
  await delay(60)
  await fs.appendFile(copied, '-part2')
  await delay(60)
  assert.equal(imports.length, 0, 'must wait for copy stability')
  await until(() => known.has(copied), 'copy import')
  assert.equal(imports[0].content, 'part1-part2')

  const album = path.join(root, 'album', 'disc1')
  await fs.mkdir(album, { recursive: true })
  const nested = path.join(album, 'nested.flac')
  await fs.writeFile(nested, 'nested audio')
  await fs.writeFile(path.join(album, 'cover.jpg'), 'not audio')
  await fs.writeFile(path.join(root, 'empty.mp3'), '')
  await until(() => known.has(nested), 'new nested directory')
  assert.equal(imports.length, 2)

  paused = true
  const deferred = path.join(root, 'paused.mp3')
  await fs.writeFile(deferred, 'deferred')
  await delay(300)
  assert.ok(!known.has(deferred))
  paused = false
  await until(() => known.has(deferred), 'resume background work')
  await delay(250)
  assert.equal(imports.length, 3, 'notifications/reconciliation must not duplicate imports')
  assert.equal(maxInFlight, 1, 'imports must run serially')
  watcher.stop()

  const offline = path.join(root, 'offline.mp3')
  await fs.writeFile(offline, 'added while stopped')
  await delay(220)
  assert.ok(!known.has(offline))
  watcher = createWatcher()
  watcher.setDirectories([root])
  await until(() => known.has(offline), 'startup catch-up')
  watcher.setDirectories([])
  const removed = path.join(root, 'removed.mp3')
  await fs.writeFile(removed, 'unwatched')
  await delay(300)
  assert.ok(!known.has(removed), 'removed roots must stop importing')
  watcher.stop()

  watcher = createWatcher({ ignoredDirectories: [album] })
  watcher.setDirectories([root])
  const excluded = path.join(album, 'excluded.mp3')
  await fs.writeFile(excluded, 'excluded')
  await until(() => known.has(removed), 'remaining directory import')
  await delay(220)
  assert.ok(!known.has(excluded), 'removed library subfolders must stay excluded')
  watcher.stop()
  assert.equal(errors.length, 0, errors.map(String).join('\n'))

  // A missing/removable root must recover on periodic reconciliation.
  const removable = path.join(temporary, 'removable')
  let recovered = false
  watcher = createWatcher({
    reconcileMs: 80,
    onError: () => {},
    importFiles: async (_root, files) => {
      recovered = files.some((file) => path.basename(file) === 'returned.mp3')
      return true
    }
  })
  watcher.setDirectories([removable])
  await delay(100)
  await fs.mkdir(removable)
  await fs.writeFile(path.join(removable, 'returned.mp3'), 'reconnected')
  await until(() => recovered, 'missing root recovery')
  watcher.stop()

  // Verify actual scan selection, deduplication, duration filtering, and cancellation.
  const stored = new Set()
  let parsed = 0
  let active = true
  const db = {
    prepare(sql) {
      return {
        get(file) {
          if (sql.includes('FROM folder')) return { id: 1 }
          if (sql.includes('is_newest')) return { present: 1 }
          return stored.has(file) ? { present: 1 } : undefined
        },
        run(song) {
          stored.add(song.audio)
          return { changes: 1 }
        }
      }
    }
  }
  let duration = 30
  let cancelDuringParse = false
  const { scanMusicDirectory } = load('src/main/service/scanService.ts', {
    '../database': {
      getDatabase: () => {
        assert.ok(active)
        return db
      }
    },
    './audioMetadataService': {
      parseAudioFile: async () => {
        parsed++
        if (cancelDuringParse) active = false
        return { common: { track: {}, disk: {} }, format: { duration } }
      }
    },
    '../i18n': { t: (key) => key },
    './playbackMode': { waitForBackgroundWork: async () => {} },
    './operationLogger': { logOperation: (_name, _params, task) => task(), logError: String },
    './loggerService': { Logger: { debug() {}, warn() {} } },
    '../utils/pathUtils': { getCoverPath: () => path.join(temporary, 'covers') },
    '../database/newestSongs': { refreshNewestSongs() {} }
  })
  let result = await scanMusicDirectory(root, undefined, [
    nested,
    path.join(temporary, 'outside.mp3')
  ])
  assert.equal(result.added, 1, 'nested selections must import under their watched root')
  assert.equal(result.total, 1, 'paths outside the root must be rejected')
  result = await scanMusicDirectory(root, undefined, [nested])
  assert.equal(result.duplicates, 1)
  assert.equal(parsed, 1, 'duplicates must not parse metadata again')
  duration = 2
  result = await scanMusicDirectory(root, undefined, [copied])
  assert.equal(result.skipped, 1)
  duration = 30
  cancelDuringParse = true
  result = await scanMusicDirectory(root, undefined, [copied], false, {
    background: true,
    shouldContinue: () => active
  })
  assert.equal(result.added, 0, 'stopping during metadata parsing must prevent database writes')
  assert.ok(!stored.has(copied))

  // Check persisted folders, exclusions, settings changes, and fresh-process restoration.
  const settings = new Map()
  const instances = []
  class FakeWatcher {
    constructor(options) {
      this.options = options
      instances.push(this)
    }
    setDirectories(directories) {
      this.directories = [...directories]
    }
    stop() {
      this.stopped = true
    }
  }
  const controllerMocks = {
    electron: {
      BrowserWindow: {
        getAllWindows: () => [
          { isDestroyed: () => false, webContents: { send: (...args) => notifications.push(args) } }
        ]
      }
    },
    '../database': {
      getDatabase: () => ({ prepare: () => ({ all: () => [{ full_path: root }] }) })
    },
    '../database/repository/settings': {
      getAppSetting: (key) => settings.get(key) ?? null,
      setAppSetting: (key, value) => settings.set(key, structuredClone(value))
    },
    './musicFolderWatcher': { MusicFolderWatcher: FakeWatcher },
    './scanService': {
      SUPPORTED_EXTENSIONS: ['.mp3'],
      scanMusicDirectory: async () => ({
        added: notificationCount,
        duplicates: 0,
        skipped: 0,
        total: notificationCount
      })
    },
    './playbackMode': { isPlaybackOnly: () => false },
    './loggerService': { Logger: { warn() {} } },
    './operationLogger': { logError: String }
  }
  const notifications = []
  let notificationCount = 2
  let controller = load('src/main/service/libraryAutoImport.ts', controllerMocks)
  controller.configureLibraryAutoImport({ enabled: true, ignoreShortSongs: true })
  await instances.at(-1).options.importFiles(root, [copied], () => true)
  assert.equal(notifications[0][0], 'library:auto-imported')
  assert.equal(
    notifications[0][1].added,
    2,
    'notification payload must contain the added song count'
  )
  assert.equal(notifications[0][1].directory, root)
  notificationCount = 0
  await instances.at(-1).options.importFiles(root, [copied], () => true)
  assert.equal(notifications.length, 1, 'no notification should be sent when no songs were added')
  assert.ok(
    instances.at(-1).directories.includes(root),
    'existing imported roots should be watched'
  )
  const empty = path.join(temporary, 'empty-library-folder')
  controller.trackMusicDirectory(empty)
  assert.ok(
    settings.get('library.autoImportDirectories').includes(empty),
    'empty roots must persist'
  )
  controller.excludeMusicDirectory(album)
  assert.ok(instances.at(-1).options.ignoredDirectories.includes(album))
  controller.configureLibraryAutoImport({ enabled: false, ignoreShortSongs: true })
  assert.ok(instances.at(-1).stopped, 'disable must close the watcher')
  const countBefore = instances.length
  controller.configureLibraryAutoImport({ enabled: false, ignoreShortSongs: false })
  assert.equal(instances.length, countBefore, 'disabled setting changes must not create watchers')
  controller.configureLibraryAutoImport({ enabled: true, ignoreShortSongs: false })
  controller.trackMusicDirectory(album)
  assert.ok(
    !instances.at(-1).options.ignoredDirectories.includes(album),
    'explicit reimport should clear exclusion'
  )
  controller.stopLibraryAutoImport()
  controller = load('src/main/service/libraryAutoImport.ts', controllerMocks)
  controller.configureLibraryAutoImport({ enabled: true, ignoreShortSongs: true })
  assert.ok(instances.at(-1).directories.includes(empty), 'fresh service must restore empty roots')
  controller.stopLibraryAutoImport()
  console.log(
    'Library auto-import tests passed: copy stability, nested folders, deduplication, pause/resume, startup catch-up, removal, exclusions, duration filtering, cancellation.'
  )
} finally {
  watcher?.stop()
  assert.equal(path.dirname(temporary), path.resolve(os.tmpdir()))
  assert.ok(path.basename(temporary).startsWith('easy-player-auto-import-'))
  await fs.rm(temporary, { recursive: true, force: true })
}
