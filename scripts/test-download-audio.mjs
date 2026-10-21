/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import sharp from 'sharp'
import { parseFile } from 'music-metadata'

const require = createRequire(import.meta.url)
const logger = { debug() {}, info() {}, warn() {}, error() {} }
const common = {
  '../service/playbackMode': { requireBackgroundWork() {}, onPlaybackModeChanged: () => () => {} },
  './playbackMode': { requireBackgroundWork() {} },
  '../service/loggerService': { Logger: logger },
  './loggerService': { Logger: logger },
  '../service/operationLogger': {
    logOperation: (_name, _context, action) => action(),
    logError: String,
    logParams: (value) => value,
    logUrl: (value) => value
  },
  './operationLogger': { logError: String }
}
async function load(file, mocks) {
  const exports = {}
  const compiled = ts.transpileModule(await fs.readFile(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText
  vm.runInNewContext(compiled, {
    exports,
    Buffer,
    Error,
    URL,
    setTimeout,
    clearTimeout,
    process,
    require: (name) => mocks[name] ?? common[name] ?? require(name)
  })
  return exports
}

const root = await fs.mkdtemp(path.resolve('build/download-audio-test-'))
try {
  const cover = await sharp({
    create: { width: 64, height: 32, channels: 3, background: '#336699' }
  })
    .webp()
    .toBuffer()
  // Exercise the IPC entry point with real file writes and mocked HTTP responses.
  for (const scenario of [
    'cover',
    'cover-fetch-failure',
    'remux-failure',
    'truncated',
    'aborted',
    'video'
  ]) {
    const directory = path.join(root, scenario)
    await fs.mkdir(directory)
    const handlers = new Map()
    const events = []
    let saved
    let finalized = false
    let finish
    const completed = new Promise((resolve) => {
      finish = resolve
    })
    const raw = Buffer.from('downloaded DASH audio')
    const net = {
      request: ({ url }) => {
        const request = new EventEmitter()
        request.setHeader = () => {}
        request.abort = () => {
          request.emit('abort')
          request.emit('close')
        }
        request.end = () =>
          setImmediate(() => {
            const response = new EventEmitter()
            let body
            response.statusCode = 200
            if (url.includes('/view?'))
              body = Buffer.from(
                JSON.stringify({
                  code: 0,
                  data: { cid: 123, pic: '//i0.hdslb.com/cover.webp', owner: { name: 'Uploader' } }
                })
              )
            else if (url.includes('/playurl?'))
              body = Buffer.from(
                JSON.stringify({
                  code: 0,
                  data: {
                    dash: { audio: [{ baseUrl: 'https://media.test/audio' }] },
                    durl: [{ url: 'https://media.test/audio' }]
                  }
                })
              )
            else if (url.includes('hdslb.com')) {
              body = cover
              if (scenario === 'cover-fetch-failure') response.statusCode = 404
            } else body = raw
            response.headers = {
              'content-length': String(
                body.length + (scenario === 'truncated' && url.includes('media.test') ? 1 : 0)
              ),
              'content-type': 'image/webp'
            }
            request.emit('response', response)
            response.emit('data', body)
            if (scenario === 'aborted' && url.includes('media.test')) response.emit('aborted')
            else response.emit('end')
            request.emit('close')
          })
        return request
      }
    }
    const handler = await load('src/main/ipc/downloadIpcHandlers.ts', {
      electron: { net, ipcMain: { handle: (name, action) => handlers.set(name, action) } },
      '../i18n': { t: (key) => key },
      '../database/repository': {
        saveDownloadTask: (task) => {
          saved = task
        },
        listDownloadTasks: () => []
      },
      '../service/downloadAudioService': {
        finalizeDownloadedAudio: async (file, tags, image) => {
          assert.equal(saved, undefined, 'history must wait for finalization')
          assert.equal(
            events.some((event) => event.status === 'done'),
            false
          )
          assert.deepEqual(await fs.readFile(file), raw)
          assert.equal(tags.title, 'Test song')
          assert.equal(tags.artist, undefined, 'The uploader is not necessarily the song artist')
          if (scenario === 'cover-fetch-failure') assert.equal(image, undefined)
          else assert.deepEqual(image, cover)
          if (scenario === 'remux-failure') throw new Error('remux failed')
          await fs.writeFile(file, 'normalized M4A')
          finalized = true
        }
      }
    })
    handler.registerDownloadIpcHandlers()
    handlers.get('media-download:start')(
      {
        sender: {
          send: (_channel, event) => {
            events.push(event)
            if (event.status === 'done' || event.status === 'error') finish(event)
          }
        }
      },
      {
        platform: 'bili',
        url: 'https://www.bilibili.com/video/BV123456',
        resourceId: 'BV123456',
        title: 'Test song',
        directory,
        downloadType: scenario === 'video' ? 'video' : 'audio',
        quality: 'best'
      }
    )
    const timeout = setTimeout(() => finish({ status: 'timeout' }), 5000)
    const result = await completed
    clearTimeout(timeout)
    if (['remux-failure', 'truncated', 'aborted'].includes(scenario)) {
      assert.equal(result.status, 'error', scenario)
      assert.equal(saved, undefined)
      assert.deepEqual(await fs.readdir(directory), [])
    } else {
      assert.equal(result.status, 'done', scenario)
      assert.equal(saved.status, 'done')
      assert.equal(finalized, scenario !== 'video')
      assert.equal(
        (await fs.readFile(result.filePath)).toString(),
        scenario === 'video' ? raw.toString() : 'normalized M4A'
      )
      assert.deepEqual(await fs.readdir(directory), [path.basename(result.filePath)])
    }
  }
  console.log(
    'Bili download: finalize before completion, cover fetch fallback, failed/truncated/aborted cleanup and video passed'
  )

  const directory = path.join(root, 'finalizer')
  await fs.mkdir(directory)
  const file = path.join(directory, 'audio.m4a')
  await fs.writeFile(file, 'raw')
  for (const scenario of [
    'cover',
    'invalid-cover',
    'native-cover-failure',
    'native-failure',
    'validation-failure'
  ]) {
    const calls = []
    const service = await load('src/main/service/downloadAudioService.ts', {
      '../audioEngine': {
        writeNativeMetadata: (_file, tags) => {
          calls.push(tags)
          if (scenario === 'native-failure') return false
          if (scenario === 'native-cover-failure' && tags.coverPath) throw new Error('bad cover')
          return true
        }
      },
      'music-metadata': {
        parseFile: async () => {
          if (scenario === 'validation-failure') throw new Error('invalid output')
          return { format: { duration: 10, hasAudio: true }, common: {} }
        }
      }
    })
    const action = service.finalizeDownloadedAudio(
      file,
      { title: 'Title' },
      scenario === 'invalid-cover' ? Buffer.from('bad image') : cover
    )
    if (['native-failure', 'validation-failure'].includes(scenario)) await assert.rejects(action)
    else await action
    if (scenario === 'native-cover-failure') assert.equal(calls.length, 2)
    if (scenario === 'invalid-cover') assert.equal(calls[0].coverPath, undefined)
    await assert.rejects(fs.stat(path.join(directory, 'cover.jpg')), { code: 'ENOENT' })
  }
  console.log(
    'Finalizer: image normalization, cover write fallback, mandatory remux/validation and cover cleanup passed'
  )

  if (process.argv[2]) {
    const addon = require(path.resolve('build/native-addon/easy_player_native.node'))
    const service = await load('src/main/service/downloadAudioService.ts', {
      '../audioEngine': { writeNativeMetadata: addon.writeMetadata },
      'music-metadata': { parseFile }
    })
    for (const withCover of [true, false]) {
      await fs.copyFile(path.resolve(process.argv[2]), file)
      await service.finalizeDownloadedAudio(
        file,
        { title: '青花', artist: '周传雄' },
        withCover ? cover : undefined
      )
      const metadata = await parseFile(file, { duration: true })
      assert.equal(metadata.common.title, '青花')
      assert.equal(metadata.common.artist, '周传雄')
      assert.ok(metadata.format.duration > 297 && metadata.format.duration < 299)
      assert.equal(Boolean(metadata.common.picture?.length), withCover)
      if (withCover) assert.equal(metadata.common.picture[0].format, 'image/jpeg')
      const opened = spawnSync(
        process.execPath,
        [
          '-e',
          'const addon = require(process.argv[1]); const engine = new addon.AudioEngine(); if (!engine.open(process.argv[2])) process.exit(1); engine.stop()',
          path.resolve('build/native-addon/easy_player_native.node'),
          file
        ],
        { encoding: 'utf8' }
      )
      assert.equal(opened.status, 0, opened.stderr)
    }
    console.log(
      'Real downloaded DASH sample: remux with/without embedded JPEG, title/artist, plain parser and native open passed'
    )
  }
} finally {
  await fs.rm(root, { recursive: true, force: true })
}
