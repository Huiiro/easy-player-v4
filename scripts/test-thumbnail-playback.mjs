/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import path from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

function load(file, dependencies) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS }
    }).outputText,
    { exports, require: (name) => dependencies[name], setTimeout, clearTimeout }
  )
  return exports
}
function harness(platform = 'win32', visible = true) {
  const theme = Object.assign(new EventEmitter(), {
    shouldUseDarkColors: false,
    shouldUseDarkColorsForSystemIntegratedUI: false
  })
  const zh = load('src/main/i18n/locales/zh.ts', {})
  const en = load('src/main/i18n/locales/en.ts', {})
  const i18n = load('src/main/i18n/colors.ts', { './locales/zh': zh, './locales/en': en })
  const { createThumbnailPlaybackControls } = load('src/main/service/thumbnailPlaybackService.ts', {
    electron: {
      nativeTheme: theme,
      nativeImage: {
        createFromPath: (file) => {
          assert.ok(existsSync(file), 'thumbnail icon is packaged in resources')
          return { file }
        }
      }
    },
    'node:path': path,
    './loggerService': {
      Logger: {
        info() {
          /* Diagnostic output is isolated in this fixture. */
        },
        warn() {
          /* Expected registration failures are tested below. */
        }
      }
    },
    '../i18n': i18n
  })
  const makeWindow = () =>
    Object.assign(new EventEmitter(), {
      destroyed: false,
      visible,
      calls: 0,
      failNext: false,
      isVisible() {
        return this.visible
      },
      buttons: [],
      isDestroyed() {
        return this.destroyed
      },
      setThumbarButtons(buttons) {
        this.calls++
        this.buttons = buttons
        if (this.failNext) {
          this.failNext = false
          return false
        }
        return true
      }
    })
  let window = makeWindow()
  const actions = []
  const controls = createThumbnailPlaybackControls({
    platform,
    window: () => window,
    iconsDirectory: path.resolve('resources/icons/thumbnail'),
    onAction: (action) => actions.push(action)
  })
  controls.attach(window)
  return {
    controls,
    theme,
    i18n,
    actions,
    window: () => window,
    replace() {
      window = makeWindow()
      controls.attach(window)
    }
  }
}
const h = harness()
assert.equal(h.window().buttons.length, 3)
h.window().buttons.forEach((button) => {
  assert.equal(button.flags[0], 'disabled')
  button.click()
})
assert.equal(h.actions.length, 0)
h.controls.update({ hasTrack: true, isPlaying: true })
assert.equal(h.window().buttons[1].tooltip, '暂停')
assert.ok(h.window().buttons[1].icon.file.endsWith('pause-light.png'))
h.window().buttons.forEach((button) => {
  assert.equal(button.flags.length, 0)
  button.click()
})
assert.deepEqual(h.actions, ['previous', 'toggle', 'next'])
const stale = h.window().buttons[1]
h.i18n.setMainLocale('en')
h.theme.shouldUseDarkColorsForSystemIntegratedUI = true
h.theme.emit('updated')
assert.equal(h.window().buttons[1].tooltip, 'Pause')
assert.ok(h.window().buttons[1].icon.file.endsWith('pause-dark.png'))
h.replace()
stale.click()
assert.equal(h.actions.length, 3)
assert.equal(h.window().buttons[1].tooltip, 'Pause')
h.controls.update({ hasTrack: true, isPlaying: false })
assert.equal(h.window().buttons[1].tooltip, 'Play')
assert.ok(h.window().buttons[1].icon.file.endsWith('play-dark.png'))
h.controls.update({ hasTrack: false, isPlaying: false })
h.window().buttons[1].click()
assert.equal(h.actions.length, 3)
h.controls.dispose()
assert.equal(h.theme.listenerCount('updated'), 0)
const other = harness('darwin')
other.controls.update({ hasTrack: true, isPlaying: true })
assert.equal(other.window().buttons.length, 0)
assert.equal(other.theme.listenerCount('updated'), 0)
other.controls.dispose()
const delayed = harness('win32', false)
assert.equal(delayed.window().calls, 0, 'hidden windows defer toolbar registration')
delayed.window().visible = true
delayed.window().failNext = true
delayed.window().emit('show')
await new Promise((resolve) => setTimeout(resolve, 500))
assert.equal(delayed.window().calls, 2, 'registration is retried after Windows rejects it')
assert.equal(delayed.window().buttons.length, 3)
delayed.controls.dispose()
console.log(
  'Thumbnail controls passed: actions, disabled state, playback icons, locale, theme, window replacement and platform isolation'
)
