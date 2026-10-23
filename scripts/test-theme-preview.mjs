/* eslint @typescript-eslint/explicit-function-return-type: off */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as vue from 'vue'

const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
const source = readFileSync('src/renderer/src/stores/ui/uiStore.ts', 'utf8')
const region = source.slice(
  source.indexOf('    const customThemes ='),
  source.indexOf('    const themeSettingsKey =')
)
const keys = {}
vm.runInNewContext(
  compile(
    source.slice(
      source.indexOf('export const UI_PREFERENCE_KEYS'),
      source.indexOf('export const useUIStore')
    )
  ),
  { exports: keys }
)
for (const key of ['pendingCustomTheme', 'customThemePreviewSeconds'])
  assert.ok(!keys.UI_PREFERENCE_KEYS.includes(key))
const shared = {}
vm.runInNewContext(compile(readFileSync('src/shared/themePackage.ts', 'utf8')), { exports: shared })
const themes = {}
vm.runInNewContext(compile(readFileSync('src/renderer/src/services/customTheme.ts', 'utf8')), {
  exports: themes,
  require: () => shared,
  TextEncoder,
  CSS: { supports: () => true }
})
function harness() {
  let now = 0
  let id = 0
  const timers = new Map()
  const removed = []
  const timerModule = {}
  vm.runInNewContext(compile(readFileSync('src/renderer/src/services/themePreview.ts', 'utf8')), {
    exports: timerModule,
    Date: { now: () => now },
    setInterval: (fn) => {
      timers.set(++id, fn)
      return id
    },
    clearInterval: (key) => timers.delete(key)
  })
  const context = {
    ...vue,
    ...timerModule,
    themeBackgroundEnabled: vue.ref(true),
    resolvedAppearance: vue.ref({ background: { type: 'theme' } }),
    useDarkMode: vue.ref(true),
    setColorMode: (mode) => {
      context.useDarkMode.value = mode === 'dark'
      context.followSystemTheme.value = mode === 'system'
    },
    useCustomBg: vue.ref(false),
    systemBackground: vue.ref('none'),
    followSystemTheme: vue.ref(false),
    useMica: vue.ref(false),
    getSystemBackgroundTheme: (id) => ({ labelKey: `background.${id}`, colorMode: 'dark' }),
    isSystemBackground: (id) => ['none', 'rainy', 'aurora', 'solid'].includes(id),
    parseCustomTheme: themes.parseCustomTheme,
    applyCustomTheme: () => {},
    window: {
      api: {
        themes: {
          removePackage: async (id) => {
            removed.push(id)
            return { success: true }
          }
        }
      }
    },
    console
  }
  vm.runInNewContext(
    compile(
      region +
        '\nglobalThis.state = {customThemes,activeCustomThemeName,effectiveCustomThemeName,effectiveCustomTheme,customThemePreviewActive,customThemePreviewSeconds,selectCustomTheme,confirmCustomThemePreview,cancelCustomThemePreview,importCustomTheme,removeCustomTheme,selectThemeBackground,themeBackgroundEnabled,useDarkMode,useCustomBg,systemBackground,followSystemTheme,useMica};'
    ),
    context
  )
  const state = context.state
  state.customThemes.value = [
    { version: 1, name: 'A', tokens: {}, rules: {} },
    { version: 1, name: 'B', tokens: {}, rules: {} }
  ]
  state.activeCustomThemeName.value = 'A'
  return {
    state,
    removed,
    advance: (ms, tick = true) => {
      now += ms
      if (tick) for (const fn of [...timers.values()]) fn()
    },
    timers
  }
}
const h = harness(),
  s = h.state
const themeSource = (name) =>
  JSON.stringify({ version: 1, name, tokens: { '--color-primary': '#abc' }, rules: {} })
const saved = () =>
  JSON.stringify({
    activeCustomThemeName: s.activeCustomThemeName.value,
    customThemes: s.customThemes.value
  })
s.selectCustomTheme('B')
assert.equal(s.activeCustomThemeName.value, 'B')
assert.equal(
  s.customThemePreviewActive.value,
  false,
  'installed theme switch never asks for confirmation'
)
assert.equal(h.timers.size, 0)
h.advance(20000)
assert.equal(s.activeCustomThemeName.value, 'B', 'installed selection never auto-reverts')
s.selectCustomTheme('')
assert.equal(s.activeCustomThemeName.value, '')
assert.equal(s.customThemePreviewActive.value, false)
s.selectCustomTheme('B')
const beforeImport = saved()
s.importCustomTheme(themeSource('New'))
assert.equal(s.effectiveCustomThemeName.value, 'New')
assert.equal(s.customThemePreviewActive.value, true, 'only an import starts preview')
assert.equal(s.customThemePreviewSeconds.value, 10)
assert.equal(saved(), beforeImport, 'unconfirmed import is not persisted')
h.advance(9999)
assert.equal(s.customThemePreviewSeconds.value, 1)
h.advance(1)
assert.equal(s.effectiveCustomThemeName.value, 'B', 'import timeout restores previous theme')
assert.equal(saved(), beforeImport)
s.importCustomTheme(themeSource('New'))
h.advance(2000)
s.confirmCustomThemePreview()
assert.equal(s.activeCustomThemeName.value, 'New')
assert.ok(s.customThemes.value.some((theme) => theme.name === 'New'))
s.selectCustomTheme('A')
s.selectCustomTheme('New')
assert.equal(
  s.customThemePreviewActive.value,
  false,
  'later switches to the imported theme are immediate'
)
h.advance(20000)
assert.equal(s.activeCustomThemeName.value, 'New')
s.importCustomTheme(themeSource('Late'))
h.advance(10001, false)
s.confirmCustomThemePreview()
assert.equal(
  s.activeCustomThemeName.value,
  'New',
  'late confirmation cannot commit an expired import'
)
assert.ok(!s.customThemes.value.some((theme) => theme.name === 'Late'))
const info = (id) => ({
  id,
  manifest: { version: 1, id: 'test', theme: 'theme.json', resources: {}, slots: {} }
})
const old = info('11111111-1111-1111-1111-111111111111'),
  fresh = info('22222222-2222-2222-2222-222222222222'),
  staged = info('33333333-3333-3333-3333-333333333333')
s.customThemes.value.find((theme) => theme.name === 'New').package = old
s.importCustomTheme(themeSource('New'), fresh)
assert.equal(s.effectiveCustomTheme.value.package.id, fresh.id)
assert.equal(
  s.customThemes.value.find((theme) => theme.name === 'New').package.id,
  old.id,
  'same-name reimport preserves saved theme until confirmation'
)
s.cancelCustomThemePreview()
assert.equal(s.effectiveCustomTheme.value.package.id, old.id)
assert.ok(h.removed.includes(fresh.id))
assert.ok(!h.removed.includes(old.id))
s.importCustomTheme(themeSource('New'), fresh)
s.confirmCustomThemePreview()
assert.equal(s.effectiveCustomTheme.value.package.id, fresh.id)
assert.ok(h.removed.includes(old.id), 'old package cleaned only after accepting reimport')
s.importCustomTheme(themeSource('Pending'), staged)
s.selectCustomTheme('A')
assert.equal(s.activeCustomThemeName.value, 'A')
assert.equal(s.customThemePreviewActive.value, false, 'ordinary selection cancels a pending import')
assert.ok(h.removed.includes(staged.id))
assert.ok(!s.customThemes.value.some((theme) => theme.name === 'Pending'))
s.importCustomTheme(themeSource('Pending'), staged)
s.selectCustomTheme('')
assert.equal(s.activeCustomThemeName.value, '')
assert.equal(s.customThemePreviewActive.value, false)
s.selectCustomTheme('New')
assert.equal(s.selectThemeBackground('light'), true)
assert.equal(s.activeCustomThemeName.value, 'New', 'color mode leaves the selected theme intact')
assert.equal(s.useDarkMode.value, false)
assert.equal(
  s.customThemePreviewActive.value,
  false,
  'built-in theme cards do not show confirmation'
)
h.advance(10000)
assert.equal(s.useDarkMode.value, false, 'built-in selection is permanent immediately')
s.selectThemeBackground('rainy')
assert.equal(s.systemBackground.value, 'rainy')
assert.equal(s.useDarkMode.value, false, 'background selection does not change color mode')
assert.equal(s.themeBackgroundEnabled.value, false)
s.selectThemeBackground('custom')
assert.equal(s.useCustomBg.value, true)
assert.equal(s.systemBackground.value, 'none')
assert.equal(s.customThemePreviewActive.value, false)
assert.equal(s.selectThemeBackground('custom'), false, 'current background is a no-op')
s.followSystemTheme.value = true
assert.equal(s.selectThemeBackground('light'), true)
s.followSystemTheme.value = false
s.useMica.value = true
assert.equal(s.selectThemeBackground('light'), true)
s.useMica.value = false
s.importCustomTheme(themeSource('DeletePending'), staged)
s.removeCustomTheme('A')
assert.equal(s.customThemePreviewActive.value, false)
assert.equal(h.timers.size, 0)
await vue.nextTick()
console.log(
  'Import-only confirmation: installed/default/background switches, 10-second import timeout, persistence, reimport and cleanup passed'
)
