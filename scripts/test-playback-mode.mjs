/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import * as Vue from 'vue'
import * as Pinia from 'pinia'
const { reactive, nextTick } = Vue
const { createPinia, setActivePinia } = Pinia

const require = createRequire(import.meta.url)
function load(file, mocks = {}, globals = {}) {
  const source = ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports = {}
  vm.runInNewContext(
    source,
    {
      exports,
      require: (name) => mocks[name] ?? require(name),
      console,
      setTimeout,
      clearTimeout,
      ...globals
    },
    { filename: file }
  )
  return exports
}
const policy = load('src/main/service/playbackMode.ts')
const changes = []
const off = policy.onPlaybackModeChanged((enabled) => changes.push(enabled))
policy.setPlaybackOnly(true)
policy.setPlaybackOnly(true)
let resumed = false
const wait = policy.waitForBackgroundWork().then(() => {
  resumed = true
})
await Promise.resolve()
assert.equal(resumed, false)
assert.throws(() => policy.requireBackgroundWork())
policy.setPlaybackOnly(false)
await wait
assert.equal(resumed, true)
assert.deepEqual(changes, [true, false])
off()
policy.setPlaybackOnly(true)
assert.equal(changes.length, 2)
policy.setPlaybackOnly(false)

const ui = reactive({ extremePlayback: false, showPlayer: true, customBg: {} })
const calls = []
let accepted = true
let acceptView = true
const viewRequests = []
const pageDataset = {}
const api = {
  audio: {
    attachRenderer: async () => ({ success: true, data: [] }),
    setExtremePlayback: async (enabled) => {
      calls.push(['mode', enabled])
      return { success: accepted }
    },
    switchPlaybackView: async (enabled) => {
      viewRequests.push(enabled)
      return { success: acceptView }
    },
    setAnalysisEnabled: async (enabled) => {
      calls.push(['analysis', enabled])
      return { success: true }
    }
  },
  database: {
    saveSync: () => ({ success: true }),
    command: async () => ({ success: true, data: [] })
  },
  miniPlayer: { update() {} },
  system: { updateTray() {} }
}
const bridge = new Proxy({}, { get: () => async () => true })
const playerModule = load(
  'src/renderer/src/stores/player/playerStore.ts',
  {
    vue: Vue,
    pinia: Pinia,
    '@/stores/persistence': { flushPlayerDataStorage() {} },
    '@/services/audioBridge': { audioBridge: bridge },
    './smartShuffle': { selectSmartNext: () => -1 },
    '@/stores/log/logStore': { useLogStore: () => ({ addEntry() {} }) },
    '@/stores/ui/uiStore': { useUIStore: () => ui },
    '@/components/ui/useMessage': { useMessage: () => ({ warning() {} }) },
    '@/i18n': { t: (key) => key },
    '@/consts': { PlayMode: { List: 0, Random: 1, Single: 2 } },
    '@/utils/eventBus': { default: { emit() {} } }
  },
  {
    window: { api },
    document: {
      hidden: false,
      documentElement: { dataset: pageDataset, classList: { toggle() {}, remove() {} } }
    }
  }
)
setActivePinia(createPinia())
const player = playerModule.usePlayerStore()
player.setAudioAnalysisPollingRate(30, true)
await player.setExtremePlayback(true)
await nextTick()
assert.equal(ui.extremePlayback, true)
assert.equal(ui.showPlayer, true, 'the outgoing immersive player must stay unchanged')
assert.equal(player.playbackModeChanging, false)
assert.deepEqual(calls.at(-1), ['analysis', false])
assert.deepEqual(viewRequests, [true])
pageDataset.playbackView = 'extreme'
await player.refreshAudioAnalysis(true)
await player.setExtremePlayback(false)
assert.equal(ui.extremePlayback, false)
assert.deepEqual(calls.at(-1), ['analysis', true])
assert.deepEqual(viewRequests, [true, false])
delete pageDataset.playbackView
accepted = false
await player.setExtremePlayback(true)
assert.equal(ui.extremePlayback, false, 'failed native switch must not activate UI-only mode')
assert.equal(player.playbackModeChanging, false)
accepted = true
acceptView = false
await player.setExtremePlayback(true)
assert.equal(ui.extremePlayback, false, 'rejected renderer switch must restore native and UI mode')
assert.ok(calls.some(([action, enabled]) => action === 'mode' && enabled === false))
acceptView = true
const viewRequestCount = viewRequests.length
await player.setExtremePlayback(true, false)
assert.equal(ui.showPlayer, false, 'extreme renderer initialization clears immersive state')
assert.equal(
  viewRequests.length,
  viewRequestCount,
  'initialization must not replace its own window'
)
console.log(
  'Playback policy suspension/resume, mode switching, analysis suppression and failure recovery passed.'
)
