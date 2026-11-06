/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
if (!process.versions.electron) {
  const result = spawnSync(
    require('electron'),
    [path.resolve('scripts/test-source-management.mjs')],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit'
    }
  )
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
function load(file, mocks = {}) {
  const cache = new Map()
  const visit = (filename) => {
    filename = path.resolve(filename)
    if (mocks[filename]) return mocks[filename]
    if (cache.has(filename)) return cache.get(filename)
    const exports = {}
    cache.set(filename, exports)
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
        URL,
        Error,
        Buffer,
        structuredClone,
        AbortController,
        AbortSignal,
        crypto,
        require: (name) => {
          if (mocks[name]) return mocks[name]
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
const plain = (value) => JSON.parse(JSON.stringify(value))
const mocks = { [path.resolve('src/main/i18n/index.ts')]: { t: (key) => key } }
const { SourceRegistry } = load('src/main/sources/registry.ts', mocks)
const db = new (require('better-sqlite3'))(':memory:')
db.exec(load('src/main/database/schema.ts').schemaV1)
let registry
const calls = { lyrics: 0, artwork: 0, metadata: 0, download: 0 }
const candidate = {
  id: 'lyric',
  resourceId: '123',
  title: 'Title',
  artist: 'Artist',
  lrc: '[00:01.00]Words',
  supportsWordTiming: false
}
const track = {
  resource: { sourceId: 'netease', resourceType: 'track', resourceId: '123' },
  title: 'Title',
  artist: 'Artist',
  metadata: { title: 'Title' }
}
const lyricCapability = {
  search: async () => {
    calls.lyrics++
    return [candidate]
  },
  get: async () => {
    calls.lyrics++
    return candidate
  }
}
const downloadCapability = {
  matchesUrl: (url) => url.hostname === 'example.test',
  search: async () => {
    calls.download++
    return []
  },
  parse: async () => [],
  resolve: async () => ({})
}
const definitions = [
  {
    id: 'netease',
    displayName: 'NetEase',
    apiVersion: 1,
    version: '1.0.0',
    lyrics: lyricCapability,
    artwork: {
      search: async () => {
        calls.artwork++
        return [
          { id: 'cover', resource: { sourceId: 'netease' }, imageUrl: 'https://image.test/a' }
        ]
      }
    },
    metadata: {
      search: async () => {
        calls.metadata++
        return [track]
      },
      get: async () => {
        calls.metadata++
        return track
      }
    }
  },
  {
    id: 'youtube',
    displayName: 'YouTube',
    apiVersion: 1,
    version: '1.0.0',
    download: downloadCapability
  }
]
const restartRegistry = () => {
  registry = new SourceRegistry()
  definitions.forEach((source) => registry.register(source))
}
restartRegistry()
const dependencies = {
  ...mocks,
  [path.resolve('src/main/database/index.ts')]: { getDatabase: () => db },
  [path.resolve('src/main/sources/index.ts')]: { getNetworkSources: () => registry },
  [path.resolve('src/main/service/playbackMode.ts')]: {
    requireBackgroundWork() {},
    isPlaybackOnly: () => false,
    onPlaybackModeChanged: () => () => {}
  }
}
const management = load('src/main/sources/management.ts', dependencies)
const metadata = load('src/main/sources/metadata.ts', dependencies)
const artwork = load('src/main/sources/artwork.ts', dependencies)
const lyrics = load('src/main/service/lyrics/network.ts', dependencies)
const request = { title: 'Title', artist: 'Artist', preferWordTimed: false }
const setting = () =>
  db.prepare('SELECT value_json FROM app_setting WHERE key=?').get('network-sources.disabled')
try {
  management.initializeSourceSettings()
  assert.equal(registry.list().length, 2)
  const descriptors = management.listManagedSources()
  assert.deepEqual(plain(descriptors[0].capabilities), ['lyrics', 'artwork', 'metadata'])
  assert.deepEqual(plain(descriptors[1].capabilities), ['download'])
  assert.equal(descriptors[0].version, '1.0.0')
  assert.deepEqual(
    structuredClone(descriptors),
    plain(descriptors),
    'only serializable descriptors cross IPC'
  )
  assert.equal(JSON.stringify(descriptors).includes('search'), false)
  assert.equal((await lyrics.searchNetworkLyrics(request)).length, 1)
  assert.equal((await artwork.searchSourceArtwork(request)).length, 1)
  assert.equal((await metadata.searchSourceTracks('netease', 'Title')).length, 1)
  await metadata.getSourceTrack(track.resource)
  await metadata.getSourceTrackLyrics(track.resource)
  await registry.requireDownload('youtube').search('Title')
  const beforeDisable = { ...calls }
  management.setManagedSourceEnabled('netease', false)
  assert.equal(registry.listAll().length, 2, 'disabled sources remain manageable')
  assert.equal(registry.list().length, 1)
  assert.equal(management.listManagedSources()[0].enabled, false)
  assert.equal(metadata.listMetadataSources().length, 0)
  assert.equal((await lyrics.searchNetworkLyrics(request)).length, 0)
  assert.equal((await artwork.searchSourceArtwork(request)).length, 0)
  await assert.rejects(metadata.searchSourceTracks('netease', 'Title'), /networkSourceDisabled/)
  await assert.rejects(metadata.getSourceTrack(track.resource), /networkSourceDisabled/)
  await assert.rejects(metadata.getSourceTrackLyrics(track.resource), /networkSourceDisabled/)
  assert.deepEqual(calls, beforeDisable, 'disabled capabilities cannot reach provider functions')
  assert.deepEqual(JSON.parse(setting().value_json), ['netease'])
  management.setManagedSourceEnabled('youtube', false)
  assert.throws(() => registry.requireDownload('youtube'), /networkSourceDisabled/)
  assert.throws(() => registry.findDownload('https://example.test/video'), /networkSourceDisabled/)
  restartRegistry()
  management.initializeSourceSettings()
  assert.equal(registry.list().length, 0, 'restart restores disabled settings')
  management.setManagedSourceEnabled('netease', true)
  assert.equal((await metadata.searchSourceTracks('netease', 'Title')).length, 1)
  assert.deepEqual(JSON.parse(setting().value_json), ['youtube'])
  for (const args of [
    ['missing', true],
    ['netease', 'false'],
    [null, true]
  ])
    assert.throws(() => management.setManagedSourceEnabled(...args))
  assert.equal(registry.isEnabled('netease'), true)
  db.exec(
    "CREATE TRIGGER fail_settings BEFORE UPDATE ON app_setting BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END"
  )
  assert.throws(
    () => management.setManagedSourceEnabled('netease', false),
    /simulated disk failure/
  )
  assert.equal(
    registry.isEnabled('netease'),
    true,
    'failed persistence keeps active state unchanged'
  )
  db.exec('DROP TRIGGER fail_settings')

  const handlers = new Map()
  let notifications = 0
  const ipc = load('src/main/ipc/networkSourceIpcHandlers.ts', {
    ...mocks,
    electron: {
      ipcMain: { handle: (name, action) => handlers.set(name, action) },
      BrowserWindow: {
        getAllWindows: () => [
          {
            isDestroyed: () => false,
            webContents: {
              isDestroyed: () => false,
              send: () => {
                notifications++
              }
            }
          },
          { isDestroyed: () => true }
        ]
      }
    },
    [path.resolve('src/main/sources/management.ts')]: management,
    [path.resolve('src/main/service/loggerService.ts')]: { Logger: { error() {}, debug() {} } },
    [path.resolve('src/main/service/operationLogger.ts')]: { logError: String }
  })
  ipc.registerNetworkSourceIpcHandlers()
  assert.equal(handlers.get('network-sources:list')().data.length, 2)
  assert.equal(
    handlers.get('network-sources:set-enabled')({}, { sourceId: 'netease', enabled: false })
      .success,
    true
  )
  assert.equal(notifications, 1)
  assert.equal(
    handlers.get('network-sources:set-enabled')({}, { sourceId: 'netease', enabled: 'true' })
      .success,
    false
  )
  assert.equal(notifications, 1, 'rejected updates do not broadcast a change')
  assert.equal(registry.isEnabled('netease'), false)
  assert.equal(handlers.get('network-sources:set-enabled')({}, undefined).success, false)
  console.log(
    'Source management: truthful descriptors, SQLite persistence, restart, disabled capability guards, URL routing, failure rollback and IPC notifications passed'
  )
} finally {
  db.close()
}
