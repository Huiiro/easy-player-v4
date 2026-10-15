/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')
if (process.env.PERF_SOFTWARE === '1') app.disableHardwareAcceleration()
const root = path.resolve(__dirname, '..')
const buildDir = path.join(root, 'build')
const isolated = path.join(buildDir, 'performance-app-data-' + Date.now())
fs.mkdirSync(isolated, { recursive: true })
process.env.APPDATA = isolated
app.setPath('userData', path.join(isolated, 'chromium'))
app.setName('easy-player-performance-check')
const oldPath = require.resolve(path.join(root, 'build/native-addon/easy_player_native.node'))
require.cache[oldPath] = {
  id: oldPath,
  filename: oldPath,
  loaded: true,
  exports: require(process.env.PERF_ADDON || oldPath)
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const errors = []
const presentations = []
app.on('browser-window-created', (_event, window) => {
  window.once('show', () => {
    presentations.push({
      id: window.id,
      previousVisible: BrowserWindow.getAllWindows().some(
        (other) => other !== window && other.isVisible()
      )
    })
  })
})
app.on('web-contents-created', (_event, contents) => {
  contents.on('console-message', (_event, level, message) => {
    if (level >= 3) errors.push(message)
  })
})
require(path.join(root, 'out/main/index.js'))
const p = `document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('player')`
async function run() {
  await app.whenReady()
  let window
  for (let i = 0; i < 60; i++) {
    window = BrowserWindow.getAllWindows().find((w) =>
      /(?:index|extreme)\.html/.test(w.webContents.getURL())
    )
    if (
      window &&
      (await window.webContents
        .executeJavaScript(
          `Boolean(document.getElementById('app')?.__vue_app__?.config.globalProperties.$pinia?._s.get('player'))`
        )
        .catch(() => false))
    )
      break
    await sleep(500)
  }
  if (!window) throw Error('No app window')
  const js = (source) => window.webContents.executeJavaScript(source)
  const sampleSeconds = Math.max(20, Math.min(600, Number(process.env.PERF_EXTREME_SECONDS) || 20))
  const seconds = sampleSeconds + 70
  const rate = 48000,
    totalBytes = 44 + rate * seconds * 4,
    wav = Buffer.alloc(44)
  wav.write('RIFF')
  wav.writeUInt32LE(totalBytes - 8, 4)
  wav.write('WAVEfmt ', 8)
  wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20)
  wav.writeUInt16LE(2, 22)
  wav.writeUInt32LE(rate, 24)
  wav.writeUInt32LE(rate * 4, 28)
  wav.writeUInt16LE(4, 32)
  wav.writeUInt16LE(16, 34)
  wav.write('data', 36)
  wav.writeUInt32LE(totalBytes - 44, 40)
  const fixture = path.join(isolated, 'silence.wav')
  const file = fs.openSync(fixture, 'w')
  fs.writeSync(file, wav)
  const block = Buffer.alloc(rate * 4)
  for (let i = 0; i < rate; i++) {
    const sample = Math.round(Math.sin((i * 440 * Math.PI * 2) / rate) * 3000)
    block.writeInt16LE(sample, i * 4)
    block.writeInt16LE(sample, i * 4 + 2)
  }
  for (let i = 0; i < seconds; i++) fs.writeSync(file, block)
  fs.closeSync(file)
  const secondFixture = path.join(isolated, 'second.wav')
  fs.copyFileSync(fixture, secondFixture)
  const Database = require('better-sqlite3')
  const database = new Database(path.join(isolated, 'easy-player/player_data/player.db'))
  const folder = database
    .prepare(
      "INSERT INTO folder(name, full_path, is_root_path, import_time) VALUES (?, ?, 1, datetime('now'))"
    )
    .run('Performance', isolated)
  const songs = [fixture, secondFixture].map((audio, index) => {
    const result = database
      .prepare('INSERT INTO song(title,audio,duration,folder_id) VALUES (?,?,?,?)')
      .run('Test ' + (index + 1), audio, seconds, folder.lastInsertRowid)
    return {
      id: Number(result.lastInsertRowid),
      title: 'Test ' + (index + 1),
      artist: null,
      album: null,
      duration: seconds,
      cover: null,
      audio,
      isNewest: false,
      fileName: path.basename(audio),
      createdAt: new Date().toISOString(),
      songStatus: 1,
      sourceId: null
    }
  })
  database.close()
  await js(`${p}.setQueue(${JSON.stringify(songs)}); ${p}.setVolume(0)`)
  const playing = await js(`${p}.playQueueItem(0)`)
  if (!playing) throw Error('Playback failed')
  const samples = {}
  for (const mode of ['normal', 'extreme', 'restored']) {
    if (mode !== 'normal') {
      const old = window
      if (mode === 'extreme' && process.env.PERF_EOF_HANDOFF === '1')
        await js(`${p}.seek(${seconds * 1000 - 50})`)
      await js(`${p}.setExtremePlayback(${mode === 'extreme'})`)
      for (let attempt = 0; attempt < 100; attempt++) {
        const candidate = BrowserWindow.getAllWindows().find(
          (w) =>
            w !== old &&
            w.isVisible() &&
            w.webContents.getURL().includes(mode === 'extreme' ? 'extreme.html' : 'index.html')
        )
        if (
          candidate &&
          (await candidate.webContents.executeJavaScript(`Boolean(${p})`).catch(() => false))
        ) {
          window = candidate
          break
        }
        await sleep(100)
      }
      if (window === old) throw Error('Renderer was not replaced')
    }
    await sleep(4000)
    const initialStatus = await js('window.api.audio.getStatus()')
    samples[mode] = []
    const startPosition = initialStatus.data.positionMs
    for (let i = 0; i < (mode === 'extreme' ? sampleSeconds : 6); i++) {
      await sleep(mode === 'extreme' ? 1000 : 500)
      const metrics = app.getAppMetrics()
      samples[mode].push({
        glitches: (await js('window.api.audio.getStatus()')).data.glitchCount,
        initialGlitches: initialStatus.data.glitchCount,
        cpu: metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0),
        processes: metrics.map((m) => ({
          type: m.type,
          pid: m.pid,
          workingSetMiB: m.memory.workingSetSize / 1024,
          privateMiB: (m.memory.privateBytes || 0) / 1024
        })),
        privateMiB: metrics.reduce((sum, m) => sum + (m.memory.privateBytes || 0), 0) / 1024,
        workingSetMiB: metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024
      })
    }
    const progressed = (await js('window.api.audio.getStatus()')).data.positionMs - startPosition
    if (progressed < (mode === 'extreme' ? sampleSeconds * 1000 : 3000) - 1000)
      throw Error('Playback stalled during ' + mode + ': ' + progressed)
    if (mode === 'extreme')
      fs.writeFileSync(
        path.join(buildDir, 'extreme-memory-check.png'),
        (await window.webContents.capturePage()).toPNG()
      )
    const state = await js(
      `({mode: document.documentElement.classList.contains('extreme-playback'), position: ${p}.positionMs, extremePanel: Boolean(document.querySelector('.extreme-player'))})`
    )
    if (state.mode !== (mode === 'extreme') || state.extremePanel !== (mode === 'extreme'))
      throw Error('Mode UI mismatch: ' + JSON.stringify(state))
  }
  const playback = await js(
    `({queueLength:${p}.queue.length,index:${p}.currentQueueIndex,state:${p}.state,position:${p}.positionMs})`
  )
  const status = await js('window.api.audio.getStatus()')
  if (
    playback.queueLength !== 2 ||
    playback.index !== (process.env.PERF_EOF_HANDOFF === '1' ? 1 : 0) ||
    playback.state !== 'playing'
  )
    throw Error('Queue/EOF handoff failed: ' + JSON.stringify(playback))
  const steadyUnderruns = samples.extreme.at(-1).glitches - samples.extreme[0].initialGlitches
  if (steadyUnderruns !== 0) throw Error('Steady playback underrun: ' + steadyUnderruns)
  const report = {
    presentations,
    sampleSeconds,
    steadyUnderruns,
    eofHandoff: process.env.PERF_EOF_HANDOFF === '1',
    playback,
    nativeStatus: status.data,
    timestamp: new Date().toISOString(),
    scope:
      'Isolated Electron app, two generated 48 kHz PCM16 tone tracks, volume 0; real renderer replacement and EOF during handoff; summed working sets and private commit. One Windows working-set reclaim after old renderer exit, no periodic trimming.',
    samples,
    errors
  }
  fs.writeFileSync(
    path.join(buildDir, 'playback-app-performance.json'),
    JSON.stringify(report, null, 2)
  )
  console.log('APP_PERFORMANCE_RESULT ' + JSON.stringify(report))
  await js('window.api.audio.stop()')
  if (errors.length) throw Error('Renderer errors: ' + errors.join('; '))
  app.quit()
}
run().catch(async (error) => {
  console.error(error)
  try {
    await BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript('window.api.audio.stop()')
  } catch {
    // A crashed renderer may already be gone; still terminate the isolated test.
  }
  app.exit(1)
})
setTimeout(
  () => {
    console.error('App performance timeout')
    app.exit(1)
  },
  (Number(process.env.PERF_EXTREME_SECONDS) || 20) * 1000 + 70000
)
