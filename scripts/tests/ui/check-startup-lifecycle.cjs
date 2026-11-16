/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
// Launch the real main process, preload and Vue application with isolated user data.
const { app, BrowserWindow, ipcMain } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const output = fs.mkdtempSync(path.join(os.tmpdir(), 'ep-startup-lifecycle-'))
process.env.EASY_PLAYER_DATA_DIR = path.join(output, 'data')
if (process.env.STARTUP_MAXIMIZED === '1' || process.env.STARTUP_MATERIAL) {
  const data = path.join(process.env.EASY_PLAYER_DATA_DIR, 'player_data')
  fs.mkdirSync(data, { recursive: true })
  const Database = require('better-sqlite3')
  const database = new Database(path.join(data, 'player.db'))
  database.exec(`CREATE TABLE app_setting (
    key TEXT PRIMARY KEY, value_json TEXT NOT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`)
  if (process.env.STARTUP_MAXIMIZED === '1') {
    database
      .prepare('INSERT INTO app_setting (key, value_json) VALUES (?, ?)')
      .run(
        'window.main',
        JSON.stringify({ x: 80, y: 80, width: 1280, height: 780, maximized: true })
      )
  }
  if (process.env.STARTUP_MATERIAL) {
    database
      .prepare('INSERT INTO app_setting (key, value_json) VALUES (?, ?)')
      .run('window.material', JSON.stringify(process.env.STARTUP_MATERIAL))
  }
  database.close()
}
delete process.env.ELECTRON_RENDERER_URL
if (process.env.STARTUP_SOFTWARE === '1') app.disableHardwareAcceleration()
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let ready = false
let visibleFrames = 0
let whiteFrames = 0
let firstShow
let firstFrame
let frameSamples
let nativeFirstOpacity
function sample(image) {
  if (image.isEmpty()) return
  visibleFrames++
  const pixel = image.resize({ width: 1, height: 1 }).toBitmap()
  if (pixel[0] > 235 && pixel[1] > 235 && pixel[2] > 235) whiteFrames++
}
ipcMain.on('window:ready', () => {
  ready = true
})
app.on('browser-window-created', (_event, window) => {
  window.once('show', () => {
    if (firstShow) return
    nativeFirstOpacity = window.getOpacity()
    firstFrame = window.webContents.capturePage()
    firstShow = window.webContents.executeJavaScript(`({
      ready: Boolean(document.documentElement.dataset.windowReady),
      mounted: Boolean(document.getElementById('app').__vue_app__),
      logo: document.querySelector('#startup-screen img').naturalWidth > 0,
      opacity: getComputedStyle(document.getElementById('startup-screen')).opacity
    })`)
    frameSamples = window.webContents.executeJavaScript(`new Promise(resolve => {
      const samples = []
      const screen = document.getElementById('startup-screen')
      const logo = screen.querySelector('img')
      function sampleFrame() {
        const style = getComputedStyle(screen)
        samples.push({
          ready: Boolean(document.documentElement.dataset.windowReady),
          opacity: Number(style.opacity),
          logoOpacity: Number(getComputedStyle(logo).opacity)
        })
        if (style.visibility === 'hidden') resolve(samples)
        else requestAnimationFrame(sampleFrame)
      }
      sampleFrame()
    })`)
  })
})
require(path.resolve('out/main/index.js'))
const timeout = setTimeout(() => {
  console.error('Full startup timed out')
  app.exit(1)
}, 30_000)
;(async () => {
  await app.whenReady()
  while (!firstShow) await delay(50)
  const first = await firstShow
  const image = await firstFrame
  sample(image)
  assert.equal(first.ready, false, 'startup must be visible before app readiness')
  assert.equal(first.mounted, false, 'Vue must load after the logo window is shown')
  assert.equal(first.logo, true)
  assert.equal(first.opacity, '1')
  if (process.platform === 'win32')
    assert.equal(nativeFirstOpacity, 0, 'native first-show surfaces must remain transparent')
  const window = BrowserWindow.getAllWindows().find((candidate) => candidate.isVisible())
  fs.writeFileSync(path.join(output, 'first-frame.png'), image.toPNG())
  while (!ready) await delay(50)
  const samples = await frameSamples
  const startupSamples = samples.filter((sample) => !sample.ready)
  assert.ok(startupSamples.length > 0)
  assert.ok(
    startupSamples.every((sample) => sample.opacity === 1 && sample.logoOpacity === 1),
    'the visible splash and logo must never fade out and reappear during startup'
  )
  assert.ok(
    samples.every((sample, index) => !index || sample.opacity <= samples[index - 1].opacity),
    'the exit fade must decrease smoothly without a flash back to opaque'
  )
  const final = await window.webContents.executeJavaScript(`({
    mounted: Boolean(document.getElementById('app').__vue_app__),
    hidden: getComputedStyle(document.getElementById('startup-screen')).visibility === 'hidden'
  })`)
  assert.equal(final.mounted, true)
  assert.equal(final.hidden, true)
  assert.equal(window.getOpacity(), 1, 'reveal the native window after the splash repaint')
  assert.ok(visibleFrames > 0)
  assert.equal(whiteFrames, 0, 'no visible white frames while initialization is pending')
  fs.writeFileSync(
    path.join(output, 'app-ready.png'),
    (await window.webContents.capturePage()).toPNG()
  )
  let current = window
  for (const extreme of [true, false]) {
    await current.webContents.executeJavaScript(`document.getElementById('app').__vue_app__
      .config.globalProperties.$pinia._s.get('player').setExtremePlayback(${extreme})`)
    let replacement
    while (!replacement) {
      replacement = BrowserWindow.getAllWindows().find(
        (candidate) => candidate !== current && candidate.isVisible()
      )
      if (!replacement) await delay(50)
    }
    const switched = await replacement.webContents.executeJavaScript(`({
      extreme: document.documentElement.dataset.playbackView === 'extreme',
      hidden: getComputedStyle(document.getElementById('startup-screen')).visibility === 'hidden'
    })`)
    assert.equal(switched.extreme, extreme)
    assert.equal(switched.hidden, true, 'mode replacements must not flash the startup overlay')
    current = replacement
  }
  console.log('Normal/extreme view replacements passed')
  console.log(
    JSON.stringify({
      first,
      final,
      visibleFrames,
      whiteFrames,
      nativeFirstOpacity,
      animationFrames: samples.length,
      output
    })
  )
  clearTimeout(timeout)
  app.exit(0)
})().catch((error) => {
  console.error(error)
  app.exit(1)
})
