/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'
import ts from 'typescript'

const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS }
  }).outputText
const main = readFileSync('src/main/index.ts', 'utf8')
const quitSource = main.slice(
  main.indexOf('async function quitApplication('),
  main.indexOf('function sendTrayAction(')
)
const ast = ts.createSourceFile('index.ts', main, ts.ScriptTarget.Latest, true)
let beforeQuit
const lateWindowCallbacks = []
function visit(node) {
  if (
    ts.isCallExpression(node) &&
    node.expression.getText(ast) === 'app.on' &&
    node.arguments[0]?.getText(ast) === "'before-quit'"
  )
    beforeQuit = node.arguments[1].getText(ast)
  if (
    ts.isCallExpression(node) &&
    ["'close'", "'closed'", "'window-all-closed'"].includes(node.arguments[0]?.getText(ast)) &&
    ['mainWindow.on', 'miniWindow.on', 'desktopLyricsWindow.on', 'app.on'].includes(
      node.expression.getText(ast)
    )
  ) {
    // Only close handlers without createWindow-local captured timer variables.
    if (
      node.arguments[0]?.getText(ast) !== "'closed'" ||
      node.expression.getText(ast) !== 'mainWindow.on'
    )
      lateWindowCallbacks.push(node.arguments[1].getText(ast))
  }
  ts.forEachChild(node, visit)
}
visit(ast)
assert(beforeQuit, 'normal quit handler must exist')
const settle = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}

for (const route of ['tray', 'normal']) {
  const timers = new Set()
  const warnings = []
  const workers = []
  const order = []
  let closed = false
  let writes = 0
  let searchStopped = false
  let smtcReleased = false
  let releaseSmtc
  let releaseAudio
  let audioReleased = false
  const audioClosing = new Promise((resolve) => {
    releaseAudio = resolve
  })
  const smtcClosing = new Promise((resolve) => {
    releaseSmtc = resolve
  })
  const assertOpen = () =>
    assert.equal(closed, false, 'background indexing must never touch a closed database')
  const db = {
    prepare: () => ({
      get: () => {
        assertOpen()
        return { changes: 0 }
      }
    }),
    pragma: () => {
      assertOpen()
      return 0
    }
  }
  class Worker extends EventEmitter {
    constructor() {
      super()
      workers.push(this)
    }
    postMessage(request) {
      this.request = request
    }
    terminate() {
      this.terminated = true
      this.emit('exit', 1)
      return Promise.resolve(1)
    }
  }
  const exports = {}
  const modules = {
    'node:worker_threads': { Worker },
    '../utils/pathUtils': { getSearchWorkerPath: () => 'fixture.js' },
    '../service/playbackMode': {
      isPlaybackOnly: () => false,
      onPlaybackModeChanged: () => () => {}
    },
    '../service/loggerService': { Logger: { warn: (...args) => warnings.push(args) } },
    './searchTokens': { buildBasicSearchTerms: () => ({}) },
    './searchIndexStore': {
      queueOutdatedSearchIndexes() {},
      pendingSearchRows: () => {
        assertOpen()
        return [{ title: 'Pending track', artist: '', album: '', fileName: '' }]
      },
      readSearchIndexCounts: () => {
        assertOpen()
        return { total: 1, pending: 1, ready: 1, retrying: 0, indexed: 0, nextRetryAt: null }
      },
      commitSearchTerms: () => {
        assertOpen()
        writes++
        return true
      }
    }
  }
  vm.runInNewContext(compile(readFileSync('src/main/search/searchIndexService.ts', 'utf8')), {
    exports,
    require: (name) => {
      assert(name in modules, name)
      return modules[name]
    },
    setTimeout: (run) => {
      const timer = { run, unref() {} }
      timers.add(timer)
      return timer
    },
    clearTimeout: (timer) => timers.delete(timer)
  })
  const search = exports.startSearchIndexService(db, () =>
    assert.fail('must not publish after shutdown')
  )
  const timer = [...timers][0]
  timers.delete(timer)
  timer.run()
  assert.equal(workers.length, 1, 'fixture must start an in-flight conversion')
  const noDispose = { dispose() {} }
  const context = vm.createContext({
    Logger: { info() {}, debug() {}, warn: (...args) => warnings.push(args) },
    isQuitting: false,
    mainWindow: null,
    miniWindow: null,
    desktopLyricsWindow: null,
    desktopLyricsBoundsTimer: undefined,
    clearTimeout,
    beginApplicationShutdown: () => order.push('begin-shutdown'),
    flushPlaybackCheckpoint: () => {
      assertOpen()
      order.push('save-checkpoint')
    },
    audioEngine: {
      stop() {},
      flushDspSettings() {},
      shutdown: () =>
        audioClosing.then(() => {
          audioReleased = true
        })
    },
    saveDesktopLyricsWindowState: assertOpen,
    globalShortcut: { unregisterAll() {} },
    taskbarPlayback: noDispose,
    thumbnailPlayback: noDispose,
    taskbarCover: noDispose,
    systemMedia: {
      dispose: () =>
        smtcClosing.then(() => {
          smtcReleased = true
        })
    },
    systemMediaCommands: noDispose,
    tray: null,
    searchIndexService: {
      stop: () => {
        search.stop()
        searchStopped = true
        order.push('stop-search')
      }
    },
    stopLibraryAutoImport: () => order.push('stop-library'),
    stopDuplicateScans: () => order.push('stop-scans'),
    shutdownPlugins() {},
    closeDatabase: () => {
      assert(searchStopped, 'all quit paths must stop search before closing SQLite')
      closed = true
      order.push('close-database')
    },
    app: {
      exit: () => {
        assert(smtcReleased)
        assert(audioReleased)
        order.push('exit')
      }
    }
  })
  vm.runInContext(compile(quitSource), context)
  const operation =
    route === 'tray'
      ? vm.runInContext('quitApplication()', context)
      : vm.runInContext(
          compile(`(${beforeQuit})`),
          context
        )({ preventDefault: () => order.push('prevent-default') })
  assert.equal(
    searchStopped,
    true,
    'tray quit must stop background search before awaiting SMTC cleanup'
  )
  assert.equal(closed, false, 'database must stay open until explicit cleanup finishes')
  const duplicate = vm.runInContext('quitApplication()', context)
  await duplicate
  assert.equal(
    order.filter((step) => step === 'stop-search').length,
    1,
    'repeated quit must not start another cleanup'
  )
  releaseSmtc()
  await settle()
  assert.equal(closed, false, 'closing SQLite must also wait for audio child processes')
  releaseAudio()
  await operation
  await settle()
  // Model an already posted worker result arriving after shutdown.
  workers[0].emit('message', { requestId: workers[0].request.requestId, terms: {}, complete: true })
  await settle()
  assert.equal(closed, true)
  for (const callback of lateWindowCallbacks)
    vm.runInContext(compile(`(${callback})`), context)({ preventDefault() {} })
  assert.equal(workers[0].terminated, true)
  assert.equal(timers.size, 0, 'shutdown must cancel batch and conversion timers')
  assert.equal(writes, 0, 'late worker results must not write to the closed database')
  assert.deepEqual(warnings, [], 'shutdown must not log database errors or reject a search batch')
  console.log(
    `Application shutdown (${route}): active search cancellation, late worker result and database ordering passed`
  )
}
