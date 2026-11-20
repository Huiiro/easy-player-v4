/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdtemp, rm, access, writeFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import sharp from 'sharp'

const require = createRequire(import.meta.url)
function load(file, mocks, globals = {}) {
  const exports = {}
  const code = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true
    }
  }).outputText
  vm.runInNewContext(
    code,
    {
      ...globals,
      exports,
      Buffer,
      AbortController,
      AbortSignal,
      URL,
      Set,
      Map,
      Date,
      Promise,
      require: (name) => (name in mocks ? mocks[name] : require(name))
    },
    { filename: file }
  )
  return exports
}
class SourceCallError extends Error {
  constructor(code) {
    super(code)
    this.code = code
  }
}
const prefix = path.resolve(os.tmpdir(), 'ep-artist-artwork-')
const directory = await mkdtemp(prefix)
try {
  let calls = 0,
    downloads = 0
  let candidates = []
  let downloadFails = false
  const source = {
    id: 'fixture',
    version: '1',
    artistArtwork: {
      search: async () => {
        calls++
        return candidates
      }
    }
  }
  let sources = [source]
  let enabled = true
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } })
    .png()
    .toBuffer()
  const { resolveArtistArtwork, clearArtistArtworkCache } = load(
    'src/main/sources/artistArtwork.ts',
    {
      './index': { getNetworkSources: () => ({ list: () => (enabled ? sources : []) }) },
      './errors': { SourceCallError },
      '../utils/pathUtils': { getCoverPath: (...parts) => path.join(directory, ...parts) },
      './runtime': {
        invokeSource: (id, _operation, task, options) =>
          task(
            sources.find((entry) => entry.id === id),
            { signal: options?.signal }
          )
      },
      './artworkFetch': {
        fetchArtworkImage: async () => {
          downloads++
          if (downloadFails) throw new Error('HTTP')
          return { data: png, contentType: 'image/png' }
        }
      }
    }
  )
  const candidate = (name, resourceType = 'artist') => ({
    name,
    id: '1',
    imageUrl: 'https://fixture.test/portrait.png',
    resource: { resourceType }
  })
  candidates = [candidate('Different'), candidate('Artist', 'album'), candidate('Artist')]
  const [first, simultaneous] = await Promise.all([
    resolveArtistArtwork('Artist'),
    resolveArtistArtwork('Artist')
  ])
  assert.equal(first.path, simultaneous.path)
  assert.equal(calls, 1, 'concurrent requests share a write')
  assert.equal(downloads, 1, 'unrelated names and album images are rejected')
  await access(first.path)
  assert.equal((await sharp(first.path).metadata()).format, 'jpeg')
  enabled = false
  assert.equal(
    (await resolveArtistArtwork('  ARTIST  ')).path,
    first.path,
    'cached portraits work without installed/enabled providers'
  )
  enabled = true
  candidates = [candidate('Unrelated')]
  assert.equal((await resolveArtistArtwork('Missing')).path, null)
  const callsBefore = calls
  await resolveArtistArtwork('Missing')
  assert.equal(calls, callsBefore, 'negative results avoid repeated searches')
  source.version = '2'
  await resolveArtistArtwork('Missing')
  assert.equal(calls, callsBefore + 1, 'plugin upgrades retry negative results')
  candidates = [candidate('Retry')]
  downloadFails = true
  assert.equal((await resolveArtistArtwork('Retry')).path, null)
  downloadFails = false
  assert.ok((await resolveArtistArtwork('Retry')).path, 'failed downloads are retried')
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(resolveArtistArtwork('Cancelled', { signal: controller.signal }))
  await assert.rejects(resolveArtistArtwork('../'.repeat(501)), /INVALID_REQUEST/)
  assert.equal((await resolveArtistArtwork('__easy_player_unknown_artist__')).path, null)
  assert.equal(calls, callsBefore + 3)
  const waitFor = async (check) => {
    for (let i = 0; i < 200 && !check(); i++) await new Promise((done) => setTimeout(done, 5))
    assert(check(), 'test condition timed out')
  }
  // Every window shares the host's two slots, even with many incoming IPC calls.
  let started = 0,
    searching = 0,
    peak = 0
  let release
  const gate = new Promise((done) => {
    release = done
  })
  source.artistArtwork.search = async (name) => {
    started++
    searching++
    peak = Math.max(peak, searching)
    await gate
    searching--
    return [candidate(name)]
  }
  const batch = Array.from({ length: 5 }, (_, i) => resolveArtistArtwork('Limited ' + i))
  await waitFor(() => started === 2)
  await new Promise((done) => setTimeout(done, 20))
  assert.equal(started, 2, 'host admits only two artists at once')
  release()
  await Promise.all(batch)
  assert.equal(started, 5)
  assert.equal(peak, 2)
  const order = []
  sources = [
    {
      ...source,
      id: 'first',
      artistArtwork: {
        search: async () => {
          order.push('first')
          return [candidate('Wrong')]
        }
      }
    },
    {
      ...source,
      id: 'second',
      artistArtwork: {
        search: async (name) => {
          order.push('second')
          return [candidate(name)]
        }
      }
    },
    {
      ...source,
      id: 'unused',
      artistArtwork: {
        search: async () => {
          throw new Error('Matched artist must stop source searches')
        }
      }
    }
  ]
  assert.ok((await resolveArtistArtwork('Fallback')).path)
  assert.deepEqual(order, ['first', 'second'])
  sources = [source]
  started = 0
  source.artistArtwork.search = async (_name, { signal }) => {
    started++
    return new Promise((_done, reject) =>
      signal.addEventListener('abort', () => reject(signal.reason), { once: true })
    )
  }
  const interrupted = Promise.allSettled(
    Array.from({ length: 5 }, (_, i) => resolveArtistArtwork('Cancelled by clear ' + i))
  )
  await waitFor(() => started === 2)
  await writeFile(path.join(directory, 'album.jpg'), 'original album')
  await writeFile(path.join(directory, 'artists', 'notes.txt'), 'unrelated file')
  const clear = clearArtistArtworkCache()
  assert.equal(clearArtistArtworkCache(), clear, 'duplicate clear operations are coalesced')
  const cleared = await clear
  assert(cleared.files >= 7)
  assert((await interrupted).every((result) => result.status === 'rejected'))
  assert.equal(started, 2, 'clearing cancels queued work before it starts')
  await assert.rejects(access(first.path))
  await access(path.join(directory, 'album.jpg'))
  assert.deepEqual(await readdir(path.join(directory, 'artists')), ['notes.txt'])
  source.artistArtwork.search = async (name) => [candidate(name)]
  assert.ok(
    (await resolveArtistArtwork('Missing')).path,
    'clear removes negative results and allows fresh matching'
  )
  assert.ok(
    (await resolveArtistArtwork('Artist')).path,
    'portraits can be fetched again after clearing'
  )
  console.log(
    'Artist artwork: exact matching, artist-only resources, concurrency, disk cache, offline reuse, miss TTL, upgrade retry, download retry, cancellation, global two-task limit, sequential source fallback and cache clearing passed'
  )
} finally {
  const target = path.resolve(directory)
  assert(target.startsWith(prefix) && path.dirname(target) === path.resolve(os.tmpdir()))
  await rm(target, { recursive: true, force: true })
}

const { reactive, ref, effectScope, nextTick } = require('vue')
const ui = reactive({ autoSearchArtistArtwork: true, localArtistArtworkNames: [] })
const requests = []
let cacheCleared
const renderer = load(
  'src/renderer/src/services/artistArtwork.ts',
  {
    '@/stores/ui/uiStore': { useUIStore: () => ui }
  },
  {
    window: {
      api: {
        metadata: {
          onArtistArtworkCacheCleared: (callback) => {
            cacheCleared = callback
            return () => {}
          },
          resolveArtistArtwork: (name) => new Promise((done) => requests.push({ name, done }))
        }
      }
    }
  }
)
const flush = async () => {
  for (let i = 0; i < 8; i++) await nextTick()
}
const artistName = ref('Renderer Artist')
const visible = ref(true)
const scope = effectScope()
const state = scope.run(() => renderer.useArtistArtwork(artistName, visible))
assert.equal(requests.length, 1)
requests[0].done({ success: true, data: { path: '/cached/artist.jpg' } })
await flush()
assert.equal(state.networkPath.value, '/cached/artist.jpg')
state.toggle()
await flush()
assert.equal(state.useLocal.value, true)
assert.equal(state.networkPath.value, null, 'manual original portrait wins over network cache')
assert.equal(ui.localArtistArtworkNames[0], 'renderer artist')
state.toggle()
await flush()
assert.equal(state.networkPath.value, '/cached/artist.jpg')
assert.equal(requests.length, 1, 'switching back reuses cache')
ui.autoSearchArtistArtwork = false
await flush()
assert.equal(state.networkPath.value, null, 'global disable restores original portrait')
ui.autoSearchArtistArtwork = true
artistName.value = 'Old Artist'
await flush()
const oldRequest = requests.at(-1)
artistName.value = 'New Artist'
await flush()
oldRequest.done({ success: true, data: { path: '/cached/wrong.jpg' } })
await flush()
assert.equal(state.networkPath.value, null, 'late results cannot replace the next artist')
requests.at(-1).done({ success: true, data: { path: '/cached/new.jpg' } })
await flush()
assert.equal(state.networkPath.value, '/cached/new.jpg')
// Clearing invalidates displayed paths without immediately downloading them again.
const beforeClear = requests.length
cacheCleared()
await flush()
assert.equal(state.networkPath.value, null)
assert.equal(requests.length, beforeClear)
artistName.value = 'After Clear'
await flush()
const pendingOnClear = requests.at(-1)
cacheCleared()
await flush()
pendingOnClear.done({ success: true, data: { path: '/cached/stale.jpg' } })
await flush()
assert.equal(state.networkPath.value, null, 'late requests cannot restore a cleared portrait')
artistName.value = 'New Artist'
await flush()
assert.equal(
  requests.length,
  beforeClear + 2,
  'cleared in-memory cache is fetched again on navigation'
)
requests.at(-1).done({ success: true, data: { path: '/cached/refetched.jpg' } })
await flush()
assert.equal(state.networkPath.value, '/cached/refetched.jpg')
scope.stop()

// Scrolling away drops a queued portrait. Revisiting it queues a fresh request in order,
// and dropping one of two cards for the same artist leaves the other request intact.
const queued = (name) => {
  const scope = effectScope()
  const visible = ref(true)
  const state = scope.run(() => renderer.useArtistArtwork(ref(name), visible))
  return { scope, visible, state }
}
const start = requests.length
const first = queued('Active first')
const second = queued('Active second')
const revisit = queued('Revisited')
const shared = queued('Shared queue entry')
const duplicate = queued('Shared queue entry')
assert.equal(requests.length, start + 2)
revisit.visible.value = false
duplicate.scope.stop()
await flush()
revisit.visible.value = true
await flush()
requests[start].done({ success: false })
await flush()
assert.equal(requests[start + 2].name, 'Shared queue entry')
requests[start + 2].done({ success: true, data: { path: '/shared.jpg' } })
await flush()
assert.equal(shared.state.networkPath.value, '/shared.jpg')
assert.equal(requests[start + 3].name, 'Revisited')
requests[start + 1].done({ success: false })
requests[start + 3].done({ success: false })
await flush()
for (const entry of [first, second, revisit, shared]) entry.scope.stop()

console.log(
  'Artist portrait UI state: cache reuse, global disable, route race guards, queue disposal, deduplication and cross-window cache invalidation passed'
)
