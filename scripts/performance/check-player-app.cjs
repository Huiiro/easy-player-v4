/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const path = require('node:path')
const fs = require('node:fs')
const { app, BrowserWindow } = require('electron')
if (process.env.PERF_SOFTWARE === '1') app.disableHardwareAcceleration()
const root = path.resolve(__dirname, '../..')
const buildDir = path.join(root, 'build')
const isolated = path.join(buildDir, 'performance-app-data-' + Date.now())
fs.mkdirSync(isolated, { recursive: true })
process.env.EASY_PLAYER_DATA_DIR = path.join(isolated, 'easy-player')
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
const checkPeaks = process.env.PERF_PLAYER_PEAKS === '1'
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
async function samplePlaybackPeaks(js, phase) {
  const start = (await js('window.api.audio.getStatus()')).data
  const samples = []
  app.getAppMetrics()
  for (let i = 0; i < 240; i++) {
    await sleep(250)
    const processes = app
      .getAppMetrics()
      .map(({ type, cpu }) => ({ type, cpu: cpu.percentCPUUsage }))
    samples.push({ cpu: processes.reduce((total, entry) => total + entry.cpu, 0), processes })
  }
  const end = (await js('window.api.audio.getStatus()')).data
  if (end.positionMs - start.positionMs < 59000 || end.glitchCount !== start.glitchCount)
    throw Error('Interrupted playback during ' + phase)
  const values = samples.map((sample) => sample.cpu).sort((a, b) => a - b)
  return {
    mean: values.reduce((total, cpu) => total + cpu, 0) / values.length,
    p95: values[Math.ceil(values.length * 0.95) - 1],
    max: values.at(-1),
    samples
  }
}
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
  const checkPanel = checkPeaks || process.env.PERF_PLAYER_PANEL === '1'
  const seconds = sampleSeconds + (checkPanel ? 150 : 70)
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
  // This independent writer also executes the song search-index triggers.
  database.function('search_normalize', { deterministic: true }, (text) =>
    text.normalize('NFKC').toLowerCase().trim()
  )
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
  if (checkPanel) {
    const covers = path.join(process.env.EASY_PLAYER_DATA_DIR, 'player_data', 'covers')
    fs.mkdirSync(covers, { recursive: true })
    const cover = path.join(covers, 'test-cover.png')
    fs.copyFileSync(path.join(root, 'resources/icons/easy-player.png'), cover)
    const lrc = Array.from({ length: 100 }, (_, index) => {
      const seconds = index * 2
      return `[${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}.00]Performance lyric ${index}`
    }).join('\n')
    for (const song of songs) {
      song.cover = cover
      database.prepare('UPDATE song SET cover = ?, lrc = ? WHERE id = ?').run(cover, lrc, song.id)
    }
    if (checkPeaks) {
      const timed = Array.from({ length: 100 }, (_, line) => {
        const start = line * 2000
        const words = Array.from(
          { length: 16 },
          (_, i) => `(${start + i * 125},125,0)${String.fromCharCode(0x4e00 + i)}`
        )
        return `[${start},2000]${words.join('')}`
      }).join('\n')
      database
        .prepare("UPDATE song SET lrc=?, lyric_format='yrc' WHERE id=?")
        .run(timed, songs[1].id)
    }
    await js(`${p}.rhythmVisualConfig.enabled = false`)
  }
  database.close()
  await js(`${p}.setQueue(${JSON.stringify(songs)}); ${p}.setVolume(0)`)
  const playing = await js(`${p}.playQueueItem(0)`)
  if (!playing) throw Error('Playback failed')
  if (checkPeaks) {
    const ui =
      "document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ui')"
    await js(
      `${ui}.lyricSourceMode='database'; ${ui}.showPlayerSpectrum=false; ${ui}.setPlayerBgType('album'); ${ui}.showPlayer=true`
    )
    const report = {}
    for (const [index, phase] of ['line', 'word'].entries()) {
      if (index && !(await js(`${p}.playQueueItem(${index})`))) throw Error('Track switch failed')
      await sleep(2500)
      const rows = await js("document.querySelectorAll('.lyric-line').length")
      const timed = await js("!!document.querySelector('.lyric-karaoke-char')")
      if (rows !== 100 || timed !== Boolean(index)) throw Error('Unexpected lyrics during ' + phase)
      report[phase] = await samplePlaybackPeaks(js, phase)
    }
    fs.writeFileSync(
      path.join(buildDir, 'playback-panel-peaks.json'),
      JSON.stringify(report, null, 2)
    )
    await js('window.api.audio.stop()')
    if (errors.length) throw Error(errors.join('; '))
    app.quit()
    return
  }
  const samples = {}
  const modes = checkPanel
    ? ['normal', 'panel', 'cycled', 'extreme', 'restored']
    : ['normal', 'extreme', 'restored']
  for (const mode of modes) {
    if (mode === 'panel' || mode === 'cycled') {
      const ui =
        "document.getElementById('app').__vue_app__.config.globalProperties.$pinia._s.get('ui')"
      await js(
        `${ui}.lyricSourceMode = 'database'; ${ui}.showPlayerSpectrum = false; ${ui}.setPlayerBgType('album'); ${ui}.showPlayer = true`
      )
      if (mode === 'cycled') {
        for (let cycle = 0; cycle < 3; cycle++) {
          for (const background of ['ambient', 'mesh', 'particles', 'album']) {
            await js(`${ui}.setPlayerBgType(${JSON.stringify(background)})`)
            await sleep(600)
          }
        }
      }
    } else if (mode !== 'normal') {
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
    if (
      (mode === 'panel' || mode === 'cycled') &&
      !(await js(
        "document.querySelectorAll('.panel-lyrics .lyric-line').length >= 100 && document.querySelector('.panel-background-item')?.naturalWidth > 0"
      ))
    )
      throw Error('Player panel cover or lyrics did not load')
    app.getAppMetrics()
    const startPosition = initialStatus.data.positionMs
    const count = mode === 'extreme' ? sampleSeconds : checkPanel ? 20 : 6
    for (let i = 0; i < count; i++) {
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
    if (progressed < (mode === 'extreme' ? sampleSeconds * 1000 : count * 500) - 1000)
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
    checkPanel,
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
  await js('window.api.audio.stop()')
  const idleSeconds = Math.max(0, Math.min(600, Number(process.env.PERF_IDLE_SECONDS) || 0))
  if (idleSeconds) {
    report.idleSeconds = idleSeconds
    for (const phase of ['idleVisible', 'idleHidden', 'idleRestored']) {
      if (phase === 'idleHidden') window.hide()
      if (phase === 'idleRestored') window.show()
      await sleep(3000)
      samples[phase] = []
      app.getAppMetrics() // Prime interval-based CPU accounting after the transition.
      for (let i = 0; i < idleSeconds; i++) {
        await sleep(1000)
        const metrics = app.getAppMetrics()
        samples[phase].push({
          cpu: metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0),
          workingSetMiB: metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0) / 1024,
          privateMiB: metrics.reduce((sum, m) => sum + (m.memory.privateBytes || 0), 0) / 1024,
          rendererHeapMiB: await js('performance.memory.usedJSHeapSize / 1048576'),
          hidden: await js('document.hidden')
        })
      }
    }
  }
  fs.writeFileSync(
    path.join(buildDir, 'playback-app-performance.json'),
    JSON.stringify(report, null, 2)
  )
  console.log('APP_PERFORMANCE_RESULT ' + JSON.stringify(report))
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
  (Number(process.env.PERF_EXTREME_SECONDS) || 20) * 1000 +
    Math.min(600, Math.max(0, Number(process.env.PERF_IDLE_SECONDS) || 0)) * 3000 +
    (checkPeaks || process.env.PERF_PLAYER_PANEL === '1' ? 180000 : 90000)
)
