/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as Vue from 'vue'

function load(file, shared) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    { exports, require: () => shared }
  )
  return exports
}
const shared = load('src/shared/windowMaterial.ts')
const { createWindowMaterialManager } = load('src/main/service/windowMaterialService.ts', shared)
function harness(platform, release, initial = {}) {
  const settings = new Map(Object.entries(initial))
  const calls = []
  let destroyed = false
  let fail = false
  const window = {
    isDestroyed: () => destroyed,
    setBackgroundColor: (value) => calls.push(['color', value]),
    setBackgroundMaterial: (value) => {
      if (fail && value === 'acrylic') throw Error('Native failure')
      calls.push(['windows', value])
    },
    setVibrancy: (value) => calls.push(['mac', value])
  }
  const manager = createWindowMaterialManager({
    platform,
    release,
    read: (key) => settings.get(key),
    write: (key, value) => settings.set(key, value),
    window: () => window
  })
  return {
    manager,
    settings,
    calls,
    destroy: () => {
      destroyed = true
    },
    fail: () => {
      fail = true
    }
  }
}
for (const [platform, release] of [
  ['linux', '6.0.0'],
  ['win32', '10.0.19045'],
  ['win32', '10.0.22000']
]) {
  const h = harness(platform, release)
  assert.deepEqual(Array.from(h.manager.state().available), ['none'])
  assert.throws(() => h.manager.select('acrylic'))
  assert.equal(h.settings.size, 0)
}
const windows = harness('win32', '10.0.22621', { 'window.mica-enabled': true })
assert.equal(windows.manager.state().material, 'mica', 'migrate existing Mica preferences')
windows.manager.select('acrylic')
assert.equal(windows.calls.at(-1)[1], 'acrylic')
assert.equal(windows.settings.get('window.material'), 'acrylic')
assert.equal(windows.settings.get('window.mica-enabled'), false)
assert.equal(
  windows.manager.creationOptions(false).backgroundMaterial,
  'acrylic',
  'startup restores Acrylic'
)
assert.equal(
  Object.keys(windows.manager.creationOptions(true)).length,
  0,
  'lightweight windows omit materials'
)
windows.manager.apply('none', '#151515')
assert.equal(
  windows.manager.state().material,
  'acrylic',
  'temporary window replacement preserves preference'
)
assert.throws(() => windows.manager.select('vibrancy'))
assert.throws(() => windows.manager.select('__proto__'))
windows.manager.select('none')
assert.equal(windows.manager.state().material, 'none')
windows.manager.select('mica')
windows.fail()
assert.throws(() => windows.manager.select('acrylic'))
assert.equal(
  windows.manager.state().material,
  'mica',
  'failed native call leaves saved selection intact'
)
assert.deepEqual(
  windows.calls.at(-1),
  ['windows', 'mica'],
  'failed change reapplies previous material'
)
windows.destroy()
assert.throws(() => windows.manager.select('none'))
assert.equal(windows.manager.state().material, 'mica')

const mac = harness('darwin', '25.0.0')
assert.deepEqual(Array.from(mac.manager.state().available), ['none', 'vibrancy'])
mac.manager.select('vibrancy')
assert.deepEqual(mac.calls.at(-1), ['mac', 'under-window'])
assert.equal(mac.manager.creationOptions(false).backgroundColor, '#00000000')
mac.manager.select('none')
assert.deepEqual(mac.calls.at(-1), ['mac', null])
assert.deepEqual(mac.calls.at(-2), ['color', '#111614'])
assert.ok(mac.calls.every(([type]) => type !== 'windows'))
assert.throws(() => mac.manager.select('liquid-glass'), 'do not expose an unsupported native API')
assert.equal(
  harness('darwin', '25.0.0', { 'window.material': 'acrylic' }).manager.state().material,
  'none'
)
assert.equal(
  harness('win32', '10.0.26100', {
    'window.material': 'none',
    'window.mica-enabled': true
  }).manager.state().material,
  'none'
)
console.log(
  'Window materials: platform gates, native calls, migration, startup, lightweight mode and rollback passed'
)

const uiSource = readFileSync('src/renderer/src/stores/ui/uiStore.ts', 'utf8')
const uiTree = ts.createSourceFile('ui.ts', uiSource, ts.ScriptTarget.Latest, true)
const uiFunctions = []
function visit(node) {
  if (
    ts.isFunctionDeclaration(node) &&
    [
      'setNativeWindowMaterial',
      'setMicaEnabled',
      'applyMicaThemeConstraints',
      'syncFollowSystemTheme'
    ].includes(node.name?.text)
  )
    uiFunctions.push(node.getText(uiTree))
  ts.forEachChild(node, visit)
}
visit(uiTree)
const selected = []
let failure = false
let pending
const ui = {
  availableWindowMaterials: Vue.ref(['none', 'mica', 'acrylic']),
  nativeWindowMaterial: Vue.ref('none'),
  windowMaterialPending: Vue.ref(false),
  useMica: Vue.ref(false),
  themeBeforeMica: Vue.ref(null),
  useDarkMode: Vue.ref(false),
  followSystemTheme: Vue.ref(false),
  useCustomBg: Vue.ref(true),
  systemBackground: Vue.ref('aurora'),
  window: {
    matchMedia: () => ({ matches: true }),
    api: {
      system: {
        setWindowMaterial: async (material) => {
          selected.push(material)
          if (pending) await pending
          return failure
            ? { success: false, error: 'Native error' }
            : {
                success: true,
                data: {
                  available: ['none', 'mica', 'acrylic'],
                  material,
                  enabled: material !== 'none'
                }
              }
        }
      }
    }
  }
}
vm.createContext(ui)
vm.runInContext(
  ts.transpileModule(uiFunctions.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 }
  }).outputText,
  ui
)
await ui.setNativeWindowMaterial('acrylic')
assert.equal(ui.nativeWindowMaterial.value, 'acrylic')
assert.equal(ui.useMica.value, true, 'all native materials share transparent renderer constraints')
assert.equal(ui.followSystemTheme.value, true)
assert.equal(ui.useCustomBg.value, false)
assert.equal(ui.systemBackground.value, 'none')
const original = ui.themeBeforeMica.value
await ui.setNativeWindowMaterial('mica')
assert.equal(
  ui.themeBeforeMica.value,
  original,
  'switching materials preserves the original appearance'
)
await ui.setMicaEnabled(false)
assert.equal(ui.useCustomBg.value, true)
assert.equal(ui.systemBackground.value, 'aurora')
assert.equal(ui.useDarkMode.value, false)
assert.equal(ui.followSystemTheme.value, false)
assert.equal(ui.nativeWindowMaterial.value, 'none')
failure = true
await assert.rejects(ui.setNativeWindowMaterial('acrylic'))
assert.equal(ui.nativeWindowMaterial.value, 'none')
assert.equal(ui.windowMaterialPending.value, false)
failure = false
let finish
pending = new Promise((resolve) => {
  finish = resolve
})
const changing = ui.setNativeWindowMaterial('acrylic')
const count = selected.length
await ui.setNativeWindowMaterial('mica')
assert.equal(selected.length, count, 'pending changes disable duplicate requests')
finish()
await changing
pending = null
await ui.setNativeWindowMaterial('vibrancy')
assert.equal(selected.length, count, 'the renderer cannot request an unavailable platform material')
console.log(
  'Window material UI: selection, appearance restoration, errors and pending requests passed'
)
