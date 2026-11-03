/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const { app, BrowserWindow, ipcMain } = require('electron')
const { parse, compileScript } = require('@vue/compiler-sfc')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const { build } = require('esbuild')
const sharp = require('sharp')
if (process.platform !== 'win32') {
  console.log('SMTC native test: Windows only')
  app.exit(0)
}
fs.mkdirSync('build', { recursive: true })
const directory = fs.mkdtempSync(path.resolve('build/smtc-test-'))
app.setPath('userData', directory)
const appId = `com.huiiro.easyplayer.smtctest.${process.pid}`
app.setAppUserModelId(appId)
app.disableHardwareAcceleration()
const execute = promisify(execFile)
const tick = () => new Promise((resolve) => setImmediate(resolve))
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}
const probePath = path.resolve('build/native-addon/Release/easy_player_smtc_probe.exe')
async function probe(action = 'inspect') {
  const result = await execute(probePath, [appId, action], { windowsHide: true, timeout: 10000 })
  return JSON.parse(result.stdout)
}
async function until(check, message) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const result = await check()
    if (result) return result
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(message)
}
const deadline = setTimeout(() => {
  console.error('SMTC tests timed out')
  app.exit(1)
}, 60000)

async function serviceTests(createSystemMediaControls) {
  let saved = false
  let failSave = false
  const sessions = []
  const actions = []
  const pendingArt = new Map()
  const makeWindow = () =>
    Object.assign(new EventEmitter(), {
      isDestroyed: () => false,
      getNativeWindowHandle: () => Buffer.alloc(8)
    })
  const options = {
    platform: 'win32',
    fallbackCover: 'fallback',
    readEnabled: () => saved,
    writeEnabled: (value) => {
      if (failSave) throw new Error('disk full')
      saved = value
    },
    onAction: (action) => actions.push(action),
    createSession: (_hwnd, callback) => {
      const instance = {
        callback,
        snapshots: [],
        artworks: [],
        closed: false,
        ready: async () => {},
        update: async (value) => instance.snapshots.push(value),
        artwork: async (bytes, revision) =>
          instance.artworks.push({ bytes: bytes.toString(), revision }),
        close: async () => {
          instance.closed = true
        }
      }
      sessions.push(instance)
      return instance
    },
    readArtwork: (source) => {
      if (source === 'bad') return Promise.reject(new Error('missing cover'))
      if (pendingArt.has(source)) return pendingArt.get(source).promise
      return Promise.resolve(Buffer.from(source))
    }
  }
  const service = createSystemMediaControls(options)
  const firstWindow = makeWindow()
  await service.attach(firstWindow)
  assert.equal(service.state().enabled, false, 'persisted disabled setting must restore')
  await service.attach(firstWindow)
  assert.equal(sessions.length, 1, 'repeated settings reads must not rebuild the session')
  await service.setEnabled(true)
  assert.equal(saved, true)
  const firstArt = deferred()
  pendingArt.set('old', firstArt)
  service.updateTrack(
    { filePath: 'one', title: 'One', artist: '', album: '', cover: 'old' },
    'playing'
  )
  await tick()
  service.updateTrack(
    { filePath: 'two', title: 'Two', artist: '', album: '', cover: 'new' },
    'playing'
  )
  await tick()
  await tick()
  firstArt.resolve(Buffer.from('old'))
  await tick()
  await tick()
  assert.deepEqual(
    sessions[0].artworks.map((item) => item.bytes),
    ['new'],
    'stale cover must not replace current cover'
  )
  const count = sessions[0].snapshots.length
  service.updatePlayback('playing')
  await tick()
  assert.equal(sessions[0].snapshots.length, count, 'duplicate status must not publish')
  sessions[0].callback('play')
  sessions[0].callback('pause')
  assert.deepEqual(actions, ['pause'], 'play and pause are explicit, idempotent requests')
  failSave = true
  await assert.rejects(service.setEnabled(false), /disk full/)
  assert.equal(service.state().enabled, true, 'persistence failure must restore the active setting')
  assert.equal(sessions[0].snapshots.at(-1).enabled, true)
  failSave = false
  const secondWindow = makeWindow()
  await service.attach(secondWindow)
  firstWindow.emit('closed')
  await tick()
  assert.equal(sessions[0].closed, true)
  assert.equal(sessions[1].closed, false, 'closing outgoing window must retain replacement session')
  sessions[0].callback('next')
  sessions[1].callback('next')
  assert.deepEqual(actions, ['pause', 'next'], 'old window commands must be discarded')
  service.updateTrack(
    { filePath: 'three', title: 'Three', artist: '', album: '', cover: 'bad' },
    'paused'
  )
  await tick()
  await tick()
  await tick()
  assert.equal(sessions[1].artworks.at(-1).bytes, 'fallback')
  await service.setEnabled(false)
  sessions[1].callback('play')
  assert.deepEqual(actions, ['pause', 'next'])
  await service.dispose()
  assert.equal(sessions[1].closed, true)
  const portable = createSystemMediaControls({
    ...options,
    platform: 'darwin',
    createSession: () => {
      throw new Error('must not load')
    }
  })
  await portable.attach(makeWindow())
  assert.equal(portable.state().available, false)
  await portable.dispose()
  const broken = createSystemMediaControls({
    ...options,
    createSession: () => {
      throw new Error('missing addon')
    }
  })
  await broken.attach(makeWindow())
  assert.equal(broken.state().available, false)
  await broken.dispose()
  console.log(
    'SMTC service: persistence rollback, deduplication, stale artwork, window replacement, commands and fallback passed'
  )
}

async function commandTests(createPlaybackCommandService) {
  const sent = []
  let window = {
    isDestroyed: () => false,
    webContents: {
      id: 101,
      isLoadingMainFrame: () => false,
      send: (_channel, request) => sent.push(request)
    }
  }
  const service = createPlaybackCommandService(() => window)
  const first = service.execute('pause')
  const second = service.execute('next')
  await tick()
  assert.equal(sent.length, 1, 'commands must run in order')
  ipcMain.emit(
    'system:media-action-result',
    { sender: { id: 999 } },
    { id: sent[0].id, success: true }
  )
  await tick()
  assert.equal(sent.length, 1, 'foreign renderer cannot acknowledge the active command')
  ipcMain.emit(
    'system:media-action-result',
    { sender: window.webContents },
    { id: sent[0].id, success: true }
  )
  assert.equal(await first, true)
  await tick()
  assert.equal(sent[1].action, 'next')
  ipcMain.emit(
    'system:media-action-result',
    { sender: window.webContents },
    { id: sent[1].id, success: false }
  )
  assert.equal(await second, false)
  const oldWindow = window
  const stale = service.execute('previous')
  window = null
  assert.equal(await stale, false, 'window replacement must discard queued commands')
  window = oldWindow
  const pending = service.execute('play')
  await tick()
  service.dispose()
  assert.equal(await pending, false)
  assert.equal(await service.execute('next'), false)
  console.log(
    'SMTC command dispatch: ordered acknowledgements, sender ownership, stale requests and shutdown passed'
  )
}

async function settingsFixture() {
  const { Vue, createI18n, Settings, zh } = window.SettingsFixture
  const { createApp, nextTick } = Vue
  const check = (condition, message) => {
    if (!condition) throw new Error(message)
  }
  const wait = async () => {
    await nextTick()
    await new Promise((resolve) => setTimeout(resolve, 40))
  }
  let saved = true
  let failSave = false
  let pending
  let finish
  let available = true
  window.errors = []
  window.api = {
    system: {
      getSystemMediaControls: async () => ({ success: true, data: { available, enabled: saved } }),
      setSystemMediaControls: async (enabled) => {
        if (pending) await pending
        if (failSave) return { success: false }
        saved = enabled
        return { success: true, data: { available, enabled: saved } }
      }
    }
  }
  let instance
  const mount = async () => {
    instance?.unmount()
    instance = createApp(Settings).use(
      createI18n({ legacy: false, locale: 'zh', messages: { zh } })
    )
    instance.mount('#app')
    await wait()
  }
  const control = () => document.querySelector('[role=switch]')
  await mount()
  check(control().getAttribute('aria-checked') === 'true', 'saved enabled state must load')
  control().click()
  await wait()
  check(
    saved === false && control().getAttribute('aria-checked') === 'false',
    'toggle must save immediately'
  )
  await mount()
  check(
    control().getAttribute('aria-checked') === 'false',
    'saved toggle must survive page remount'
  )
  failSave = true
  control().click()
  await wait()
  check(
    saved === false &&
      control().getAttribute('aria-checked') === 'false' &&
      window.errors.length === 1,
    'failed save must retain state and show error'
  )
  failSave = false
  pending = new Promise((resolve) => {
    finish = resolve
  })
  control().click()
  await wait()
  check(control().disabled, 'saving must disable competing changes')
  finish()
  await wait()
  pending = undefined
  check(saved === true && !control().disabled, 'save retry must succeed')
  available = false
  await mount()
  check(
    control().disabled && document.body.textContent.includes('当前无法使用'),
    'unavailable native integration must disable the setting'
  )
  instance.unmount()
  return 'SMTC settings UI: restore, automatic persistence, failure rollback, busy and unavailable states passed'
}

async function settingsTests(win) {
  const bundle = await build({
    stdin: {
      contents:
        "export * as Vue from 'vue';export {createI18n} from 'vue-i18n';export {default as Settings} from './src/renderer/src/components/settings/SystemMediaControlsSettings.vue';export {default as zh} from './src/renderer/src/i18n/locales/zh';",
      resolveDir: process.cwd()
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    globalName: 'SettingsFixture',
    alias: {
      vue: require.resolve('vue/dist/vue.esm-bundler.js'),
      '@': path.resolve('src/renderer/src')
    },
    define: {
      __VUE_OPTIONS_API__: 'true',
      __VUE_PROD_DEVTOOLS__: 'false',
      __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false'
    },
    plugins: [
      {
        name: 'vue-fixture',
        setup(build) {
          build.onResolve({ filter: /ui[\\/]useMessage$/ }, () => ({
            path: 'message',
            namespace: 'fixture'
          }))
          build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({
            contents: 'export const useMessage=()=>({error:message=>window.errors.push(message)})'
          }))
          build.onLoad({ filter: /\.vue$/ }, ({ path: filename }) => {
            const { descriptor } = parse(fs.readFileSync(filename, 'utf8'), { filename })
            return {
              contents: compileScript(descriptor, { id: filename, inlineTemplate: true }).content,
              loader: 'ts',
              resolveDir: path.dirname(filename)
            }
          })
        }
      }
    ]
  })
  const html = path.join(directory, 'settings.html')
  fs.writeFileSync(html, '<html><body><main id="app"></main></body></html>')
  await win.loadFile(html)
  await win.webContents.executeJavaScript(bundle.outputFiles[0].text)
  console.log(await win.webContents.executeJavaScript('(' + settingsFixture.toString() + ')()'))
}

app.whenReady().then(async () => {
  try {
    const output = path.join(directory, 'service.cjs')
    await build({
      stdin: {
        contents:
          "export * from './src/main/service/systemMediaControlsService';export * from './src/main/service/playbackCommandService'",
        resolveDir: process.cwd()
      },
      outfile: output,
      bundle: true,
      platform: 'node',
      format: 'cjs',
      packages: 'external',
      plugins: [
        {
          name: 'test-boundaries',
          setup(build) {
            build.onLoad({ filter: /loggerService\.ts$/ }, () => ({
              contents: 'export const Logger = {warn(){}}',
              loader: 'ts'
            }))
          }
        }
      ]
    })
    const { createSystemMediaControls, createPlaybackCommandService } = require(output)
    await serviceTests(createSystemMediaControls)
    await commandTests(createPlaybackCommandService)
    const { Session } = require(path.resolve('build/native-addon/easy_player_smtc.node'))
    let win = new BrowserWindow({ show: false, title: 'Easy Player SMTC test' })
    await win.loadURL('about:blank')
    const actions = []
    const session = new Session(win.getNativeWindowHandle(), (action) => actions.push(action))
    await session.ready()
    const snapshot = {
      revision: 1,
      enabled: true,
      hasTrack: true,
      canPrevious: true,
      canNext: true,
      title: '测试曲目 SMTC',
      artist: 'Artist',
      album: 'Album',
      status: 'playing'
    }
    await session.update(snapshot)
    const bytes = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#66aa88' }
    })
      .png()
      .toBuffer()
    await session.artwork(bytes, 1)
    const actual = await until(async () => {
      const value = await probe()
      return value?.title === snapshot.title && value.artworkSize > 0 ? value : null
    }, 'Windows must expose the current title and artwork')
    assert.equal(actual.artist, 'Artist')
    assert.equal(actual.album, 'Album')
    assert.equal(actual.status, 4, 'GSMTC status must be Playing')
    for (const action of ['pause', 'previous', 'next']) assert.equal(actual[action], true, action)
    assert.equal(actual.seek, false, 'seek must not be enabled')
    for (const action of ['pause', 'play', 'previous', 'next']) {
      assert.equal(await probe(action), true)
      await until(() => actions.includes(action), 'Missing native button callback: ' + action)
      if (action === 'pause' || action === 'play') {
        await session.update({ ...snapshot, status: action === 'pause' ? 'paused' : 'playing' })
        await until(
          async () => (await probe())?.status === (action === 'pause' ? 5 : 4),
          'Playback feedback missing'
        )
      }
    }
    await session.update({ ...snapshot, status: 'paused' })
    await until(async () => (await probe())?.status === 5, 'pause status must be published')
    await session.update({ ...snapshot, revision: 2, title: 'Second', status: 'playing' })
    await session.artwork(bytes, 1)
    await until(async () => {
      const value = await probe()
      return value?.title === 'Second' && value.artworkSize === 0
    }, 'track change must clear artwork and reject stale cover')
    await session.update({ ...snapshot, enabled: false })
    await until(async () => {
      const value = await probe()
      return !value || (!value.play && !value.pause && !value.previous && !value.next)
    }, 'disabled controls must not remain actionable')
    await session.close()
    await session.close()
    let enabledSetting = true
    const integrated = createSystemMediaControls({
      platform: 'win32',
      fallbackCover: 'fixture',
      readEnabled: () => enabledSetting,
      writeEnabled: (enabled) => {
        enabledSetting = enabled
      },
      onAction: () => {},
      readArtwork: async () => bytes,
      createSession: (handle, callback) => new Session(handle, callback)
    })
    integrated.updateTrack(
      { filePath: 'fixture.flac', title: 'Window replacement', artist: 'Artist', album: 'Album' },
      'playing'
    )
    await integrated.attach(win)
    await until(
      async () => (await probe())?.title === 'Window replacement',
      'integrated service must publish to Windows'
    )
    const replacement = new BrowserWindow({ show: false, title: 'Replacement SMTC test' })
    await replacement.loadURL('about:blank')
    await integrated.attach(replacement)
    win.destroy()
    win = replacement
    await until(async () => {
      const value = await probe()
      return value?.title === 'Window replacement' && value.artworkSize > 0 && value.pause
    }, 'replacement HWND must retain metadata, cover and active controls')
    await integrated.setEnabled(false)
    assert.equal(enabledSetting, false)
    await integrated.dispose()
    await settingsTests(win)
    const invalid = new Session(Buffer.alloc(8), () => {})
    await assert.rejects(invalid.ready())
    await invalid.close()
    win.destroy()
    console.log(
      'SMTC native: real Windows session, Unicode metadata, artwork, four commands, pause, stale covers, no seek and cleanup passed'
    )
    clearTimeout(deadline)
    app.exit(0)
  } catch (error) {
    console.error(error)
    clearTimeout(deadline)
    app.exit(1)
  }
})
