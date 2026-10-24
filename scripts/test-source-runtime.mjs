import { pluginRequire, pluginPath, projectRequire } from './lib/plugin-require.mjs'
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

function loader(mocks = {}, globals = {}) {
  const cache = new Map()
  function load(file) {
    const filename = path.resolve(file)
    if (mocks[filename]) return mocks[filename]
    if (cache.has(filename)) return cache.get(filename)
    const exports = {}
    cache.set(filename, exports)
    const code = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText
    vm.runInNewContext(
      code,
      {
        exports,
        Error,
        URL,
        URLSearchParams,
        AbortController,
        AbortSignal,
        Buffer,
        structuredClone,
        process,
        setTimeout,
        clearTimeout,
        crypto,
        ...globals,
        require(name) {
          if (name === '@easy-player/plugin-sdk') return pluginRequire(name)
          if (mocks[name]) return mocks[name]
          if (!name.startsWith('.')) return projectRequire(filename, name)
          const target = path.resolve(path.dirname(filename), name)
          return load(existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'index.ts'))
        }
      },
      { filename }
    )
    return exports
  }
  return load
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
const tick = () => new Promise(setImmediate)
const codeIs = (code) => (error) => error.code === code
let playbackOnly = false
const modeListeners = new Set()
const policy = {
  isPlaybackOnly: () => playbackOnly,
  requireBackgroundWork() {
    if (playbackOnly) throw new Error('Playback only')
  },
  onPlaybackModeChanged(listener) {
    modeListeners.add(listener)
    return () => modeListeners.delete(listener)
  }
}
const mocks = {
  [path.resolve('src/main/service/playbackMode.ts')]: policy,
  [path.resolve('src/main/i18n/index.ts')]: { t: (key) => key }
}
const { SourceRegistry } = loader(mocks)('src/main/sources/registry.ts')
const registry = new SourceRegistry()
let provider = async () => []
registry.register({
  id: 'test',
  displayName: 'Test',
  apiVersion: 1,
  metadata: { search: (...args) => provider(...args), get: async () => ({ metadata: {} }) },
  lyrics: { search: (...args) => provider(...args) },
  download: { search: async () => [], resolve: (...args) => provider(...args) }
})
mocks[path.resolve('src/main/sources/index.ts')] = { getNetworkSources: () => registry }
const handlers = new Map()
mocks.electron = { ipcMain: { handle: (name, handler) => handlers.set(name, handler) } }
mocks[path.resolve('src/main/service/loggerService.ts')] = {
  Logger: { warn() {}, debug() {} }
}
let fetchResponse
const load = loader(mocks, { fetch: async () => fetchResponse })
const runtime = load('src/main/sources/runtime.ts')
const errors = load('src/main/sources/errors.ts')
const logs = []
runtime.setSourceCallLogger((entry) => logs.push(entry))
const search = (options = {}) =>
  runtime.invokeSource(
    'test',
    'metadata.search',
    (source, context) => source.metadata.search('private query/token', context),
    options
  )

// A provider that ignores AbortSignal must still release the host call on timeout.
const late = deferred()
let signal
provider = (_query, context) => {
  signal = context.signal
  return late.promise
}
await assert.rejects(search({ timeoutMs: 10 }), codeIs('TIMEOUT'))
assert.equal(signal.aborted, true)
assert.equal(modeListeners.size, 0, 'deadline must release mode listeners')
late.reject(new Error('late secret error'))
await tick()
provider = async () => []
assert.deepEqual(Array.from(await search()), [], 'next call can proceed after a timeout')
assert.equal(JSON.stringify(logs).includes('private'), false)
assert.equal(JSON.stringify(logs).includes('secret'), false)

const controller = new AbortController()
provider = (_query, context) => {
  signal = context.signal
  return new Promise(() => {})
}
const cancelled = search({ signal: controller.signal })
await tick()
controller.abort()
await assert.rejects(cancelled, codeIs('CANCELLED'))
assert.equal(signal.aborted, true)
let starts = 0
provider = async () => {
  starts++
  return []
}
await assert.rejects(search({ signal: controller.signal }), codeIs('CANCELLED'))
assert.equal(starts, 0, 'pre-cancelled calls never enter a provider')

provider = () => new Promise(() => {})
const disabled = search()
await tick()
registry.setEnabled('test', false)
runtime.cancelSourceCalls('test')
await assert.rejects(disabled, codeIs('SOURCE_DISABLED'))
await assert.rejects(search(), codeIs('SOURCE_DISABLED'))
registry.setEnabled('test', true)
const modeCall = search()
await tick()
playbackOnly = true
for (const listener of modeListeners) listener(true)
await assert.rejects(modeCall, codeIs('BACKGROUND_PAUSED'))
await assert.rejects(search(), codeIs('BACKGROUND_PAUSED'))
playbackOnly = false
assert.equal(modeListeners.size, 0)

provider = async () => ({ invalid: true })
await assert.rejects(search(), codeIs('INVALID_RESPONSE'))
await assert.rejects(
  runtime.invokeSource('missing', 'metadata.search', async () => []),
  codeIs('SOURCE_NOT_FOUND')
)
await assert.rejects(
  runtime.invokeSource('test', 'artwork.search', async () => []),
  codeIs('UNSUPPORTED_CAPABILITY')
)
for (const [reason, code, retryable] of [
  [{ status: 401 }, 'AUTH_REQUIRED', false],
  [{ status: 403 }, 'AUTH_REQUIRED', false],
  [{ response: { status: 429 } }, 'RATE_LIMITED', true],
  [{ status: 404 }, 'RESOURCE_NOT_FOUND', false],
  [{ code: 'ECONNRESET' }, 'NETWORK', true],
  [{ cause: { code: 'ENOTFOUND' } }, 'NETWORK', true],
  [{ name: 'SyntaxError' }, 'INVALID_RESPONSE', false],
  [{ name: 'TimeoutError' }, 'TIMEOUT', true],
  [new Error('private upstream body'), 'PROVIDER_ERROR', true]
]) {
  const failure = errors.sourceFailure(reason)
  assert.equal(failure.code, code)
  assert.equal(failure.retryable, retryable)
  assert.equal(failure.message.includes('private'), false)
  assert.deepEqual(structuredClone(failure), { ...failure }, 'error DTO is cloneable')
}

// Disabling does not revoke a download task already accepted by the host.
const resolution = deferred()
provider = () => resolution.promise
const accepted = runtime.invokeSource('test', 'download.resolve', (source, context) =>
  source.download.resolve({}, context)
)
await tick()
runtime.cancelSourceCalls('test')
resolution.resolve({ transport: 'yt-dlp' })
assert.equal((await accepted).transport, 'yt-dlp')

class Owner extends EventEmitter {
  constructor(id) {
    super()
    this.id = id
    this.destroyed = false
  }
  isDestroyed() {
    return this.destroyed
  }
  destroy() {
    this.destroyed = true
    this.emit('destroyed')
  }
}
const requests = load('src/main/sources/requests.ts')
const owner = new Owner(1),
  other = new Owner(2)
const runOwned = (target, requestId) =>
  requests.withSourceRequest(target, { requestId }, (signal) => search({ signal }))
provider = () => new Promise(() => {})
const owned = runOwned(owner, 'same-id')
await tick()
assert.equal(requests.cancelSourceRequest(other.id, 'same-id'), false)
await assert.rejects(runOwned(owner, 'same-id'), codeIs('INVALID_REQUEST'))
const secondOwner = runOwned(other, 'same-id')
await tick()
requests.cancelSourceRequest(owner.id, 'same-id')
await assert.rejects(owned, codeIs('CANCELLED'))
other.destroy()
await assert.rejects(secondOwner, codeIs('CANCELLED'))
assert.equal(owner.listenerCount('destroyed'), 0)
assert.equal(other.listenerCount('destroyed'), 0)
assert.equal(requests.cancelSourceRequest(owner.id, 'same-id'), false)
await assert.rejects(runOwned(owner, 'invalid id!'), codeIs('INVALID_REQUEST'))

// Exercise the actual unified IPC dispatch with a serializable envelope.
load('src/main/ipc/sourceCallIpcHandlers.ts').registerSourceCallIpcHandlers()
const invoke = (request, sender = owner) =>
  handlers.get('network-sources:invoke')({ sender }, request)
provider = async () => []
playbackOnly = true
assert.equal(
  (await invoke({ operation: 'lyrics.search', query: { title: 'Title' } })).failure.code,
  'BACKGROUND_PAUSED'
)
assert.equal(
  (await invoke({ operation: 'artwork.search', query: { title: 'Title' } })).failure.code,
  'BACKGROUND_PAUSED'
)
playbackOnly = false
assert.equal(
  (await invoke({ operation: 'metadata.search', sourceId: 'test', query: 'Title' })).success,
  true
)
for (const request of [
  null,
  {},
  { operation: 'metadata.get', resource: null },
  { operation: 'lyrics.search', query: { title: 12 } },
  { operation: 'metadata.search', sourceId: 'test', query: 'x'.repeat(501) }
]) {
  const result = await invoke(request)
  assert.equal(result.failure.code, 'INVALID_REQUEST')
  structuredClone(result)
}
provider = async () => {
  throw { status: 429 }
}
assert.equal(
  (await invoke({ operation: 'metadata.search', sourceId: 'test', query: 'Title' })).failure.code,
  'RATE_LIMITED'
)
provider = () => new Promise(() => {})
const ipcPending = invoke({
  operation: 'metadata.search',
  sourceId: 'test',
  query: 'Title',
  requestId: 'ipc'
})
await tick()
assert.equal(handlers.get('network-sources:cancel')({ sender: owner }, 'ipc').cancelled, true)
assert.equal((await ipcPending).failure.code, 'CANCELLED')
assert.equal(owner.listenerCount('destroyed'), 0)

// Artwork transport is bounded and validates its response before returning a data URL.
const artwork = load('src/main/sources/artworkFetch.ts')
fetchResponse = new Response(Buffer.from('image'), { headers: { 'content-type': 'image/png' } })
assert.equal(
  await artwork.fetchArtworkDataUrl('https://image.test/cover'),
  'data:image/png;base64,aW1hZ2U='
)
fetchResponse = new Response('html', { headers: { 'content-type': 'text/html' } })
await assert.rejects(
  artwork.fetchArtworkDataUrl('https://image.test/cover'),
  codeIs('INVALID_RESPONSE')
)
fetchResponse = new Response('', { status: 403 })
await assert.rejects(
  artwork.fetchArtworkDataUrl('https://image.test/cover'),
  codeIs('AUTH_REQUIRED')
)

// Format fallback is cooperative: after cancellation no new provider work starts.
const preferred = deferred()
let lyricCalls = 0
provider = () => {
  lyricCalls++
  return preferred.promise
}
const lyricController = new AbortController()
const lyrics = load('src/main/service/lyrics/network.ts').searchNetworkLyrics(
  { title: 'Title' },
  { signal: lyricController.signal }
)
await tick()
lyricController.abort()
await assert.rejects(lyrics, codeIs('CANCELLED'))
preferred.reject(new Error('late format failure'))
await tick()
assert.equal(lyricCalls, 1, 'cancellation prevents fallback requests')
assert.equal(modeListeners.size, 0)
console.log(
  'Source runtime: deadlines, cancellation, late results, source/mode guards, error DTOs, IPC ownership, artwork and fallback passed'
)

// Fake only the transport; exercise actual process and HTTP cancellation wiring.
let child,
  aborted = 0
const spawned = []
const transport = loader({
  ...mocks,
  electron: {
    app: { isPackaged: false, getAppPath: () => process.cwd() },
    net: {
      request: () => {
        const request = new EventEmitter()
        request.abort = () => {
          aborted++
          request.emit('close')
        }
        return request
      }
    }
  },
  'node:child_process': {
    spawn: (command, args, options) => {
      spawned.push({ command, args, options })
      const result = new EventEmitter()
      if (command !== 'taskkill') {
        child = result
        result.pid = 54321
        result.stdout = new EventEmitter()
        result.stderr = new EventEmitter()
        result.kill = () => result.emit('close', null)
      }
      return result
    }
  },
  [path.resolve('src/main/service/operationLogger.ts')]: {
    logOperation: (_name, _data, action) => action()
  }
})('src/main/service/mediaDownloadRuntime.ts')
const extractionSignal = new AbortController().signal
const beforeInvalidMedia = spawned.length
for (const request of [
  { type: 'search', query: '', limit: 12 },
  { type: 'search', query: 'Title', limit: 100 },
  { type: 'url', url: 'file:///private/audio' },
  { type: 'url', url: '--exec=command' },
  { type: 'url', url: 'https://user:password@example.test/video' }
])
  await assert.rejects(
    transport.extractMediaInfo(request, extractionSignal),
    (error) => error.code === 'INVALID_REQUEST'
  )
assert.equal(
  spawned.length,
  beforeInvalidMedia,
  'invalid extraction requests never start a process'
)
const extracting = transport.extractMediaInfo(
  { type: 'search', query: 'Title --exec=untrusted', limit: 3 },
  extractionSignal
)
assert.deepEqual(Array.from(spawned.at(-1).args), [
  '--dump-single-json',
  '--flat-playlist',
  '--skip-download',
  '--no-warnings',
  '--',
  'ytsearch3:Title --exec=untrusted'
])
child.stdout.emit('data', Buffer.from('{"id":"fixture"}'))
child.emit('close', 0)
assert.equal((await extracting).id, 'fixture')
const processCancel = new AbortController()
const processCall = transport.runYtDlp(['private-query'], processCancel.signal)
processCancel.abort(new Error('cancelled'))
await assert.rejects(processCall, /cancelled/)
if (process.platform === 'win32') {
  assert.equal(spawned.at(-1).command, 'taskkill')
  assert.deepEqual(Array.from(spawned.at(-1).args), ['/pid', '54321', '/T', '/F'])
  assert.equal(spawned.at(-1).options.windowsHide, true)
  child.emit('close', null)
}
const httpCancel = new AbortController()
transport.backgroundRequest('https://media.test', httpCancel.signal)
httpCancel.abort()
assert.equal(aborted, 1)
assert.equal(modeListeners.size, 0, 'closed transports release mode subscriptions')
console.log(
  'Media transport: own-process cancellation, hidden taskkill and HTTP abort cleanup passed'
)

// SDK requests cannot abort their sockets, but cancellation prevents their next API call.
for (const source of ['netease', 'kugou']) {
  const searchResult = deferred()
  let downstream = 0
  const cancelled = new AbortController()
  const sdk =
    source === 'netease'
      ? {
          search: () => searchResult.promise,
          lyric_new: async () => {
            downstream++
            return {}
          }
        }
      : {
          default: {
            search: () => searchResult.promise,
            search_lyric: async () => {
              downstream++
              return {}
            }
          }
        }
  const providerModule = loader({
    ...mocks,
    '@neteasecloudmusicapienhanced/api': sdk,
    kugoumusicapi: sdk
  })(pluginPath(`official/${source}/lyrics.ts`))
  const method = source === 'netease' ? 'searchNeteaseLyrics' : 'searchKugouLyrics'
  const call = providerModule[method]({ title: 'Title' }, false, {
    signal: cancelled.signal,
    deadline: Date.now() + 1000,
    operation: 'lyrics.search',
    sourceId: source
  })
  await tick()
  cancelled.abort()
  searchResult.resolve(
    source === 'netease'
      ? { status: 200, body: { result: { songs: [{ id: 1, name: 'Title' }] } } }
      : { body: { data: { lists: [{ FileHash: 'hash' }] } } }
  )
  await assert.rejects(call, (error) => errors.sourceFailure(error).code === 'CANCELLED')
  assert.equal(downstream, 0, `${source} must not request lyrics after a late search`)
}

// The real preload serializes a request ID, retaining the public API return shapes.
const preloadWindow = {}
const bridgeCalls = []
provider = async () => []
loader(
  {
    electron: {
      ipcRenderer: {
        invoke: async (channel, request) => {
          bridgeCalls.push({ channel, request: structuredClone(request) })
          return handlers.get(channel)({ sender: owner }, request)
        }
      }
    },
    '@electron-toolkit/preload': { electronAPI: {} }
  },
  { window: preloadWindow }
)('src/preload/index.ts')
const api = preloadWindow.api
assert.equal(
  (await api.metadata.searchTracks('test', 'Title', { requestId: 'bridge-search' })).success,
  true
)
assert.equal(bridgeCalls.at(-1).request.requestId, 'bridge-search')
assert.equal(
  (
    await api.networkSources.request({
      operation: 'metadata.search',
      sourceId: 'test',
      query: 'Title',
      requestId: 'explicit'
    })
  ).success,
  true
)
assert.equal(bridgeCalls.at(-1).request.requestId, 'explicit')
assert.equal((await api.downloads.search('test', 'Title')).length, 0)

// A cancelled automatic lookup cannot persist late lyrics or start the next source.
const networkLyrics = deferred()
let current = true,
  writes = 0,
  sentOptions
const resolver = loader(
  {},
  {
    window: {
      api: {
        lyrics: {
          searchNetwork: (_query, options) => {
            sentOptions = structuredClone(options)
            return networkLyrics.promise
          }
        },
        database: {
          command: async () => {
            writes++
            return { success: true }
          }
        }
      }
    }
  }
)('src/renderer/src/services/lyrics.ts')
const resolving = resolver.resolveLyrics(
  { id: 1, audio: 'song.mp3', title: 'Title' },
  ['network'],
  'auto',
  true,
  true,
  { requestId: 'automatic', isCurrent: () => current }
)
current = false
networkLyrics.resolve({ success: true, data: [{ lrc: '[00:01.00]Late lyric', format: 'lrc' }] })
assert.equal((await resolving).lines.length, 0)
assert.equal(writes, 0)
assert.equal(sentOptions.requestId, 'automatic')
assert.equal('isCurrent' in sentOptions, false, 'callbacks must stay outside the bridge')
console.log(
  'Adapters and renderer: cooperative SDK cancellation, serializable preload options and no late automatic lyric writes passed'
)
