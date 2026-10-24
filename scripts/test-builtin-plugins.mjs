import { pluginRequire, pluginPath, projectRequire } from './lib/plugin-require.mjs'
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
const require = createRequire(import.meta.url)
if (!process.versions.electron) {
  const result = spawnSync(
    require('electron'),
    [path.resolve('scripts/test-builtin-plugins.mjs')],
    {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit'
    }
  )
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
function loader(mocks = {}, globals = {}) {
  const cache = new Map()
  function load(file) {
    const filename = path.resolve(file)
    if (mocks[filename]) return mocks[filename]
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
        Error,
        URL,
        URLSearchParams,
        AbortSignal,
        AbortController,
        Buffer,
        structuredClone,
        fetch,
        process,
        ...globals,
        require(name) {
          if (name === '@easy-player/plugin-sdk') return pluginRequire(name)
          if (mocks[name]) return mocks[name]
          if (!name.startsWith('.')) return projectRequire(filename, name)
          const target = path.resolve(path.dirname(filename), name)
          if (name.endsWith('.json')) return require(target)
          return load(existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'index.ts'))
        }
      },
      { filename }
    )
    return exports
  }
  return load
}
const tick = () => new Promise(setImmediate)
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const policy = { isPlaybackOnly: () => false, onPlaybackModeChanged: () => () => undefined }
const common = {
  [path.resolve('src/main/i18n/index.ts')]: { t: (key) => key },
  [path.resolve('src/main/service/playbackMode.ts')]: policy
}
let registry
const load = loader({
  ...common,
  [path.resolve('src/main/sources/index.ts')]: { getNetworkSources: () => registry }
})
const { SourceRegistry } = load('src/main/sources/registry.ts')
const { PluginManager } = load('src/main/plugins/manager.ts')
registry = new SourceRegistry()
const store = new Map(),
  logs = [],
  fetches = []
let failLog = false
const mediaSignals = []
const manager = new PluginManager(registry, {
  readSetting: (key) => store.get(key) ?? null,
  writeSetting: (key, value) => store.set(key, value),
  log: (...args) => {
    if (failLog) throw new Error('Broken logger')
    logs.push(args)
  },
  mediaInfo: async (request, signal) => {
    mediaSignals.push(signal)
    return { id: 'media', request }
  },
  fetch: async (url, init) => {
    fetches.push({ url, signal: init.signal })
    return new Response('[]')
  }
})
const manifest = (id, sources) => ({
  id,
  displayName: id,
  version: '1.0.0',
  apiVersion: 1,
  sources: sources.map((source) => ({
    id: source,
    displayName: source,
    capabilities: ['metadata']
  }))
})
const source = (id) => ({
  id,
  displayName: id,
  apiVersion: 1,
  metadata: { search: async () => [], get: async () => ({ metadata: {} }) }
})
for (const bad of [
  { ...manifest('invalid', []), apiVersion: 99 },
  { ...manifest('invalid', []), version: 'future' },
  manifest('../invalid', []),
  manifest('invalid', ['same', 'same']),
  {
    ...manifest('invalid', []),
    sources: [{ id: 'bad', displayName: 'Bad', capabilities: ['playback'] }]
  }
])
  assert.throws(() => manager.load({ manifest: bad, activate() {} }))
assert.equal(manager.list().length, 0)
const events = []
let context, sourceDisposer, pendingRead, lease, resolvedContext
const alphaManifest = manifest('test.alpha', ['alpha'])
alphaManifest.sources.push({
  id: 'alpha-media',
  displayName: 'Media',
  capabilities: ['download'],
  downloadDomains: ['alpha.test']
})
manager.load({
  manifest: alphaManifest,
  activate(host) {
    context = host
    host.own(() => events.push('A'))
    host.own(() => events.push('B'))
    sourceDisposer = host.registerSource({
      ...source('alpha'),
      metadata: {
        search: async (_query, call) =>
          pendingRead
            ? pendingRead.promise
            : JSON.parse(
                await (await call.host.network.fetch('https://alpha.test/search', {}, call)).text()
              ),
        get: async () => ({ metadata: {} })
      }
    })
    host.registerSource({
      id: 'alpha-media',
      displayName: 'Media',
      apiVersion: 1,
      download: {
        matchesUrl: (url) => url.hostname === 'alpha.test',
        search: async () => [],
        parse: async () => [],
        resolve: async (_query, call) => {
          resolvedContext = call
          if (lease) await lease.promise
          await call.host.network.fetch('https://alpha.test/resolve', {}, call)
          return { transport: 'yt-dlp' }
        }
      }
    })
    assert.equal(registry.list().length, 0, 'activation stages sources atomically')
    return () => events.push('return')
  },
  deactivate() {
    events.push('hook')
  }
})
assert.throws(() => manager.load({ manifest: alphaManifest, activate() {} }), /already loaded/)
assert.throws(
  () => manager.load({ manifest: manifest('other', ['alpha']), activate() {} }),
  /already declared/
)
assert.equal(registry.list().length, 0)
assert.equal(registry.listDescriptors()[0].pluginState, 'inactive')
manager.activate('test.alpha')
assert.equal(registry.list().length, 2)
assert.equal(registry.ownerOf('alpha').pluginId, 'test.alpha')
const info = manager.get('test.alpha')
structuredClone(info)
info.sources[0].capabilities.push('download')
assert.equal(manager.get('test.alpha').sources[0].capabilities.length, 1)
assert.equal(
  (await context.media.extractInfo({ type: 'url', url: 'https://alpha.test/video' })).id,
  'media'
)
context.settings.set('answer', { value: 42 })
const stored = context.settings.get('answer')
stored.value = 0
assert.equal(context.settings.get('answer').value, 42)
assert.throws(() => context.settings.set('bad', { callback() {} }))
assert.throws(() => context.settings.set('../escape', 1))
const oldContext = context,
  oldDisposer = sourceDisposer
const runtime = load('src/main/sources/runtime.ts')
const search = () =>
  runtime.invokeSource('alpha', 'metadata.search', (definition, call) =>
    definition.metadata.search('Title', call)
  )
await search()
assert.equal(fetches.length, 1, 'source calls receive the owning host context')
pendingRead = deferred()
const running = search()
await tick()
manager.deactivate('test.alpha')
await assert.rejects(running, (error) => error.code === 'SOURCE_DISABLED')
assert.equal(fetches[0].signal.aborted, true, 'plugin stop aborts owned HTTP signals')
assert.equal(oldContext.signal.aborted, true)
assert.equal(mediaSignals[0].aborted, true, 'plugin stop aborts public media capability')
assert.throws(
  () => oldContext.media.extractInfo({ type: 'url', url: 'https://alpha.test/video' }),
  /closed/
)
assert.equal(registry.list().length, 0)
assert.equal(registry.listDescriptors().length, 2, 'inactive sources stay manageable')
assert.throws(
  () => registry.findDownload('https://alpha.test/video'),
  (error) => error.code === 'SOURCE_DISABLED'
)
assert.deepEqual(events, ['hook', 'return', 'B', 'A'])
assert.throws(() => oldContext.settings.set('answer', 1), /closed/)
await assert.rejects(
  oldContext.network.fetch(
    'https://alpha.test/forged',
    {},
    { operation: 'download.resolve', signal: new AbortController().signal }
  ),
  /closed/
)
pendingRead.resolve([])
pendingRead = undefined
registry.setEnabled('alpha', false)
manager.activate('test.alpha')
oldDisposer()
assert.equal(registry.listAll().length, 2, 'old cleanup cannot unregister a new generation')
assert.equal(registry.isEnabled('alpha'), false, 'source preferences survive plugin stop/start')
registry.setEnabled('alpha', true)
pendingRead = deferred()
const unregistering = search()
await tick()
sourceDisposer()
await assert.rejects(unregistering, (error) => error.code === 'SOURCE_DISABLED')
pendingRead.resolve([])
pendingRead = undefined
manager.deactivate('test.alpha')
manager.activate('test.alpha')
lease = deferred()
const accepted = runtime.invokeSource('alpha-media', 'download.resolve', (definition, call) =>
  definition.download.resolve({}, call)
)
// Stop before execute's microtask as well as before the provider returns.
manager.deactivate('test.alpha')
lease.resolve()
assert.equal(
  (await accepted).transport,
  'yt-dlp',
  'an accepted download retains its own resolution context'
)
await assert.rejects(
  resolvedContext.host.network.fetch('https://alpha.test/expired', {}, resolvedContext),
  /closed/
)
lease = undefined

let namespaceA, namespaceB
manager.load({
  manifest: manifest('test.x', []),
  activate(host) {
    namespaceA = host
    host.settings.set('y.z', 'first')
  }
})
manager.load({
  manifest: manifest('test.x.y', []),
  activate(host) {
    namespaceB = host
    host.settings.set('z', 'second')
  }
})
manager.activate('test.x')
manager.activate('test.x.y')
assert.equal(namespaceA.settings.get('y.z'), 'first')
assert.equal(
  namespaceB.settings.get('z'),
  'second',
  'plugin IDs and setting keys have unambiguous namespace boundaries'
)

let failActivation = true,
  released = 0
manager.load({
  manifest: manifest('test.retry', ['retry']),
  activate(host) {
    host.own(() => {
      released++
    })
    host.registerSource(source('retry'))
    if (failActivation) throw new Error('Private upstream error')
  }
})
failLog = true
assert.throws(
  () => manager.activate('test.retry'),
  (error) => error.code === 'ACTIVATION_FAILED'
)
assert.equal(released, 1)
assert.equal(registry.get('retry'), undefined)
assert.equal(manager.get('test.retry').state, 'failed')
failLog = false
failActivation = false
manager.activate('test.retry')
assert.equal(manager.get('test.retry').state, 'active')
manager.load({ manifest: manifest('test.missing', ['missing']), activate() {} })
assert.throws(
  () => manager.activate('test.missing'),
  (error) => error.code === 'ACTIVATION_FAILED'
)
manager.load({
  manifest: manifest('test.invalid', ['invalid']),
  activate(host) {
    host.registerSource({ ...source('invalid'), metadata: {} })
  }
})
assert.throws(
  () => manager.activate('test.invalid'),
  (error) => error.code === 'ACTIVATION_FAILED'
)
manager.load({
  manifest: manifest('test.async', ['async']),
  async activate(host) {
    await tick()
    host.registerSource(source('async'))
  }
})
assert.throws(
  () => manager.activate('test.async'),
  (error) => error.code === 'ACTIVATION_FAILED'
)
await tick()
assert.equal(registry.get('async'), undefined, 'late activation cannot escape rollback')
manager.load({
  manifest: manifest('test.cleanup', ['cleanup']),
  activate(host) {
    host.own(() => {
      released++
    })
    host.own(() => {
      throw new Error('Broken cleanup')
    })
    host.registerSource(source('cleanup'))
  }
})
manager.activate('test.cleanup')
const beforeCleanup = released
failLog = true
manager.deactivate('test.cleanup')
failLog = false
assert.equal(released, beforeCleanup + 1, 'one broken cleanup does not skip the others')
assert.equal(manager.get('test.cleanup').error, 'CLEANUP_FAILED')
assert.equal(registry.get('cleanup'), undefined)
assert.equal(registry.isEnabled('retry'), true, 'another plugin remains available')
manager.load({
  manifest: manifest('test.async-cleanup', []),
  activate(host) {
    host.own(async () => {
      throw new Error('Late cleanup')
    })
  },
  async deactivate() {
    throw new Error('Late deactivate')
  }
})
manager.activate('test.async-cleanup')
manager.deactivate('test.async-cleanup')
await tick()
assert.equal(manager.get('test.async-cleanup').error, 'CLEANUP_FAILED')
manager.shutdown()
assert.equal(manager.list().length, 0)
assert.equal(registry.listDescriptors().length, 0)
assert.throws(() => manager.activate('test.alpha'), /closed/)
console.log(
  'Built-in plugin manager: manifests, ownership, atomic activation, rollback/retry, cleanup isolation, source preferences, cancellation and accepted downloads passed'
)

// Exercise the actual five-plugin bootstrap and existing SQLite settings without network access.
const db = new (require('better-sqlite3'))(':memory:')
db.exec('CREATE TABLE app_setting (key TEXT PRIMARY KEY, value_json TEXT, updated_at TEXT)')
const logs2 = []
const dependencies = {
  ...common,
  electron: { app: { getPath: () => path.resolve('build/plugin-settings-fixture') } },
  [path.resolve('src/main/plugins/bridge.ts')]: { officialPluginBridge: {} },
  [path.resolve('src/main/plugins/packages.ts')]: {
    OfficialPluginPackages: class {
      initialize() {}
      isBusy() {
        return false
      }
    }
  },
  [path.resolve('src/main/database/index.ts')]: { getDatabase: () => db },
  [path.resolve('src/main/service/loggerService.ts')]: {
    Logger: Object.fromEntries(
      ['debug', 'info', 'warn', 'error'].map((level) => [level, (...args) => logs2.push(args)])
    )
  }
}
const loadApp = loader(dependencies)
const appRuntime = loadApp('src/main/plugins/runtime.ts')
const appManager = appRuntime.getPluginManager(),
  appRegistry = appRuntime.getSourceRegistry()
assert.equal(appManager.list().length, 0, 'application startup has no preinstalled plugins')
function installFixture(loadRuntime, runtime) {
  const manager = runtime.getPluginManager()
  for (const plugin of loadRuntime(pluginPath('official/index.ts')).officialPlugins) {
    manager.load(plugin)
    manager.activate(plugin.manifest.id)
  }
}
installFixture(loadApp, appRuntime)
assert.deepEqual(
  Array.from(appManager.list(), (plugin) => plugin.id),
  ['builtin.netease', 'builtin.kugou', 'builtin.qqmusic', 'builtin.bili', 'builtin.youtube']
)
assert.equal(appRegistry.list().length, 5)
const settings = loadApp('src/main/database/repository/settings.ts')
settings.setAppSetting('network-sources.disabled', ['kugou'])
const management = loadApp('src/main/plugins/management.ts')
const sources = loadApp('src/main/sources/management.ts')
management.initializePlugins()
sources.initializeSourceSettings()
let hostRequests = 0
appRuntime.configurePluginHost({
  readSetting: settings.getAppSetting,
  writeSetting: settings.setAppSetting,
  log() {},
  fetch: async (_url, init) => {
    hostRequests++
    assert.equal(JSON.parse(init.body).req_1.method, 'DoSearchForQQMusicDesktop')
    return new Response(
      JSON.stringify({ code: 0, req_1: { code: 0, data: { body: { song: { list: [] } } } } })
    )
  }
})
assert.equal(
  (await loadApp('src/main/sources/metadata.ts').searchSourceTracks('qqmusic', 'Title')).length,
  0
)
assert.equal(hostRequests, 1, 'the actual QQ adapter uses the injected plugin host transport')
management.setManagedPluginEnabled('builtin.kugou', false)
assert.equal(appRegistry.get('kugou'), undefined)
assert.equal(
  sources.listManagedSources().find((entry) => entry.id === 'kugou').pluginState,
  'inactive'
)
management.setManagedPluginEnabled('builtin.kugou', true)
assert.equal(appRegistry.isEnabled('kugou'), false)
sources.setManagedSourceEnabled('kugou', true)
management.setManagedPluginEnabled('builtin.youtube', false)
assert.throws(
  () => appRegistry.findDownload('https://youtu.be/video'),
  (error) => error.code === 'SOURCE_DISABLED'
)
const restart = loader(dependencies)
installFixture(restart, restart('src/main/plugins/runtime.ts'))
restart('src/main/plugins/management.ts').initializePlugins()
restart('src/main/sources/management.ts').initializeSourceSettings()
assert.equal(
  restart('src/main/plugins/runtime.ts').getPluginManager().get('builtin.youtube').state,
  'inactive'
)
const before = appManager.get('builtin.kugou').state
db.exec(
  "CREATE TRIGGER fail_settings BEFORE UPDATE ON app_setting BEGIN SELECT RAISE(ABORT, 'disk failure'); END"
)
assert.throws(() => management.setManagedPluginEnabled('builtin.kugou', false))
assert.equal(appManager.get('builtin.kugou').state, before)
assert.throws(() => management.setManagedPluginEnabled('builtin.youtube', true))
assert.equal(
  appManager.get('builtin.youtube').state,
  'inactive',
  'failed persistence rolls a new activation back'
)
db.exec('DROP TRIGGER fail_settings')
for (const args of [
  ['missing', true],
  ['builtin.qqmusic', 'false'],
  [null, true]
])
  assert.throws(() => management.setManagedPluginEnabled(...args))
const handlers = new Map(),
  notifications = []
dependencies.electron = {
  ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
  BrowserWindow: {
    getAllWindows: () => [
      {
        isDestroyed: () => false,
        webContents: { isDestroyed: () => false, send: (channel) => notifications.push(channel) }
      },
      { isDestroyed: () => true }
    ]
  }
}
loadApp('src/main/ipc/pluginIpcHandlers.ts').registerPluginIpcHandlers()
structuredClone(handlers.get('plugins:list')().data)
assert.equal(
  handlers.get('plugins:set-enabled')({}, { pluginId: 'builtin.qqmusic', enabled: false }).success,
  true
)
assert.deepEqual(notifications, ['plugins:changed', 'network-sources:changed'])
assert.equal(handlers.get('plugins:set-enabled')({}, undefined).success, false)
const preloadWindow = {}
loader(
  {
    electron: {
      ipcRenderer: {
        invoke: (channel, value) =>
          Promise.resolve(handlers.get(channel)({}, structuredClone(value)))
      }
    },
    '@electron-toolkit/preload': { electronAPI: {} }
  },
  { window: preloadWindow }
)('src/preload/index.ts')
assert.equal((await preloadWindow.api.plugins.list()).data.length, 5)
assert.equal((await preloadWindow.api.plugins.setEnabled('builtin.qqmusic', true)).success, true)
appRuntime.shutdownPlugins()
appRuntime.shutdownPlugins()
assert.equal(appRegistry.list().length, 0)
restart('src/main/plugins/runtime.ts').shutdownPlugins()
db.close()
console.log(
  'Built-in plugin integration: five real definitions, SQLite restart/rollback, independent source settings, IPC notifications, preload DTOs and shutdown passed'
)
