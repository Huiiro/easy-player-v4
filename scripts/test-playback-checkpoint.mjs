/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('src/main/ipc/audioIpcHandlers.ts', 'utf8')
const EngineState = { Idle: 0, Loading: 1, Ready: 2, Playing: 3, Paused: 4, Stopped: 5 }
const checkpointKey = 'player.playback-checkpoint'
const clone = (value) => JSON.parse(JSON.stringify(value))

function session(stored, initialStatus) {
  const settings = new Map([[checkpointKey, clone(stored)]])
  const timers = new Map()
  const callbacks = {}
  const commands = new Map()
  let status = initialStatus
  let timerId = 0
  const engine = {
    onStateChanged: (handler) => (callbacks.state = handler),
    onPositionChanged: (handler) => (callbacks.position = handler),
    onTrackEnded: (handler) => (callbacks.ended = handler),
    onError: (handler) => (callbacks.error = handler),
    getStatus: () => status
  }
  const exports = {}
  const modules = {
    '../i18n': { t: (key) => key },
    '../service/playbackMode': { isPlaybackOnly: () => false },
    electron: { ipcMain: { handle: (key, handler) => commands.set(key, handler) } },
    '../audioEngine/types': { EngineState, IPC: { COMMAND: 'command', EVENT: 'event' } },
    '../database/repository': {
      getAppSetting: (key) => settings.get(key),
      setAppSetting: (key, value) => settings.set(key, clone(value))
    },
    '../service/loggerService': { Logger: { debug() {}, error() {}, write() {} } },
    '../service/operationLogger': {
      logError: String,
      logParams: (value) => value,
      logOperation: (_name, _params, operation) => operation()
    }
  }
  vm.runInNewContext(
    ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    {
      exports,
      require: (name) => {
        assert.ok(name in modules, `Unexpected import ${name}`)
        return modules[name]
      },
      setTimeout: (handler) => {
        timers.set(++timerId, handler)
        return timerId
      },
      clearTimeout: (id) => timers.delete(id)
    }
  )
  const flush = exports.registerIpcHandlers(engine, () => null)
  return { flush, settings, timers, callbacks, setStatus: (value) => (status = value) }
}

const saved = { currentFile: 'track.flac', positionMs: 10000, wasPlaying: true }
const status = (state, positionMs, filePath = 'track.flac') => ({
  state,
  positionMs,
  trackInfo: { filePath }
})
const first = session(saved, status(EngineState.Playing, 15375))
first.callbacks.position(15000, 60000)
assert.equal(first.settings.get(checkpointKey).positionMs, 10000, 'Position writes are throttled')
assert.equal(first.timers.size, 1)
first.flush()
assert.equal(first.timers.size, 0, 'Exit cancels the pending write before database shutdown')
assert.deepEqual(first.settings.get(checkpointKey), { ...saved, positionMs: 15375 })

first.setStatus(status(EngineState.Idle, 0))
first.flush()
assert.equal(
  first.settings.get(checkpointKey).positionMs,
  15375,
  'Cleanup after stop preserves the snapshot'
)
const restarted = session(first.settings.get(checkpointKey), status(EngineState.Idle, 0, ''))
restarted.flush()
assert.equal(
  restarted.settings.get(checkpointKey).positionMs,
  15375,
  'Quit before deferred restore keeps saved progress'
)

const paused = session(saved, status(EngineState.Paused, 25000))
paused.flush()
assert.deepEqual(paused.settings.get(checkpointKey), {
  ...saved,
  positionMs: 25000,
  wasPlaying: false
})
const ready = session(saved, status(EngineState.Ready, 35000))
ready.flush()
assert.equal(ready.settings.get(checkpointKey).positionMs, 35000, 'A seek before play is persisted')
const pending = session(saved, status(EngineState.Idle, 0, ''))
pending.callbacks.position(17000, 60000)
pending.flush()
assert.equal(
  pending.settings.get(checkpointKey).positionMs,
  17000,
  'Pending position is committed even if engine stopped'
)

// Exercise the application's actual explicit-quit function, which uses app.exit
// and therefore cannot rely on will-quit to persist its checkpoint.
const main = readFileSync('src/main/index.ts', 'utf8')
const quitSource = main.slice(
  main.indexOf('function quitApplication(): void'),
  main.indexOf('function sendTrayAction(')
)
const quitting = session(saved, status(EngineState.Playing, 43000))
const order = []
vm.runInNewContext(
  ts.transpileModule(`${quitSource}\nquitApplication()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText,
  {
    Logger: { info() {} },
    isQuitting: false,
    flushPlaybackCheckpoint: () => {
      quitting.flush()
      order.push('save')
    },
    audioEngine: {
      stop: () => {
        quitting.setStatus(status(EngineState.Idle, 0))
        order.push('stop')
      },
      flushDspSettings() {}
    },
    saveDesktopLyricsWindowState() {},
    globalShortcut: { unregisterAll() {} },
    tray: null,
    closeDatabase: () => order.push('close-database'),
    app: { exit: () => order.push('exit') }
  }
)
assert.deepEqual(order, ['save', 'stop', 'close-database', 'exit'])
assert.equal(quitting.settings.get(checkpointKey).positionMs, 43000)

console.log(
  'Playback checkpoint exit flush, restart, deferred restore, pause and ready seek passed'
)
