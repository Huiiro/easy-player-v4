/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { parse } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import * as Pinia from 'pinia'

function run(source, mocks, globals = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in mocks, `Unexpected import: ${name}`)
        return mocks[name]
      },
      console,
      ...globals
    }
  )
  return exports
}

const listeners = new Map()
const documentListeners = new Map()
const timers = new Map()
let timerId = 0
let nativeState = 'ready'
const emit = (type, data) => {
  for (const callback of listeners.get(type) ?? []) callback(data)
}
const subscribe = (type) => (callback) => {
  if (!listeners.has(type)) listeners.set(type, new Set())
  listeners.get(type).add(callback)
  return () => listeners.get(type).delete(callback)
}
const bridge = new Proxy(
  {
    onStateChanged: subscribe('state'),
    onPositionChanged: subscribe('position'),
    onAudioChainChanged: subscribe('chain'),
    onTrackEnded: subscribe('ended'),
    play: async () => {
      if (!['ready', 'paused'].includes(nativeState)) return nativeState === 'playing'
      nativeState = 'playing'
      emit('state', { state: nativeState })
      return true
    },
    pause: async () => {
      if (nativeState !== 'playing') return false
      nativeState = 'paused'
      emit('state', { state: nativeState })
      return true
    },
    getEqBands: async () => [],
    getDspNodes: async () => [],
    enumerateDevices: async () => []
  },
  { get: (target, key) => target[key] ?? (async () => null) }
)
const logs = { entries: [], addEntry() {} }
const globals = {
  window: {
    api: {
      audio: { setAnalysisEnabled: async () => ({ success: true }) },
      database: {
        command: async () => ({ success: true, data: [] }),
        saveSync: () => ({ success: true })
      },
      miniPlayer: {
        update() {},
        onAction: subscribe('mini'),
        onRequestState: subscribe('request')
      },
      system: { updateTray() {}, onTrayAction: subscribe('tray') }
    }
  },
  document: {
    hidden: false,
    addEventListener: (type, callback) => documentListeners.set(type, callback),
    removeEventListener: (type) => documentListeners.delete(type)
  },
  setTimeout: (callback) => {
    timers.set(++timerId, callback)
    return timerId
  },
  clearTimeout: (id) => timers.delete(id),
  setInterval: (callback) => {
    timers.set(++timerId, callback)
    return timerId
  },
  clearInterval: (id) => timers.delete(id),
  performance
}
const module = run(
  readFileSync('src/renderer/src/stores/player/playerStore.ts', 'utf8'),
  {
    vue: Vue,
    pinia: Pinia,
    '@/stores/persistence': { flushPlayerDataStorage() {} },
    '@/services/audioBridge': { audioBridge: bridge },
    './smartShuffle': {},
    '@/stores/log/logStore': { useLogStore: () => logs },
    '@/stores/ui/uiStore': { useUIStore: () => ({ extremePlayback: false, customBg: {} }) },
    '@/stores/statistics/statisticsStore': {
      useStatisticsStore: () => ({ enabled: false, ready: true })
    },
    '@/components/ui/useMessage': { useMessage: () => ({ warning() {}, success() {}, info() {} }) },
    '@/i18n': { t: (key) => key },
    '@/consts': { PlayMode: { List: 0, Random: 1, Single: 2 } },
    '@/utils/eventBus': { default: { emit() {} } }
  },
  globals
)
Pinia.setActivePinia(Pinia.createPinia())
const player = module.usePlayerStore()
const devScript = parse(readFileSync('src/renderer/src/views/dev/Index.vue', 'utf8')).descriptor
  .scriptSetup.content
player.subscribeToEvents() // Owned by the outer playback lifecycle, which outlives routes.
assert.equal(await player.play(), true)

for (let visit = 0; visit < 3; visit++) {
  if (visit === 1) assert.equal(await player.pause(), true)
  const mounted = []
  const unmounted = []
  const scope = Vue.effectScope()
  scope.run(() =>
    run(
      devScript,
      {
        vue: {
          ...Vue,
          onMounted: (callback) => mounted.push(callback),
          onUnmounted: (callback) => unmounted.push(callback)
        },
        '@/stores/player/playerStore': { usePlayerStore: () => player },
        '@/stores/log/logStore': { useLogStore: () => logs }
      },
      globals
    )
  )
  for (const callback of mounted) await callback()
  // KeepAlive evicts this route after enough other pages have been visited.
  for (const callback of unmounted) callback()
  scope.stop()

  for (const type of ['state', 'position', 'chain', 'ended', 'mini', 'request', 'tray'])
    assert.equal(listeners.get(type).size, 1, `Leaving the debug route must preserve ${type}`)
  assert.ok(documentListeners.has('visibilitychange'))
  const positionMs = 1000 + visit * 1000
  emit('position', { positionMs, durationMs: 60000 })
  assert.equal(player.positionMs, positionMs, 'Progress must keep updating after route changes')
  if (visit === 1) {
    assert.equal(player.isPaused, true, 'Leaving a page while paused must preserve paused state')
    assert.equal(await player.play(), true)
    assert.equal(player.isPlaying, true)
  }
  assert.equal(await player.pause(), true)
  assert.equal(player.isPaused, true, 'Pause must update the button after leaving the debug page')
  assert.equal(await player.play(), true)
  assert.equal(player.isPlaying, true, 'The same button must resume the paused engine')
  await Vue.nextTick()
}

// A new track's notifications must also arrive through the surviving subscriptions.
emit('state', { state: 'ready', trackInfo: { filePath: 'next.wav' } })
emit('position', { positionMs: 0, durationMs: 90000 })
nativeState = 'ready'
assert.equal(await player.play(), true)
emit('position', { positionMs: 700, durationMs: 90000 })
assert.equal(player.isPlaying, true)
assert.equal(player.positionMs, 700)
assert.equal(player.trackInfo.filePath, 'next.wav')

player.unsubscribe() // Only teardown of the outer lifecycle releases shared listeners.
for (const callbacks of listeners.values()) assert.equal(callbacks.size, 0)
assert.equal(documentListeners.size, 0)
assert.equal(timers.size, 0, 'Route timers and playback timers must be cleaned up')
player.subscribeToEvents()
emit('position', { positionMs: 900, durationMs: 90000 })
assert.equal(player.positionMs, 900, 'A replacement playback lifecycle can subscribe again')
player.unsubscribe()
console.log('Playback route subscription regression tests passed')
