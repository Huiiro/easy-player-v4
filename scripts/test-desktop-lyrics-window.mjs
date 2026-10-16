/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'
import ts from 'typescript'

const ui = Vue.reactive({
  useDesktopLyrics: false,
  extremePlayback: false,
  lyricSourceOrder: ['embedded'],
  lyricSourceMode: 'auto',
  autoSearchNetworkLyrics: false,
  preferWordTimedNetworkLyrics: true,
  desktopLyricsStyles: { fontSize: 34, showTranslation: true },
  customFontFamily: '',
  resolveFontStack: (family) => family || 'system-ui'
})
const player = Vue.reactive({
  currentQueueSong: { id: 1, title: 'Test song' },
  positionMs: 0,
  durationMs: 10000,
  isPlaying: true
})
const subscriptions = new Map()
const listen = (event, callback) => {
  subscriptions.set(event, callback)
  return () => subscriptions.delete(event)
}
let windowOpen = false
let opened = 0
let closed = 0
let published = 0
let pendingOpen
const api = {
  open: async () => {
    opened++
    windowOpen = true
    await pendingOpen
    return { success: true }
  },
  close: async () => {
    closed++
    windowOpen = false
    subscriptions.get('closed')?.()
    return { success: true }
  },
  update: () => {
    published++
  },
  onAction: (callback) => listen('action', callback),
  onRequestState: (callback) => listen('request', callback),
  onFontSizeChanged: (callback) => listen('font-size', callback),
  onClosed: (callback) => listen('closed', callback)
}
const { descriptor } = parse(
  readFileSync('src/renderer/src/components/lyrics/DesktopLyricsSync.vue', 'utf8')
)
const script = compileScript(descriptor, { id: 'desktop-lyrics-window-test' })
const exports = {}
const mocks = {
  vue: Vue,
  '@/services/lyrics': { resolveLyrics: async () => ({ lines: [] }) },
  '@/stores/player/playerStore': { usePlayerStore: () => player },
  '@/stores/ui/uiStore': { useUIStore: () => ui },
  '@/utils/eventBus': { default: { on() {}, off() {} } }
}
vm.runInNewContext(
  ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText,
  { exports, require: (name) => mocks[name], window: { api: { desktopLyrics: api } } }
)
const Sync = exports.default
Sync.render = () => null
const node = () => ({ children: [], parent: null })
const renderer = Vue.createRenderer({
  createElement: node,
  createText: node,
  createComment: node,
  setText() {},
  setElementText() {},
  patchProp() {},
  parentNode: (value) => value.parent,
  nextSibling: () => null,
  insert: (value, parent) => {
    value.parent = parent
    parent.children.push(value)
  },
  remove: (value) => {
    value.parent.children = value.parent.children.filter((child) => child !== value)
    value.parent = null
  }
})
// Mirror the layout's conditional mount instead of testing only the preference boolean.
const app = renderer.createApp({
  setup: () => () => (!ui.extremePlayback && ui.useDesktopLyrics ? Vue.h(Sync) : null)
})
app.mount(node())
async function settle() {
  await Vue.nextTick()
  await new Promise((resolve) => setImmediate(resolve))
}
assert.equal(opened, 0)
for (let index = 0; index < 3; index++) {
  ui.useDesktopLyrics = true
  await settle()
  assert.equal(windowOpen, true)
  ui.useDesktopLyrics = false
  await settle()
  assert.equal(windowOpen, false, 'Disabling lyrics must close the native window on unmount')
  assert.equal(subscriptions.size, 0, 'Disabling lyrics must release IPC listeners')
}
assert.equal(opened, 3)
assert.equal(closed, 3)

ui.useDesktopLyrics = true
await settle()
windowOpen = false
subscriptions.get('closed')()
await settle()
assert.equal(ui.useDesktopLyrics, false, 'Closing the overlay must synchronize the setting')
assert.equal(subscriptions.size, 0)

let finishOpen
pendingOpen = new Promise((resolve) => {
  finishOpen = resolve
})
ui.useDesktopLyrics = true
await settle()
ui.useDesktopLyrics = false
await settle()
const publishedBefore = published
finishOpen()
await settle()
assert.equal(windowOpen, false, 'A delayed open response must not leave an orphaned window')
assert.equal(published, publishedBefore, 'Unmounted synchronizers must not publish stale state')
pendingOpen = undefined

ui.useDesktopLyrics = true
await settle()
ui.extremePlayback = true
await settle()
assert.equal(windowOpen, false, 'Entering lightweight mode must close the overlay')
ui.extremePlayback = false
await settle()
assert.equal(windowOpen, true, 'Returning to the full player restores enabled desktop lyrics')
app.unmount()
assert.equal(windowOpen, false, 'Leaving the layout must close the overlay')
assert.equal(subscriptions.size, 0)
console.log(
  'Desktop lyrics window toggling, cleanup, delayed open and lightweight transitions passed'
)
