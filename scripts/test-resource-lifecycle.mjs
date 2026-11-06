/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(file, mocks = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    {
      exports,
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      require: (name) => {
        assert(name in mocks, name)
        return mocks[name]
      },
      ...globals
    }
  )
  return exports
}

const shutdown = load('src/main/service/applicationShutdown.ts')
const policy = load('src/main/service/playbackMode.ts', { './applicationShutdown': shutdown })
policy.setPlaybackOnly(true)
const waiting = policy.waitForBackgroundWork()
const cancelled = assert.rejects(waiting, /Application is shutting down/)
shutdown.beginApplicationShutdown()
await cancelled
assert.throws(() => policy.requireBackgroundWork(), /Application is shutting down/)
await assert.rejects(policy.waitForBackgroundWork(), /Application is shutting down/)
let late = 0
shutdown.onApplicationShutdown(() => late++)
shutdown.beginApplicationShutdown()
assert.equal(late, 1, 'shutdown registration after cancellation runs once')

const cleared = []
let saves = 0
const { AudioEngineManager } = load(
  'src/main/audioEngine/colors.ts',
  {
    electron: { app: {} },
    'node:fs': { existsSync: () => false },
    '../service/autoMixStemService': {},
    '../utils/pathUtils': {},
    '../service/playbackMode': { isPlaybackOnly: () => false },
    '../service/loggerService': { Logger: { warn() {} } },
    '../service/operationLogger': { logOperation: (_name, _data, action) => action() },
    './dspSettings': { saveDspSettings: () => saves++ }
  },
  { clearTimeout: (timer) => cleared.push(timer), clearInterval: (timer) => cleared.push(timer) }
)
const audio = Object.create(AudioEngineManager.prototype)
audio.deviceEvents = 'device-poll'
audio.stemRequestTimer = 'stem-poll'
audio.dspSettingsSaveTimer = 'dsp-save'
audio.dspSettings = { outputDevice: {} }
audio.stemShutdown = Promise.resolve()
let release
let closed = false
audio.stemService = {
  closeAndWait: () =>
    new Promise((resolve) => {
      release = resolve
    })
}
const closing = audio.shutdown().then(() => {
  closed = true
})
await Promise.resolve()
assert.deepEqual(cleared, ['device-poll', 'stem-poll', 'dsp-save'])
assert.equal(saves, 1, 'final DSP state must flush while SQLite is available')
assert.equal(closed, false, 'shutdown must wait for the stem process close event')
audio.resumeStemService()
assert.equal(audio.stemService, undefined, 'late maintenance completion cannot restart a worker')
audio.persistDspSettings()
assert.equal(saves, 1)
release()
await closing
await audio.shutdown()
console.log(
  'Resource lifecycle: paused wait cancellation, audio poll timers, awaited process close and no late worker restart passed'
)
