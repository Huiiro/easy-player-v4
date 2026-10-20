/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { app, BrowserWindow, screen } = require('electron')

const root = path.resolve(__dirname, '..')
const data = path.join(root, 'build', 'playback-view-check-' + Date.now())
fs.mkdirSync(data, { recursive: true })
process.env.EASY_PLAYER_DATA_DIR = path.join(data, 'easy-player')
app.setPath('userData', path.join(data, 'chromium'))
app.setName('easy-player-playback-view-check')

const trace = []
app.on('browser-window-created', (_event, window) => {
  const id = window.id
  for (const event of ['ready-to-show', 'show', 'closed']) {
    window.on(event, () => {
      trace.push({
        event,
        id,
        time: performance.now(),
        visible: BrowserWindow.getAllWindows()
          .filter((other) => !other.isDestroyed() && other.isVisible())
          .map((other) => other.id)
      })
    })
  }
})

require(path.join(root, 'out/main/index.js'))
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const pinia = "document.getElementById('app').__vue_app__.config.globalProperties.$pinia"
const player = pinia + "._s.get('player')"
const ui = pinia + "._s.get('ui')"

async function ready(extreme, previous) {
  for (let i = 0; i < 150; i++) {
    const window = BrowserWindow.getAllWindows().find(
      (other) =>
        other !== previous &&
        other.isVisible() &&
        other.webContents.getURL().includes(extreme ? 'extreme.html' : 'index.html')
    )
    if (
      window &&
      (await window.webContents
        .executeJavaScript(`Boolean(${player}) && !${player}.playbackModeChanging`)
        .catch(() => false))
    )
      return window
    await wait(100)
  }
  throw Error('Playback view did not become ready')
}

async function run() {
  await app.whenReady()
  let window = await ready(false)
  assert(
    fs.existsSync(path.join(process.env.EASY_PLAYER_DATA_DIR, 'player_data/player.db')),
    'Application must initialize the isolated library'
  )
  // Keep the fixture inside the work area: macOS clamps newly created windows
  // below the menu bar/above the Dock, unlike a later setBounds call.
  const area = screen.getDisplayMatching(window.getBounds()).workArea
  const width = Math.min(1320, area.width)
  const height = Math.min(820, area.height)
  window.setBounds({
    x: area.x + Math.floor((area.width - width) / 2),
    y: area.y + Math.floor((area.height - height) / 2),
    width,
    height
  })
  await wait(200)
  const transitions = []
  for (const maximized of [false, true]) {
    if (maximized) {
      window.maximize()
      await wait(200)
    }
    for (const enabled of [true, false]) {
      const previous = window
      const previousId = previous.id
      const bounds = previous.getNormalBounds()
      // Include an outgoing immersive page, which must not collapse first.
      if (enabled && maximized) {
        await previous.webContents.executeJavaScript(`${ui}.showPlayer = true`)
        await wait(200)
      }
      const started = performance.now()
      const outgoing = await previous.webContents.executeJavaScript(`(async () => {
        let changedView = false
        const observer = new MutationObserver(() => {
          if (Boolean(document.querySelector('.extreme-player')) !== ${!enabled}) changedView = true
        })
        observer.observe(document.getElementById('app'), { childList: true, subtree: true })
        const immersive = ${ui}.showPlayer
        await ${player}.setExtremePlayback(${enabled})
        observer.disconnect()
        return { changedView, immersive, afterImmersive: ${ui}.showPlayer }
      })()`)
      assert.equal(outgoing.changedView, false, 'Outgoing page changed layout before the handoff')
      assert.equal(outgoing.afterImmersive, outgoing.immersive, 'Outgoing immersive page collapsed')
      window = await ready(enabled, previous)
      if (enabled) {
        const regions = await window.webContents.executeJavaScript(`({
          drag: getComputedStyle(document.querySelector('.extreme-drag-region')).getPropertyValue('-webkit-app-region'),
          button: getComputedStyle(document.querySelector('.exit')).getPropertyValue('-webkit-app-region')
        })`)
        assert.equal(regions.drag.trim(), 'drag', 'Lightweight window needs a drag region')
        assert.equal(regions.button.trim(), 'no-drag', 'Player controls must remain clickable')
      }
      assert(previous.isDestroyed(), 'Old renderer was retained')
      assert.equal(window.isMaximized(), maximized, 'Maximized state changed')
      assert.deepEqual(window.getNormalBounds(), bounds, 'Window size or position changed')
      const shown = trace.find((entry) => entry.id === window.id && entry.event === 'show')
      const closed = trace.find((entry) => entry.id === previousId && entry.event === 'closed')
      assert(
        shown.visible.includes(previousId),
        'Old window disappeared before the new window showed'
      )
      assert(closed.visible.includes(window.id), 'Handoff exposed the desktop')
      assert(shown.time <= closed.time, 'Old window closed before replacement showed')
      transitions.push({ enabled, maximized, showMs: Math.round(shown.time - started) })
    }
  }
  const report = { passed: true, transitions, trace }
  fs.writeFileSync(
    path.join(root, 'build', 'playback-view-check.json'),
    JSON.stringify(report, null, 2)
  )
  console.log(JSON.stringify(report))
  app.quit()
}

run().catch((error) => {
  console.error(error)
  app.exit(1)
})
setTimeout(() => app.exit(1), 45000)
