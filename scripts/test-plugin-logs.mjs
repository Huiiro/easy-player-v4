/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
mkdirSync('build', { recursive: true })
const directory = mkdtempSync(path.resolve('build/plugin-logs-test-'))
const handlers = new Map(),
  listeners = new Map(),
  settings = new Map(),
  sent = []
let playbackOnly = false,
  failFile = false
const realFs = require('node:fs')
const mocks = {
  electron: {
    BrowserWindow: {
      getAllWindows: () => [
        {
          isDestroyed: () => false,
          webContents: {
            isDestroyed: () => false,
            send() {
              throw new Error('Window closed')
            }
          }
        },
        {
          isDestroyed: () => false,
          webContents: { isDestroyed: () => false, send: (_channel, entry) => sent.push(entry) }
        }
      ]
    },
    ipcMain: {
      handle: (key, fn) => handlers.set(key, fn),
      on: (key, fn) => listeners.set(key, fn)
    },
    shell: {
      openPath: async (target) => {
        assert.equal(target, directory)
        return ''
      }
    }
  },
  'node:fs': {
    ...realFs,
    appendFileSync(...args) {
      if (failFile) throw new Error('Disk full')
      return realFs.appendFileSync(...args)
    }
  },
  [path.resolve('src/main/i18n.ts')]: { t: (key) => key },
  [path.resolve('src/main/utils/pathUtils.ts')]: { getLogPath: (...parts) => path.join(directory, ...parts) },
  [path.resolve('src/main/database/repository.ts')]: {
    getAppSetting: (key) => settings.get(key),
    setAppSetting: (key, value) => settings.set(key, value)
  },
  [path.resolve('src/main/service/playbackMode.ts')]: {
    isPlaybackOnly: () => playbackOnly,
    onPlaybackModeChanged: () => () => {}
  }
}
const cache = new Map()
function load(file) {
  const target = path.resolve(file)
  if (mocks[target]) return mocks[target]
  if (cache.has(target)) return cache.get(target)
  const exports = {}
  cache.set(target, exports)
  vm.runInNewContext(
    ts.transpileModule(readFileSync(target, 'utf8'), {
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
      AbortController,
      AbortSignal,
      structuredClone,
      process,
      Buffer,
      setTimeout,
      clearTimeout,
      console: { log() {}, warn() {}, error() {} },
      require(name) {
        if (mocks[name]) return mocks[name]
        if (!name.startsWith('.')) return require(name)
        const resolved = path.resolve(path.dirname(target), name)
        return load(
          realFs.existsSync(resolved + '.ts') ? resolved + '.ts' : path.join(resolved, 'index.ts')
        )
      }
    }
  )
  return exports
}
const { Logger } = load('src/main/service/loggerService.ts')
const { redactPluginLog } = load('src/shared/pluginLogs.ts')
Logger.registerIpc()
const context = {
  pluginId: 'example.test',
  version: '1.0.0',
  operation: 'metadata.search',
  elapsedMs: 12.4
}
Logger.plugin('debug', context, 'hidden')
assert.equal(Logger.recentPlugins().length, 0)
Logger.plugin('info', context, 'visible')
assert.equal(Logger.recentPlugins()[0].plugin.elapsedMs, 12)
const snapshot = Logger.recentPlugins()
snapshot[0].plugin.pluginId = 'mutated'
assert.equal(Logger.recentPlugins()[0].plugin.pluginId, context.pluginId)
assert(sent.length, 'a closing window must not prevent delivery to another window')
for (const text of [
  'https://alice:secret@example.test/api?token=secret#secret',
  'Authorization: Basic secret\nCookie: session=secret',
  '{"authorization":"Basic secret","cookie":"session=secret","password":"secret"}',
  'access_token=secret refreshToken="secret" api_key=secret Bearer secret'
])
  assert(!redactPluginLog(text).includes('secret'), text)
Logger.plugin('error', context, new Error('https://user:secret@example.test/api?token=secret'))
const persisted = readFileSync(
  path.join(directory, 'log-' + new Date().toISOString().slice(0, 10) + '.log'),
  'utf8'
)
assert(!persisted.includes('secret'))
assert(persisted.includes('"pluginId":"example.test"'))
assert(redactPluginLog('x'.repeat(100000)).length <= 4096)
assert(!redactPluginLog('line\rnext\nlast').includes('\r'))
Logger.plugin('info', { pluginId: '../outside' }, 'invalid')
assert.equal(Logger.recentPlugins().length, 2)
await handlers.get('log:set-level')({}, 'debug')
for (let index = 0; index < 1005; index++) Logger.plugin('debug', context, 'entry ' + index)
assert.equal(Logger.recentPlugins().length, 1000)
for (let index = 0; index < 1100; index++) Logger.info('unrelated')
assert.equal(
  Logger.recentPlugins().length,
  1000,
  'ordinary app traffic cannot evict the plugin buffer'
)
playbackOnly = true
const before = Logger.recentPlugins().at(-1).id
Logger.plugin('warn', context, 'muted')
assert.equal(Logger.recentPlugins().at(-1).id, before)
Logger.plugin('error', context, 'playback failure')
assert(Logger.recentPlugins().at(-1).id > before)
playbackOnly = false
failFile = true
assert.doesNotThrow(() => Logger.plugin('error', context, 'disk failure'))
failFile = false
assert.equal((await handlers.get('log:open-directory')()).success, true)

const runtime = load('src/main/plugins/runtime.ts')
runtime.configurePluginHost({
  readSetting() {},
  writeSetting() {},
  fetch() {
    assert.fail('No network')
  },
  log: (pluginId, level, message, version) => Logger.plugin(level, { pluginId, version }, message)
})
const manager = runtime.getPluginManager()
let previousHost
const manifest = {
  id: 'example.lifecycle',
  displayName: 'Test',
  version: '1.0.0',
  apiVersion: 2,
  sources: []
}
manager.load({
  manifest,
  activate(host) {
    previousHost = host
    host.own(() => {
      throw new Error('Cleanup https://u:secret@example.test/?password=secret')
    })
  }
})
manager.activate(manifest.id)
manager.unload(manifest.id)
manager.load({ manifest: { ...manifest, version: '2.0.0' }, activate() {} })
manager.activate(manifest.id)
previousHost.log('info', 'accepted old operation')
assert.equal(
  Logger.recentPlugins().at(-1).plugin.version,
  '1.0.0',
  'late logs retain their actual activation version'
)
assert(
  Logger.recentPlugins().some(
    (entry) => entry.message.includes('Cleanup:') && !entry.message.includes('secret')
  )
)
manager.load({
  manifest: { ...manifest, id: 'example.failed' },
  activate() {
    throw new Error('Activation detail')
  }
})
assert.throws(() => manager.activate('example.failed'))
assert(Logger.recentPlugins().some((entry) => entry.message.includes('Activation detail')))
const sourceManifest = {
  ...manifest,
  id: 'example.source',
  sources: [{ id: 'logging', displayName: 'Logging', capabilities: ['lyrics'] }]
}
manager.load({
  manifest: sourceManifest,
  activate(host) {
    host.registerSource({
      id: 'logging',
      displayName: 'Logging',
      apiVersion: 1,
      lyrics: { search: async () => [] }
    })
  }
})
manager.activate(sourceManifest.id)
const calls = []
const source = load('src/main/sources/runtime.ts')
source.setSourceCallLogger((entry) => calls.push(entry))
await source.invokeSource('logging', 'lyrics.search', (implementation, call) =>
  implementation.lyrics.search({}, false, call)
)
assert.equal(calls[0].pluginId, sourceManifest.id)
assert.equal(calls[0].version, '1.0.0')
assert.equal(calls[0].status, 'success')
let themeActive = true
const theme = { pluginId: 'example.theme', version: '1.0.0', revision: 'a'.repeat(64) }
mocks[path.resolve('src/main/plugins/management.ts')] = {
  initializePlugins() {},
  getOfficialPluginPackages: () => ({ listThemes: () => (themeActive ? [theme] : []) })
}
load('src/main/ipc/pluginIpcHandlers.ts').registerPluginIpcHandlers()
const themeFailure = listeners.get('plugins:theme-failure')
const previousLogId = Logger.recentPlugins().at(-1).id
themeFailure(
  {},
  { pluginId: theme.pluginId, revision: 'old', code: 'SHADER_COMPILE', detail: 'stale' }
)
assert.equal(Logger.recentPlugins().at(-1).id, previousLogId)
themeFailure(
  {},
  {
    pluginId: theme.pluginId,
    revision: theme.revision,
    code: 'SHADER_COMPILE',
    detail: 'password=secret'
  }
)
assert.equal(Logger.recentPlugins().at(-1).plugin.version, theme.version)
assert.equal(Logger.recentPlugins().at(-1).plugin.code, 'SHADER_COMPILE')
assert(!Logger.recentPlugins().at(-1).message.includes('secret'))
themeActive = false
const finalLogId = Logger.recentPlugins().at(-1).id
themeFailure({}, { pluginId: theme.pluginId, revision: theme.revision, code: 'FRAME_FAILED' })
assert.equal(Logger.recentPlugins().at(-1).id, finalLogId)
const returned = handlers.get('plugins:logs')().data
returned[0].message = 'changed'
assert.notEqual(handlers.get('plugins:logs')().data[0].message, 'changed')
console.log(
  'Plugin logs: redaction, files, level policy, bounded history, window/file failure isolation, lifecycle details, version attribution and call identity passed'
)
