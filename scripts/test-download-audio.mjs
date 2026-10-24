import { pluginRequire, pluginPath, projectRequire } from './lib/plugin-require.mjs'
/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import sharp from 'sharp'
import { parseFile } from 'music-metadata'

const require = createRequire(import.meta.url)
const logger = { debug() {}, info() {}, warn() {}, error() {} }
const common = {
  '../service/playbackMode': {
    requireBackgroundWork() {},
    isPlaybackOnly: () => false,
    onPlaybackModeChanged: () => () => {}
  },
  './playbackMode': {
    requireBackgroundWork() {},
    isPlaybackOnly: () => false,
    onPlaybackModeChanged: () => () => {}
  },
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
  const resolvedMocks = new Map()
  for (const [name, value] of Object.entries(common)) {
    if (name.startsWith('.')) {
      const base = name.startsWith('../')
        ? 'src/main/ipc/downloadIpcHandlers.ts'
        : 'src/main/service/downloadAudioService.ts'
      const target = path.resolve(path.dirname(base), name) + '.ts'
      resolvedMocks.set(target, { ...resolvedMocks.get(target), ...value })
    }
  }
  for (const [name, value] of Object.entries(mocks)) {
    if (name.startsWith('.'))
      resolvedMocks.set(path.resolve(path.dirname(file), name) + '.ts', value)
  }
  const cache = new Map()
  function visit(filename) {
    filename = path.resolve(filename)
    if (resolvedMocks.has(filename)) return resolvedMocks.get(filename)
    if (cache.has(filename)) return cache.get(filename)
    const exports = {}
    cache.set(filename, exports)
    const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true
      }
    }).outputText
    vm.runInNewContext(
      compiled,
      {
        exports,
        Buffer,
        structuredClone,
        AbortController,
        AbortSignal,
        crypto,
        Error,
        URL,
        setTimeout,
        clearTimeout,
        process,
        require: (name) => {
          if (name === '@easy-player/plugin-sdk') return pluginRequire(name)
          if (mocks[name]) return mocks[name]
          if (name.startsWith('.')) {
            const target = path.resolve(path.dirname(filename), name)
            return visit(
              existsSync(target + '.ts') ? target + '.ts' : path.join(target, 'index.ts')
            )
          }
          return common[name] ?? projectRequire(filename, name)
        }
      },
      { filename }
    )
    return exports
  }
  const exports = visit(file)
  if (file === 'src/main/ipc/downloadIpcHandlers.ts') {
    const runtime = visit('src/main/plugins/runtime.ts')
    runtime.configurePluginHost({
      readSetting() {
        return null
      },
      writeSetting() {},
      log() {},
      fetch: (url, init) =>
        new Promise((resolve, reject) => {
          const request = mocks.electron.net.request({ method: 'GET', url })
          for (const [key, value] of Object.entries(init.headers ?? {}))
            request.setHeader(key, value)
          request.on('error', reject)
          request.on('response', (response) => {
            const chunks = []
            response.on('data', (chunk) => chunks.push(chunk))
            response.on('end', () =>
              resolve({
                ok: response.statusCode < 400,
                status: response.statusCode,
                text: async () => Buffer.concat(chunks).toString()
              })
            )
            response.on('error', reject)
          })
          request.end()
        }),
      mediaInfo: visit('src/main/service/mediaDownloadRuntime.ts').extractMediaInfo
    })
    const manager = runtime.getPluginManager()
    const { biliPlugin, youtubePlugin } = visit(pluginPath('official/media.ts'))
    for (const plugin of [biliPlugin, youtubePlugin]) {
      manager.load(plugin)
      manager.activate(plugin.manifest.id)
    }
  }
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

  // Run the yt-dlp transport through the same source registry and IPC entry point.
  for (const scenario of ['done', 'exit-failure', 'spawn-failure']) {
    const handlers = new Map()
    const events = []
    const spawnCalls = []
    let saved
    let complete
    const completed = new Promise((resolve) => {
      complete = resolve
    })
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    const handler = await load('src/main/ipc/downloadIpcHandlers.ts', {
      electron: {
        app: { isPackaged: false, getAppPath: () => root },
        ipcMain: { handle: (name, action) => handlers.set(name, action) },
        BrowserWindow: { fromWebContents: () => null }
      },
      'node:child_process': {
        spawn: (command, args, options) => {
          spawnCalls.push({ command, args, options })
          setImmediate(() => {
            if (scenario === 'spawn-failure') child.emit('error', new Error('missing executable'))
            else {
              child.stdout.emit('data', Buffer.from('[download] 25.0%\n'))
              child.stderr.emit('data', Buffer.from('diagnostic'))
              child.emit('close', scenario === 'done' ? 0 : 1)
            }
          })
          return child
        }
      },
      '../i18n': { t: (key) => key },
      '../database/repository': {
        listDownloadTasks: () => [],
        saveDownloadTask: (task) => {
          saved = task
        }
      }
    })
    handler.registerDownloadIpcHandlers()
    const sender = {
      send: (_channel, event) => {
        events.push(event)
        if (event.status === 'done' || event.status === 'error') complete(event)
      }
    }
    assert.throws(
      () =>
        handlers.get('media-download:start')(
          { sender },
          {
            platform: 'bili',
            url: 'https://www.youtube.com/watch?v=test',
            resourceId: 'test',
            title: 'Title',
            directory: root,
            downloadType: 'audio',
            quality: 'high'
          }
        ),
      /does not match/
    )
    assert.throws(
      () =>
        handlers.get('media-download:start')(
          { sender },
          {
            platform: 'youtube',
            url: 'https://youtube.com.evil.test/watch?v=test',
            resourceId: 'test',
            title: 'Title',
            directory: root,
            downloadType: 'audio',
            quality: 'high'
          }
        ),
      /Unsupported download source/
    )
    handlers.get('media-download:start')(
      { sender },
      {
        platform: 'youtube',
        url: 'https://www.youtube.com/watch?v=test',
        resourceId: 'test',
        title: 'Title',
        directory: root,
        downloadType: 'audio',
        quality: 'high'
      }
    )
    const timer = setTimeout(() => complete({ status: 'timeout' }), 5000)
    const result = await completed
    clearTimeout(timer)
    assert.equal(result.status, scenario === 'done' ? 'done' : 'error')
    assert.equal(spawnCalls.length, 1)
    assert.equal(spawnCalls[0].options.windowsHide, true)
    assert(spawnCalls[0].args.includes('--extract-audio'))
    assert(spawnCalls[0].args.includes('--audio-quality'))
    assert.equal(spawnCalls[0].args.at(-1), 'https://www.youtube.com/watch?v=test')
    if (scenario !== 'spawn-failure') {
      assert(events.some((event) => event.progress === 25))
      assert.equal(saved.platform, 'youtube')
      assert.equal(saved.status, scenario === 'done' ? 'done' : 'error')
    }
  }
  console.log('YouTube: source routing, yt-dlp progress, completion and process failures passed')

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
