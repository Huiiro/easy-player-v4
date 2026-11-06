/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const exports = {}
vm.runInNewContext(
  ts.transpileModule(readFileSync('src/renderer/src/services/automaticUpdates.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText,
  {
    exports,
    setTimeout: () => {
      throw Error('Startup checks must never schedule timers')
    },
    setInterval: () => {
      throw Error('Startup checks must never schedule periodic work')
    }
  }
)
const { createAutomaticUpdateChecker } = exports
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
let calls = 0
let result = { success: true, data: { state: 'available', version: '3.4.0' } }
let ignored = []
let pending
let fail = false
const notices = []
const createChecker = () =>
  createAutomaticUpdateChecker({
    check: async () => {
      calls++
      if (pending) return pending
      if (fail) throw Error('offline')
      return result
    },
    ignoredVersions: () => ignored,
    notify: (version) => notices.push(version)
  })
const checker = createChecker()
checker.start()
checker.start()
await flush()
assert.equal(calls, 1)
assert.deepEqual(notices, ['3.4.0'])
checker.stop()
checker.start()
await flush()
assert.equal(calls, 1, 're-enabling during a session cannot check again')
for (const state of ['idle', 'checking', 'not-available', 'downloading', 'downloaded', 'error']) {
  result = { success: true, data: { state, version: '3.5.0' } }
  createChecker().start()
  await flush()
  assert.equal(notices.length, 1, 'only an available update can open a reminder')
}
result = { success: true, data: { state: 'available', version: '3.5.0' } }
ignored = ['3.5.0']
createChecker().start()
await flush()
assert.equal(notices.length, 1, 'ignored versions are not prompted on the next startup')
result = { success: true, data: { state: 'available', version: '3.6.0' } }
createChecker().start()
await flush()
assert.deepEqual(notices, ['3.4.0', '3.6.0'], 'the next startup can discover a later release')
fail = true
const offline = createChecker()
offline.start()
await flush()
const failedCalls = calls
offline.start()
await flush()
assert.equal(
  calls,
  failedCalls,
  'a failed startup check stays quiet and never retries during runtime'
)
assert.equal(notices.length, 2)
fail = false
result = { success: false }
createChecker().start()
await flush()
assert.equal(notices.length, 2, 'failed IPC results cannot notify')
let resolvePending
pending = new Promise((resolve) => {
  resolvePending = resolve
})
const cancelled = createChecker()
cancelled.start()
cancelled.stop()
cancelled.start()
resolvePending({ success: true, data: { state: 'available', version: '3.7.0' } })
await flush()
assert.equal(notices.length, 2, 'disabling or unmounting suppresses a late response permanently')
pending = undefined

const migration = {}
vm.runInNewContext(
  ts.transpileModule(readFileSync('src/renderer/src/stores/ui/uiPreferences.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
  }).outputText,
  { exports: migration, require: () => ({ isSystemBackground: () => false }) }
)
const restore = (value) => migration.deserializeUIPreferences(JSON.stringify(value))
assert.equal(restore({}).autoCheckUpdates, true, 'existing installs enable automatic checks')
const saved = restore({ autoCheckUpdates: false, ignoredUpdateVersions: ['3.4.0', '3.5.0'] })
assert.equal(saved.autoCheckUpdates, false)
assert.equal(JSON.stringify(saved.ignoredUpdateVersions), '["3.4.0","3.5.0"]')
assert.equal(restore({ ignoredUpdateVersions: null }).ignoredUpdateVersions.length, 0)
assert.equal(
  JSON.stringify(restore({ ignoredUpdateVersions: [1, '3.4.0'] }).ignoredUpdateVersions),
  '["3.4.0"]'
)
console.log(
  'Automatic updates: startup-only checks, no runtime retry, ignored versions, failures, cancellation and preference migration passed'
)
