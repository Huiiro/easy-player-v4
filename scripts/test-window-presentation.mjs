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
const { createWindowPresentation } = load('src/main/service/windowPresentation.ts')
function fixture() {
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
    presentation: createWindowPresentation(window, () => shown++),
    count: () => shown,
    close: () => {
      destroyed = true
      window.emit('closed')
    }
  }
}
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
console.log(
  'Window presentation: readiness ordering, captured frame, cancel/close, reopen and layout notification passed.'
)
