/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(file, globals = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    { exports, ...globals }
  )
  return exports
}
const { createWindowPresentation, revealPaintedWindow } = load(
  'src/main/service/windowPresentation.ts'
)
let finishPaint
let finishNativeCapture
let nativeOpacity = 0
let nativeCaptures = 0
const nativeWindow = {
  isDestroyed: () => false,
  setOpacity: (opacity) => {
    nativeOpacity = opacity
  },
  webContents: {
    executeJavaScript: () =>
      new Promise((resolve) => {
        finishPaint = resolve
      }),
    capturePage: () => {
      nativeCaptures++
      return new Promise((resolve) => {
        finishNativeCapture = resolve
      })
    }
  }
}
const reveal = revealPaintedWindow(nativeWindow)
assert.equal(nativeOpacity, 0, 'keep the native show/maximize surface transparent')
finishPaint()
for (let i = 0; i < 5; i++) await Promise.resolve()
assert.equal(nativeCaptures, 1)
assert.equal(
  nativeOpacity,
  0,
  'do not expose the window until its resized compositor frame is ready'
)
finishNativeCapture()
await reveal
assert.equal(nativeOpacity, 1)
function fixture(showStartupScreen = false) {
  const window = new EventEmitter()
  let destroyed = false
  let throttling = true
  window.webContents = {
    capturePage: async () => {},
    getBackgroundThrottling: () => throttling,
    setBackgroundThrottling: (enabled) => {
      throttling = enabled
    }
  }
  window.isDestroyed = () => destroyed
  let shown = 0
  return {
    window,
    presentation: createWindowPresentation(window, () => shown++, true, showStartupScreen),
    count: () => shown,
    close: () => {
      destroyed = true
      window.emit('closed')
    }
  }
}
const startup = fixture(true)
startup.presentation.show()
assert.equal(startup.count(), 0, 'wait for the static logo frame before showing the main window')
startup.window.emit('ready-to-show')
assert.equal(startup.count(), 0, 'native readiness cannot expose an unpainted startup page')
let captureStartup
startup.window.webContents.capturePage = () =>
  new Promise((resolve) => {
    captureStartup = resolve
  })
const startupPresented = startup.presentation.startupReady()
assert.equal(startup.count(), 0, 'wait for the decoded logo frame to be captured')
captureStartup()
await startupPresented
assert.equal(startup.count(), 1, 'show the logo while application initialization is pending')
startup.window.webContents.capturePage = async () => {}
startup.presentation.rendererReady()
for (let i = 0; i < 5; i++) await Promise.resolve()
assert.equal(startup.count(), 1, 'application readiness must not refocus the startup window')
assert.equal(startup.window.webContents.getBackgroundThrottling(), true)
const canceledStartup = fixture(true)
canceledStartup.presentation.show()
canceledStartup.presentation.cancel()
canceledStartup.window.emit('ready-to-show')
assert.equal(canceledStartup.count(), 0, 'a canceled startup must remain hidden')
const canceledStartupReady = canceledStartup.presentation.startupReady()
for (let i = 0; i < 5; i++) await Promise.resolve()
assert.equal(canceledStartup.count(), 0)
canceledStartup.close()
assert.equal(await canceledStartupReady, false)
assert.equal(await fixture().presentation.startupReady(), false, 'replacement windows skip startup')
const asynchronous = fixture()
let finishPresentation
const nativePresentation = createWindowPresentation(
  asynchronous.window,
  () =>
    new Promise((resolve) => {
      finishPresentation = resolve
    }),
  true,
  true
)
nativePresentation.show()
asynchronous.window.emit('ready-to-show')
let startupAcknowledged = false
const acknowledgement = nativePresentation.startupReady().then(() => {
  startupAcknowledged = true
})
for (let i = 0; i < 5; i++) await Promise.resolve()
assert.equal(startupAcknowledged, false, 'bootstrap must wait for the native opacity guard')
finishPresentation()
await acknowledgement
assert.equal(startupAcknowledged, true)
for (const rendererFirst of [false, true]) {
  const f = fixture()
  assert.equal(f.window.webContents.getBackgroundThrottling(), false)
  f.presentation.show()
  if (rendererFirst) f.presentation.rendererReady()
  else f.window.emit('ready-to-show')
  assert.equal(f.count(), 0, 'one readiness signal cannot expose a loading page')
  if (rendererFirst) f.window.emit('ready-to-show')
  else f.presentation.rendererReady()
  for (let i = 0; i < 5; i++) await Promise.resolve()
  assert.equal(f.count(), 1)
  assert.equal(
    f.window.webContents.getBackgroundThrottling(),
    true,
    'restore background throttling after startup'
  )
  f.presentation.rendererReady()
  assert.equal(f.count(), 1, 'late state updates cannot reopen a hidden window')
  f.presentation.show()
  assert.equal(f.count(), 2, 'an initialized window can reopen immediately')
}
const capturing = fixture()
let completeCapture
capturing.window.webContents.capturePage = () =>
  new Promise((resolve) => {
    completeCapture = resolve
  })
capturing.presentation.show()
capturing.window.emit('ready-to-show')
capturing.presentation.rendererReady()
assert.equal(capturing.count(), 0, 'do not show until the updated compositor frame is captured')
completeCapture()
for (let i = 0; i < 5; i++) await Promise.resolve()
assert.equal(capturing.count(), 1)

const canceled = fixture()
canceled.presentation.show()
canceled.presentation.cancel()
canceled.window.emit('ready-to-show')
canceled.presentation.rendererReady()
for (let i = 0; i < 5; i++) await Promise.resolve()
assert.equal(canceled.count(), 0, 'canceling Mini before load cannot reopen it later')
canceled.presentation.show()
assert.equal(canceled.count(), 1)
const closed = fixture()
closed.presentation.show()
closed.close()
closed.window.emit('ready-to-show')
closed.presentation.rendererReady()
assert.equal(closed.count(), 0)

let sent = 0
let layoutFlushed = false
const document = {
  documentElement: {
    dataset: {},
    getBoundingClientRect: () => {
      layoutFlushed = true
    }
  }
}
const { notifyWindowReady } = load('src/renderer/src/services/windowReady.ts', {
  require: () => ({ nextTick: () => Promise.resolve() }),
  document,
  window: {
    api: {
      window: {
        ready: () => {
          assert.equal(layoutFlushed, true)
          sent++
        }
      }
    }
  }
})
const first = notifyWindowReady()
assert.equal(notifyWindowReady(), first)
assert.equal(sent, 0, 'do not notify before Vue commits')
await first
assert.equal(document.documentElement.dataset.windowReady, 'true')
assert.equal(sent, 1)
await notifyWindowReady()
assert.equal(sent, 1, 'notify the host once per renderer')
const paintCallbacks = []
const visibleRoot = {
  dataset: { startupPresented: 'true' },
  getBoundingClientRect: () => ({})
}
let visibleSent = false
const { notifyWindowReady: visibleReady } = load('src/renderer/src/services/windowReady.ts', {
  require: () => ({ nextTick: () => Promise.resolve() }),
  document: { documentElement: visibleRoot, hidden: false },
  window: {
    requestAnimationFrame: (callback) => paintCallbacks.push(callback),
    api: {
      window: {
        ready: () => {
          visibleSent = true
        }
      }
    }
  }
})
const painted = visibleReady()
for (let i = 0; i < 5; i++) await Promise.resolve()
assert.equal(visibleSent, false)
assert.equal(visibleRoot.dataset.windowReady, undefined)
paintCallbacks.shift()()
assert.equal(visibleSent, false, 'do not fade the splash before the underlying app is painted')
paintCallbacks.shift()()
await painted
assert.equal(visibleSent, true)
console.log(
  'Window presentation: readiness ordering, captured frame, cancel/close, reopen and layout notification passed.'
)
