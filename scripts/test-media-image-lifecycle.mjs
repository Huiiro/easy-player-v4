/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const exports = {}
let request
let cleanups = 0
const mocks = {
  electron: {
    net: {
      request: () => {
        request = new EventEmitter()
        request.setHeader = () => {}
        request.end = () => {}
        request.abort = () => {
          request.aborted = true
          request.emit('abort')
          request.emit('close')
        }
        return request
      }
    }
  },
  'node:child_process': {},
  '../utils/pathUtils': {},
  '../i18n': { t: (key) => key },
  './playbackMode': {
    requireBackgroundWork() {},
    onPlaybackModeChanged: () => () => cleanups++
  },
  './applicationShutdown': { onApplicationShutdown: () => () => cleanups++ },
  './operationLogger': {},
  '../sources/errors': {},
  '../plugins/proxy': { getPluginSession: () => ({}) }
}
vm.runInNewContext(
  ts.transpileModule(readFileSync('src/main/service/mediaDownloadRuntime.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText,
  {
    exports,
    Buffer,
    setTimeout,
    clearTimeout,
    require: (name) => {
      assert(name in mocks, name)
      return mocks[name]
    }
  }
)
const start = () => {
  const pending = exports.fetchMediaImage('https://image.test/cover', {})
  const response = new EventEmitter()
  response.statusCode = 200
  response.headers = { 'content-type': 'image/png' }
  request.emit('response', response)
  return { pending, response }
}
const normal = start()
normal.response.emit('data', Buffer.from('image'))
normal.response.emit('end')
request.emit('close')
assert.equal(await normal.pending, 'data:image/png;base64,aW1hZ2U=')
assert.equal(cleanups, 2)

const oversized = start()
const rejected = assert.rejects(oversized.pending, /coverTooLarge/)
oversized.response.emit('data', Buffer.alloc(5 * 1024 * 1024))
assert.equal(request.aborted, undefined, 'the exact size limit is allowed')
oversized.response.emit('data', Buffer.alloc(1))
await rejected
assert.equal(request.aborted, true, 'overflow must abort without waiting for response end')
assert.equal(cleanups, 4, 'abort must release playback-mode and shutdown registrations')
console.log(
  'Media image lifecycle: normal response, immediate overflow abort and listener cleanup passed'
)
