/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import { DatabaseSync } from 'node:sqlite'

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

  watcher = createWatcher({ disabledDirectories: [album] })
  watcher.setDirectories([root])
  const outsideDisabled = path.join(root, 'outside-disabled.mp3')
  await fs.writeFile(outsideDisabled, 'enabled')
  await until(() => known.has(outsideDisabled), 'enabled parent catch-up')
  assert.ok(!known.has(excluded), 'disabled child folders must be skipped under a watched parent')
  watcher.stop()
  const enabledNested = path.join(album, 'enabled-nested')
  await fs.mkdir(enabledNested)
  const nestedOverride = path.join(enabledNested, 'override.mp3')
  await fs.writeFile(nestedOverride, 'enabled nested root')
  watcher = createWatcher({
    disabledDirectories: [album],
    importFiles: async (_directory, files) => {
      files.forEach((file) => known.add(file))
      return true
    }
  })
  watcher.setDirectories([root, enabledNested])
  await until(() => known.has(nestedOverride), 'enabled root inside disabled subtree')
  assert.ok(!known.has(excluded), 'enabling a nested root must keep its disabled parent excluded')
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

  active = true
  cancelDuringParse = false
  const shutdownScanner = load('src/main/service/scanService.ts', {
    '../database': { getDatabase: () => db },
    './applicationShutdown': { isApplicationShuttingDown: () => !active },
    './audioMetadataService': {
      parseAudioFile: async () => {
        active = false
        return { common: { track: {}, disk: {} }, format: { duration: 30 } }
      }
    },
    '../i18n': { t: (key) => key },
    './playbackMode': { waitForBackgroundWork: async () => {} },
    './operationLogger': { logOperation: (_name, _params, task) => task(), logError: String },
    './loggerService': { Logger: { debug() {}, warn() {} } },
    '../utils/pathUtils': { getCoverPath: () => path.join(temporary, 'covers') },
    '../database/newestSongs': {
      refreshNewestSongs: () => assert.fail('cannot refresh after shutdown')
    }
  })
  result = await shutdownScanner.scanMusicDirectory(root, undefined, [copied], false)
  assert.equal(result.added, 0, 'manual imports must also stop after application shutdown')
  assert.ok(!stored.has(copied))
  active = true
  let importAllowed = true
  const scanMocks = {
    '../database': { getDatabase: () => db },
    './audioMetadataService': {
      parseAudioFile: async () => {
        importAllowed = false // Simulate deleting the song while metadata is being read.
        return { common: { track: {}, disk: {} }, format: { duration: 30 } }
      }
    },
    '../i18n': { t: (key) => key },
    './playbackMode': { waitForBackgroundWork: async () => {} },
    './operationLogger': { logOperation: (_name, _params, task) => task(), logError: String },
    './loggerService': { Logger: { debug() {}, warn() {} } },
    '../utils/pathUtils': { getCoverPath: () => path.join(temporary, 'covers') },
    '../database/newestSongs': { refreshNewestSongs() {} }
  }
  const raceScanner = load('src/main/service/scanService.ts', scanMocks)
  result = await raceScanner.scanMusicDirectory(root, undefined, [copied], false, {
    background: true,
    shouldImportFile: () => importAllowed
  })
  assert.equal(result.added, 0, 'deletion during parsing must prevent reinsertion')
  assert.equal(result.skipped, 1)
  assert.ok(!stored.has(copied))
  await raceScanner.scanMusicDirectory(root, undefined, [copied], false)
  assert.ok(stored.has(copied), 'explicit reimport must still work')

  // Exercise the common deletion repository with real SQL and transaction rollback.
  const deletionDb = new DatabaseSync(':memory:')
  const libraryRemoved = path.join(root, 'library-removed.mp3')
  const busy = path.join(root, 'busy.mp3')
  const physical = path.join(root, 'physical.mp3')
  for (const file of [libraryRemoved, busy, physical]) await fs.writeFile(file, 'audio')
  let failDeletion = false
  const deletionHost = {
    prepare: (sql) => deletionDb.prepare(sql),
    transaction: (task) => () => {
      deletionDb.exec('BEGIN')
      try {
        const value = task()
        deletionDb.exec('COMMIT')
        return value
      } catch (error) {
        deletionDb.exec('ROLLBACK')
        throw error
      }
    }
  }
  const deletionMocks = {
    '../index': { getDatabase: () => deletionHost },
    '../recommendations': {
      invalidateDailyRecommendations: () => {
        if (failDeletion) throw new Error('rollback fixture')
      }
    },
    '../newestSongs': { refreshNewestSongs() {} },
    '../../search/searchQuery': {},
    '../../utils/pathUtils': { getCoverPath: () => path.join(temporary, 'covers') },
    './songHelpers': {},
    './playlists': { refreshPlaylistCover() {} },
    'node:fs': {
      ...require('node:fs'),
      unlinkSync: (file) => {
        if (file === busy) throw new Error('file busy')
        require('node:fs').unlinkSync(file)
      }
    }
  }
  let savedExclusions
  try {
    deletionDb.exec(load('src/main/database/schema.ts').schemaV1)
    deletionDb.prepare('INSERT INTO music_source(id,name) VALUES(1,?)').run('remote')
    deletionDb
      .prepare(
        'INSERT INTO folder(id,name,full_path,is_root_path,import_time) VALUES(1,?,?,1,CURRENT_TIMESTAMP)'
      )
      .run('music', root)
    const insert = deletionDb.prepare(
      'INSERT INTO song(id,title,audio,folder_id,source_id) VALUES(?,?,?,1,?)'
    )
    for (const [id, audio, source] of [
      [1, libraryRemoved, null],
      [2, busy, null],
      [3, physical, null],
      [4, 'remote://track', 1]
    ])
      insert.run(id, 'fixture', audio, source)
    const repository = load('src/main/database/repository/songs.ts', deletionMocks)
    const readExclusions = () =>
      deletionDb
        .prepare('SELECT audio FROM library_import_exclusion ORDER BY rowid')
        .all()
        .map((row) => row.audio)
    failDeletion = true
    assert.throws(() => repository.deleteSongs([1]), /rollback fixture/)
    assert.ok(deletionDb.prepare('SELECT id FROM song WHERE id=1').get())
    assert.deepEqual(readExclusions(), [], 'failed deletion must roll back exclusions too')
    failDeletion = false
    assert.equal(repository.deleteSongs([1, 1, -1, 999]).deleted, 1)
    assert.ok(existsSync(libraryRemoved), 'library-only removal must preserve the local file')
    const failedPhysical = repository.deleteSongs([2], true)
    assert.deepEqual(Array.from(failedPhysical.failedFiles), [busy])
    assert.ok(existsSync(busy))
    assert.equal(repository.deleteSongs([3], true).deletedFiles, 1)
    assert.ok(!existsSync(physical))
    repository.deleteSongs([4])
    assert.deepEqual(
      readExclusions(),
      [libraryRemoved, busy, physical],
      'all local deletion paths must persist exclusions; remote songs must not'
    )
    for (let repeat = 0; repeat < 5; repeat++) {
      insert.run(5, 'reimport', libraryRemoved, null)
      assert.ok(
        !readExclusions().includes(libraryRemoved),
        'successful imports consume their deletion marker'
      )
      assert.equal(readExclusions().length, 2)
      repository.deleteSongs([5])
      assert.equal(
        readExclusions().length,
        3,
        'delete/reimport cycles must not accumulate old rows'
      )
    }
    savedExclusions = readExclusions()
  } finally {
    deletionDb.close()
  }

  // Check persisted folders, exclusions, settings changes, and fresh-process restoration.
  const settings = new Map()
  const excludedFiles = new Set(savedExclusions)
  const instances = []
  let defaultFolderReads = 0
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
      getDatabase: () => ({
        prepare: (sql) => ({
          all: () => {
            if (!sql.includes('FROM folder')) return []
            defaultFolderReads++
            return [
              { full_path: root },
              { full_path: album },
              { full_path: path.parse(root).root },
              { full_path: 'remote://source' }
            ]
          }
        })
      })
    },
    '../database/repository/settings': {
      getAppSetting: (key) => settings.get(key) ?? null,
      setAppSetting: (key, value) => settings.set(key, structuredClone(value))
    },
    '../database/repository/autoImport': {
      listAutoImportExclusions: () => [...excludedFiles],
      isAutoImportExcluded: (file) => excludedFiles.has(file),
      excludeAutoImportFiles: (files) => files.forEach((file) => excludedFiles.add(file))
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
  assert.deepEqual(
    instances.at(-1).directories,
    [root],
    'existing library folders seed the initial list without duplicate subfolders or drive roots'
  )
  assert.equal(settings.get('library.watchDirectories')[0].path, root)
  assert.equal(defaultFolderReads, 1)
  assert.ok(
    instances.at(-1).options.knownFiles().has(libraryRemoved),
    'deleted local songs must be excluded from discovery'
  )
  const allowFile = instances.at(-1).options
  assert.equal(allowFile.knownFiles().has(copied), false)
  let allowedAtScan
  const normalScan = controllerMocks['./scanService'].scanMusicDirectory
  controllerMocks['./scanService'].scanMusicDirectory = async (
    _root,
    _callback,
    _files,
    _short,
    options
  ) => {
    excludedFiles.add(copied)
    allowedAtScan = options.shouldImportFile(copied)
    return { added: 0, duplicates: 0, skipped: 1, total: 1 }
  }
  await allowFile.importFiles(root, [copied], () => true)
  assert.equal(allowedAtScan, false, 'in-flight scans must read exclusions added after discovery')
  controllerMocks['./scanService'].scanMusicDirectory = normalScan
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
  assert.ok(instances.at(-1).directories.includes(empty), 'new folder imports must join monitoring')
  controller.setWatchedMusicDirectories([
    { path: root, enabled: true },
    { path: empty, enabled: true },
    { path: album, enabled: false },
    { path: path.parse(root).root, enabled: true }
  ])
  assert.ok(instances.at(-1).directories.includes(empty), 'selected empty roots must be watched')
  assert.ok(
    instances.at(-1).options.disabledDirectories.includes(album),
    'disabled subtrees must be excluded'
  )
  assert.equal(controller.getWatchedMusicDirectories().length, 3, 'drive roots must not be watched')
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
  controller.setWatchedMusicDirectories([{ path: empty, enabled: false }])
  assert.equal(instances.at(-1).directories.length, 0, 'disabled folders must stop being watched')
  controller.setWatchedMusicDirectories([])
  controller.stopLibraryAutoImport()
  controller = load('src/main/service/libraryAutoImport.ts', controllerMocks)
  controller.configureLibraryAutoImport({ enabled: true, ignoreShortSongs: true })
  assert.equal(
    instances.at(-1).directories.length,
    0,
    'empty user selections must survive restarts without fallback'
  )
  assert.equal(
    defaultFolderReads,
    1,
    'saved selections must not be repopulated from library folders'
  )
  controller.trackMusicDirectory(empty)
  assert.equal(
    instances.at(-1).directories.length,
    0,
    'reimport must not restore user-removed folders'
  )
  controller.setWatchedMusicDirectories([{ path: empty, enabled: false }])
  controller.trackMusicDirectory(empty)
  assert.equal(instances.at(-1).directories.length, 0, 'reimport must not enable paused folders')
  controller.setWatchedMusicDirectories([{ path: empty, enabled: true }])
  assert.ok(instances.at(-1).directories.includes(empty), 'manual enable must restore monitoring')
  assert.ok(
    instances.at(-1).options.knownFiles().has(libraryRemoved),
    'deleted songs must remain excluded after restarting the service'
  )
  controller.stopLibraryAutoImport()

  // Reproduce a clean install: startup precedes the first directory import.
  settings.clear()
  const cleanMocks = {
    ...controllerMocks,
    '../database': { getDatabase: () => ({ prepare: () => ({ all: () => [] }) }) }
  }
  controller = load('src/main/service/libraryAutoImport.ts', cleanMocks)
  controller.configureLibraryAutoImport({ enabled: true, ignoreShortSongs: true })
  assert.equal(instances.at(-1).directories.length, 0)
  const downloads = path.join(temporary, 'Downloads')
  controller.trackMusicDirectory(downloads)
  assert.ok(
    instances.at(-1).directories.includes(downloads),
    'first import after empty startup must be watched'
  )
  assert.equal(settings.get('library.watchDirectories')[0].path, downloads)
  controller.stopLibraryAutoImport()
  controller = load('src/main/service/libraryAutoImport.ts', cleanMocks)
  controller.configureLibraryAutoImport({ enabled: true, ignoreShortSongs: true })
  assert.ok(
    instances.at(-1).directories.includes(downloads),
    'first imported folder must persist after restart'
  )
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
