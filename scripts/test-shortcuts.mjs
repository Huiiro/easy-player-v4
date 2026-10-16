/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { reactive, watch, nextTick } from 'vue'
import ts from 'typescript'

function load(file, mocks = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in mocks, `Unexpected dependency: ${name}`)
        return mocks[name]
      },
      ...globals
    }
  )
  return exports
}
const shared = load('src/shared/shortcuts.ts')
const ui = reactive({
  shortcutKeys: { ...shared.DEFAULT_LOCAL_SHORTCUTS },
  globalShortcutKeys: { ...shared.DEFAULT_GLOBAL_SHORTCUTS },
  useGlobalShortcutKeys: false,
  useDesktopLyrics: false,
  extremePlayback: false
})
assert.equal(new Set(Object.values(ui.shortcutKeys)).size, shared.SHORTCUT_ACTIONS.length)
const mounted = []
const unmounted = []
const watchers = []
const listeners = new Map()
const calls = []
const warnings = []
const pageDataset = {}
let globalAction
let preference = 0
let rejectPreference = false
const player = reactive({
  currentFile: 'song.wav',
  currentQueueSong: { id: 42 },
  durationMs: 10000,
  positionMs: 4000,
  isPlaying: false,
  volume: 0.5,
  playPrevious: async () => calls.push('previous'),
  playNext: async () => calls.push('next'),
  play: async () => {
    player.isPlaying = true
  },
  pause: async () => {
    player.isPlaying = false
  },
  setVolume: async (value) => {
    player.volume = value
  },
  seek: async (value) => {
    player.positionMs = value
  },
  setPreference: async (songId, value) => {
    if (rejectPreference) throw new Error('Database unavailable')
    calls.push(['preference', songId, value])
    preference = value
    return true
  },
  setExtremePlayback: async (enabled) => {
    calls.push(['lightweight', enabled])
    ui.extremePlayback = enabled
    pageDataset.playbackView = enabled ? 'extreme' : 'normal'
  }
})
const api = {
  database: { command: async () => ({ success: true, data: { preference } }) },
  shortcuts: {
    registerGlobal: async (keys) => {
      calls.push(['register', keys])
      return { success: true }
    },
    unregisterGlobal: async () => calls.push('unregister'),
    onAction: (callback) => {
      globalAction = callback
      return () => {
        globalAction = undefined
      }
    }
  }
}
const hook = load(
  'src/renderer/src/hooks/useShortcuts.ts',
  {
    vue: {
      onMounted: (fn) => mounted.push(fn),
      onBeforeUnmount: (fn) => unmounted.push(fn),
      watch: (...args) => {
        watchers.push(watch(...args))
      }
    },
    '@/stores/ui/uiStore': { useUIStore: () => ui },
    '@/stores/player/playerStore': { usePlayerStore: () => player },
    '@/components/ui/useMessage': {
      useMessage: () => ({ warning: (text) => warnings.push(text) })
    },
    '@/utils/shortcut': load('src/renderer/src/utils/shortcut.ts'),
    'vue-i18n': { useI18n: () => ({ t: (key) => key }) },
    '../../../shared/shortcuts': shared
  },
  {
    document: { documentElement: { dataset: pageDataset } },
    window: {
      api,
      addEventListener: (event, handler) => listeners.set(event, handler),
      removeEventListener: (event) => listeners.delete(event)
    }
  }
)
hook.useShortcuts()
mounted.forEach((fn) => fn())
const settle = () => new Promise((resolve) => setImmediate(resolve))
async function press(key, options = {}) {
  const event = {
    key,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    target: { closest: () => false },
    preventDefault() {
      this.prevented = true
    },
    ...options
  }
  listeners.get('keydown')(event)
  await settle()
  return event
}
await press('ArrowRight')
assert.equal(player.positionMs, 9000)
await press('ArrowRight')
assert.equal(player.positionMs, 10000, 'Fast-forward is clamped to track duration')
await press('ArrowLeft')
assert.equal(player.positionMs, 5000)
await press('ArrowLeft')
await press('ArrowLeft')
assert.equal(player.positionMs, 0, 'Rewind is clamped to zero')
player.currentFile = null
await press('ArrowRight')
assert.equal(player.positionMs, 0, 'Seeking without a loaded track is ignored')
player.currentFile = 'song.wav'
await press('ArrowRight', { target: { closest: () => true } })
await press('ArrowRight', { isComposing: true })
await press('ArrowRight', { defaultPrevented: true })
assert.equal(player.positionMs, 0, 'Shortcuts must respect text input and handled events')
await press('l', { ctrlKey: true })
assert.equal(preference, 1)
await press('l', { ctrlKey: true, repeat: true })
assert.equal(preference, 1, 'Holding a shortcut must not repeatedly toggle feedback')
await press('l', { ctrlKey: true })
assert.equal(preference, 0)
await press('d', { ctrlKey: true })
assert.equal(preference, -1)
await press('l', { ctrlKey: true })
assert.equal(preference, 1, 'Liking replaces reduced recommendation feedback')
await press('d', { ctrlKey: true })
await press('d', { ctrlKey: true })
assert.equal(preference, 0, 'Reduced recommendation feedback can be undone')
player.currentQueueSong = null
await press('l', { ctrlKey: true })
assert.equal(preference, 0)
player.currentQueueSong = { id: 42 }
rejectPreference = true
await press('l', { ctrlKey: true })
assert.equal(warnings.at(-1), 'settings.shortcutActionFailed')
rejectPreference = false
await press('l', { ctrlKey: true })
assert.equal(preference, 1, 'Feedback remains usable after an error')
await press('l', { ctrlKey: true, shiftKey: true })
assert.equal(ui.useDesktopLyrics, true)
await press('l', { ctrlKey: true, shiftKey: true })
assert.equal(ui.useDesktopLyrics, false)
// A saved mode flag can disagree with the actual window after startup or a failed handoff.
ui.extremePlayback = true
await press('e', { ctrlKey: true })
assert.equal(ui.extremePlayback, true)
assert.equal(
  pageDataset.playbackView,
  'extreme',
  'Default shortcut must switch a full window even if the saved mode is already true'
)
await press('e', { ctrlKey: true })
globalAction('enableLightweight')
await settle()
assert.deepEqual(
  calls.filter((call) => Array.isArray(call) && call[0] === 'lightweight'),
  [['lightweight', true]],
  'Lightweight mode must only be exited manually'
)
await press('l', { ctrlKey: true, shiftKey: true })
assert.equal(ui.useDesktopLyrics, false)
assert.equal(warnings.at(-1), 'settings.desktopLyricsLightweight')
globalAction('seekForward')
await settle()
assert.equal(player.positionMs, 5000, 'Global actions share the local playback behavior')
globalAction('like')
await settle()
assert.equal(preference, 0, 'Feedback works with lightweight recommendation caches suspended')
ui.useGlobalShortcutKeys = true
ui.globalShortcutKeys.seekForward = 'ctrl+alt+right'
await nextTick()
await settle()
assert.equal(calls.at(-1)[0], 'register')
assert.equal(calls.at(-1)[1].seekForward, 'ctrl+alt+right')
await press('ArrowLeft', { ctrlKey: true })
await press('ArrowRight', { ctrlKey: true })
assert.ok(
  calls.includes('previous') && calls.includes('next'),
  'Existing track shortcuts still work'
)
await press(' ')
assert.equal(player.isPlaying, true)
await press(' ')
assert.equal(player.isPlaying, false)
unmounted.forEach((fn) => fn())
watchers.forEach((stop) => stop())
assert.equal(listeners.size, 0)
assert.equal(globalAction, undefined)
console.log(
  'Local/global shortcut actions, seek boundaries, feedback, mode policy and cleanup passed'
)

// Exercise the main-process registration path with Electron's native boundary mocked.
const mainSource = readFileSync('src/main/index.ts', 'utf8')
const registrationSource = mainSource.slice(
  mainSource.indexOf('function registerGlobalShortcuts('),
  mainSource.indexOf('\ninterface WindowState')
)
const accelerators = new Map()
const delivered = []
const registration = {}
vm.runInNewContext(
  ts.transpileModule(`${registrationSource}\nexports.register = registerGlobalShortcuts`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText,
  {
    exports: registration,
    SHORTCUT_ACTIONS: shared.SHORTCUT_ACTIONS,
    process,
    Logger: { debug: () => undefined, warn: () => undefined },
    mainWindow: { webContents: { send: (channel, action) => delivered.push([channel, action]) } },
    globalShortcut: {
      unregisterAll: () => accelerators.clear(),
      register: (key, callback) => {
        accelerators.set(key, callback)
        return true
      }
    }
  }
)
const globalKeys = Object.fromEntries(
  shared.SHORTCUT_ACTIONS.map((action, index) => [action, `ctrl+alt+f${index + 1}`])
)
assert.equal(registration.register(globalKeys).length, 0)
for (const action of shared.SHORTCUT_ACTIONS) {
  accelerators.get(globalKeys[action])()
  assert.deepEqual(delivered.at(-1), ['shortcuts:action', action])
}
registration.register(shared.DEFAULT_GLOBAL_SHORTCUTS)
assert.equal(accelerators.size, 0, 'Cleared global bindings must be unregistered')
console.log('Main-process registration and dispatch passed for every shortcut action')
