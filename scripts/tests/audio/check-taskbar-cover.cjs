/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
if (process.platform !== 'win32') process.exit(0)
if (!process.versions.electron) {
  const result = require('node:child_process').spawnSync(require('electron'), [__filename], {
    windowsHide: true,
    encoding: 'utf8',
    timeout: 20000
  })
  process.stdout.write(result.stdout || '')
  process.stderr.write(result.stderr || '')
  process.exit(result.status ?? 1)
}
const { app, BrowserWindow, nativeImage } = require('electron')
const sharp = require('sharp')
const ts = require('typescript')
const vm = require('node:vm')
app.setPath('userData', fs.mkdtempSync(path.resolve('build/taskbar-cover-test-')))
app.whenReady().then(async () => {
  let window, preview
  try {
    const native = require(path.resolve('build/native-addon/easy_player_window.node'))
    const frames = [],
      renders = []
    const binding = {
      configureCoverPreview: (...args) => native.configureCoverPreview(...args),
      invalidateCoverPreview: (...args) => native.invalidateCoverPreview(...args),
      drawCoverPreview: (...args) => {
        frames.push(Buffer.from(args[1]))
        const result = native.drawCoverPreview(...args)
        renders.push(result)
        return result
      }
    }
    const exports = {}
    vm.runInNewContext(
      ts.transpileModule(fs.readFileSync('src/main/service/taskbarCoverPreview.ts', 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true }
      }).outputText,
      {
        exports,
        Buffer,
        require: (name) =>
          name === 'electron'
            ? require('electron')
            : name === 'sharp'
              ? sharp
              : name === '../utils/pathUtils'
                ? { getWindowPreviewAddonPath: () => 'binding' }
                : name === './loggerService'
                  ? { Logger: { warn: console.warn } }
                  : binding
      }
    )
    window = new BrowserWindow({ show: false, width: 500, height: 300, frame: false })
    const hooks = new Map(),
      hook = window.hookWindowMessage.bind(window)
    window.hookWindowMessage = (message, callback) => {
      hooks.set(message, callback)
      hook(message, callback)
    }
    preview = exports.createTaskbarCoverPreview({
      platform: 'win32',
      fallback: path.resolve('resources/icons/easy-player.png')
    })
    preview.attach(window)
    await window.loadURL('data:text/html,<title>Taskbar cover preview test</title>')
    window.show()
    window.show()
    const image = (color) =>
      sharp({ create: { width: 200, height: 100, channels: 4, background: color } })
        .png()
        .toBuffer()
    const red = path.join(app.getPath('userData'), 'red.png'),
      blue = path.join(app.getPath('userData'), 'blue.png')
    fs.writeFileSync(red, await image('#ff0000'))
    fs.writeFileSync(blue, await image('#0000ff'))
    const wait = () => new Promise((resolve) => setTimeout(resolve, 160))
    const request = () => {
      const size = Buffer.alloc(8)
      size.writeUInt32LE((320 << 16) | 180)
      hooks.get(0x323)(Buffer.alloc(8), size)
    }
    preview.update(red)
    await wait()
    request()
    assert.deepEqual(
      [...frames.at(-1).subarray((256 * 512 + 256) * 4, (256 * 512 + 256) * 4 + 4)],
      [0, 0, 255, 255],
      'red cover becomes BGRA'
    )
    preview.update(red)
    preview.update(blue)
    await wait()
    request()
    assert.deepEqual(
      [...frames.at(-1).subarray((256 * 512 + 256) * 4, (256 * 512 + 256) * 4 + 4)],
      [255, 0, 0, 255],
      'latest song wins'
    )
    window.minimize()
    request()
    assert.ok(frames.length >= 3, 'minimized window still answers artwork requests')
    preview.update('missing-cover.png')
    await wait()
    await wait()
    request()
    const fallback = frames.at(-1)
    preview.update()
    await wait()
    request()
    assert.deepEqual(frames.at(-1), fallback, 'missing and empty covers use default artwork')
    // DWM rejects unsolicited thumbnail bitmaps before Explorer requests a preview.
    // Verify the same bitmap format through the live-preview API, which accepts it outside Peek.
    assert.equal(
      native.drawCoverPreview(window.getNativeWindowHandle(), frames.at(-1), 0, 0, true),
      true,
      'DWM accepts the cover bitmap'
    )
    assert.equal(native.drawCoverPreview(Buffer.alloc(8), Buffer.alloc(1), 180, 180, false), false)
    assert.equal(
      native.drawCoverPreview(window.getNativeWindowHandle(), Buffer.alloc(1), 180, 180, false),
      false
    )
    window.restore()
    window.show()
    assert.equal(
      window.setThumbarButtons([
        {
          icon: nativeImage.createFromPath('resources/icons/thumbnail/play-dark.png'),
          tooltip: 'Play',
          click() {
            /* Native registration only. */
          }
        }
      ]),
      true,
      'thumbnail buttons coexist with artwork'
    )
    preview.dispose()
    window.destroy()
    console.log(
      'Taskbar cover passed: real DWM artwork, rapid switching, fallback, minimized window, buffer validation and playback buttons'
    )
    app.exit(0)
  } catch (error) {
    console.error(error)
    preview?.dispose()
    window?.destroy()
    app.exit(1)
  }
})
