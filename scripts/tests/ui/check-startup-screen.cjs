/* eslint-disable @typescript-eslint/no-require-imports */
// Exercise production and development HTML with scripts blocked to simulate a slow startup.
const { app, BrowserWindow } = require('electron')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'ep-startup-')))
app.disableHardwareAcceleration()
app.whenReady().then(async () => {
  let window
  let server
  const deadline = setTimeout(() => {
    console.error('Startup screen verification timed out')
    app.exit(1)
  }, 30_000)
  try {
    const { resolveConfig } = await import('electron-vite')
    const { createServer } = await import('vite')
    const { config } = await resolveConfig({}, 'serve')
    server = await createServer({
      ...config.renderer,
      configFile: false,
      server: { host: '127.0.0.1', port: 0 },
      optimizeDeps: { noDiscovery: true, include: [] }
    })
    await server.listen()
    console.log('Startup preview server ready')
    const origin = server.resolvedUrls.local[0]
    window = new BrowserWindow({
      show: false,
      width: 1280,
      height: 780,
      webPreferences: { backgroundThrottling: false }
    })
    window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      callback({ cancel: details.resourceType === 'script' })
    })
    for (const [mode, page] of ['production', 'development'].flatMap((mode) =>
      ['index', 'extreme'].map((page) => [mode, page])
    )) {
      console.log(`Checking ${mode}/${page}`)
      if (mode === 'production') await window.loadFile(path.resolve(`out/renderer/${page}.html`))
      else await window.loadURL(`${origin}${page}.html`)
      window.webContents.debugger.attach('1.3')
      await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }]
      })
      const state = await window.webContents.executeJavaScript(`(async () => {
        const screen = document.getElementById('startup-screen')
        const logo = screen.querySelector('img')
        await logo.decode()
        document.documentElement.dataset.startupPresented = 'true'
        getComputedStyle(logo).opacity
        const entrance = logo.getAnimations()
        const entranceCount = entrance.length
        const logoOpacity = getComputedStyle(logo).opacity
        entrance.forEach(animation => animation.finish())
        const rect = logo.getBoundingClientRect()
        return {
          visible: getComputedStyle(screen).display !== 'none',
          background: getComputedStyle(screen).backgroundColor,
          children: screen.children.length,
          text: screen.textContent.trim(),
          logoLoaded: logo.naturalWidth > 0,
          embedded: logo.src.startsWith('data:image/png;base64,'),
          entranceCount,
          logoOpacity,
          width: rect.width,
          height: rect.height,
          centered: Math.abs(rect.x + rect.width / 2 - innerWidth / 2) < 1 &&
            Math.abs(rect.y + rect.height / 2 - innerHeight / 2) < 1
        }
      })()`)
      assert.equal(state.visible, true)
      assert.equal(state.children, 1)
      assert.equal(state.text, '')
      assert.equal(state.logoLoaded, true)
      assert.equal(state.embedded, true, 'logo must not depend on a separate resource request')
      assert.equal(state.entranceCount, 0, 'presenting the window must not restart a logo entrance')
      assert.equal(state.logoOpacity, '1', 'keep the painted logo opaque until the exit fade')
      assert.equal(state.width, 88)
      assert.equal(state.height, 88)
      assert.equal(state.centered, true)
      assert.equal(state.background, page === 'index' ? 'rgb(17, 22, 20)' : 'rgb(21, 21, 21)')
      const preview = path.join(os.tmpdir(), `easy-player-startup-${mode}-${page}.png`)
      fs.writeFileSync(preview, (await window.webContents.capturePage()).toPNG())
      const transition = await window.webContents.executeJavaScript(`(() => {
        const screen = document.getElementById('startup-screen')
        screen.getBoundingClientRect()
        document.documentElement.dataset.windowReady = 'true'
        getComputedStyle(screen).opacity
        const animations = screen.getAnimations()
        const fade = animations.find(animation => animation.transitionProperty === 'opacity')
        if (!fade) throw new Error('Startup fade transition was not created')
        animations.forEach(animation => {
          animation.pause()
          animation.currentTime = 320
        })
        const midpoint = Number(getComputedStyle(screen).opacity)
        const visibleDuringFade = getComputedStyle(screen).visibility === 'visible'
        const duration = fade.effect.getTiming().duration
        animations.forEach(animation => animation.finish())
        const hidden = getComputedStyle(screen).visibility === 'hidden'
        delete document.documentElement.dataset.windowReady
        screen.getAnimations().forEach(animation => animation.finish())
        document.documentElement.classList.add('reduce-motion')
        screen.getBoundingClientRect()
        document.documentElement.dataset.windowReady = 'true'
        return {
          midpoint, visibleDuringFade, duration, hidden,
          reducedMotionHidden: getComputedStyle(screen).visibility === 'hidden',
          reducedMotionAnimations: screen.getAnimations({subtree: true}).length
        }
      })()`)
      assert.ok(transition.midpoint > 0 && transition.midpoint < 1)
      assert.equal(transition.visibleDuringFade, true)
      assert.equal(transition.duration, 640)
      assert.equal(transition.hidden, true, 'hide the startup screen after the fade completes')
      assert.equal(transition.reducedMotionHidden, true)
      assert.equal(transition.reducedMotionAnimations, 0)
      console.log(
        `${mode}/${page}: embedded logo, centering, stable first paint, fade and reduced motion passed (${preview})`
      )
      window.webContents.debugger.detach()
    }
    window.destroy()
    await server.close()
    clearTimeout(deadline)
    app.exit(0)
  } catch (error) {
    console.error(error)
    window?.destroy()
    await server?.close()
    clearTimeout(deadline)
    app.exit(1)
  }
})
