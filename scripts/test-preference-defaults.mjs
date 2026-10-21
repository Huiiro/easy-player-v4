/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as Vue from 'vue'
import * as Pinia from 'pinia'

function load(file, mocks = {}, globals = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    {
      exports,
      require: (name) => {
        if (!(name in mocks)) throw new Error('Unexpected dependency: ' + name)
        return mocks[name]
      },
      ...globals
    },
    { filename: file }
  )
  return exports
}
const defaults = load('src/renderer/src/utils/preferenceDefaults.ts', { vue: Vue })
const footer = load('src/renderer/src/utils/footerLayout.ts')
const shortcuts = load('src/shared/shortcuts.ts')
const themePreview = load('src/renderer/src/services/themePreview.ts')
const uiModule = load(
  'src/renderer/src/stores/ui/uiStore.ts',
  {
    pinia: Pinia,
    vue: { ...Vue, watch() {} },
    '@/utils/preferenceDefaults': defaults,
    '@/utils/footerLayout': footer,
    '../../../../shared/shortcuts': shortcuts,
    '@/services/customTheme': {},
    '@/services/themePreview': themePreview,
    '@/components/background/songThemeColors': {},
    '@/stores/persistence': {},
    '@/components/background/systemBackgroundRegistry': {},
    '@/consts': {
      PlayerBgType: { ALBUM: 'album' },
      PlayerCoverStyle: { STANDARD: 'standard' },
      PlayerDisplayMode: { Normal: 0 },
      TagStyle: { Full: 3 },
      DEFAULT_PLAYER_BG_TYPE: 'album',
      DEFAULT_PLAYER_COVER_STYLE: 'standard'
    }
  },
  { window: { matchMedia: () => ({ addEventListener() {} }) } }
)
Pinia.setActivePinia(Pinia.createPinia())
const ui = uiModule.useUIStore()
const copy = (value) => JSON.parse(JSON.stringify(value))
const expected = Object.fromEntries(
  uiModule.UI_PREFERENCE_KEYS.filter((key) => key !== 'customThemes').map((key) => [
    key,
    copy(ui[key])
  ])
)
for (const [key, value] of Object.entries(expected)) {
  if (typeof value === 'boolean') ui[key] = !value
  else if (typeof value === 'string') ui[key] = 'modified'
  else if (typeof value === 'number') ui[key] = value + 10
  else if (Array.isArray(value)) ui[key] = ['modified']
  else if (value && typeof value === 'object')
    for (const field of Object.keys(value)) ui[key][field] = 'modified'
}
ui.customThemes = [{ name: 'Keep theme', version: 1 }]
ui.customFonts = [{ family: 'Keep font' }]
ui.platform = 'macOS'
ui.resetPreferences()
for (const [key, value] of Object.entries(expected))
  assert.deepEqual(copy(ui[key]), value, key + ' must match its initial value')
assert.equal(ui.customThemes[0].name, 'Keep theme')
assert.equal(ui.customFonts[0].family, 'Keep font')
assert.equal(ui.platform, 'macOS', 'runtime platform must not be reset')
ui.lyricSourceOrder.push('changed')
ui.resetPreferences()
assert.deepEqual(
  copy(ui.lyricSourceOrder),
  expected.lyricSourceOrder,
  'defaults must remain independent of live state'
)

const calls = []
const player = {
  smartShuffleEnabled: true,
  playbackModeChanging: false,
  resetAudioProcessingSettings: async () => ({ success: true }),
  setSmartShuffleEnabled: async (value) => {
    player.smartShuffleEnabled = value
  },
  saveRhythmVisualConfig: async () => {}
}
let enabled = false
const reset = load(
  'src/renderer/src/services/resetPreferences.ts',
  {
    vue: Vue,
    '@/stores/ui/uiStore': { useUIStore: () => ui },
    '@/stores/player/playerStore': { usePlayerStore: () => player },
    '@/stores/statistics/statisticsStore': {
      useStatisticsStore: () => ({
        setEnabled: async (value) => {
          enabled = value
        }
      })
    },
    '@/stores/persistence': { flushPlayerDataStorage: () => calls.push('flush') }
  },
  {
    window: {
      api: {
        system: {
          setCloseToTray: async () => ({ success: true }),
          setAutoStart: async () => ({ success: true })
        },
        log: { setLevel: async () => ({ success: true }) },
        database: {
          command: async (action, params) => {
            calls.push([action, params])
            return { success: true }
          }
        }
      }
    }
  }
)
ui.homeWelcomeText = 'custom welcome'
await reset.restoreDefaultPreferences()
assert.equal(ui.homeWelcomeText, '')
assert.equal(enabled, true)
assert.equal(player.smartShuffleEnabled, false)
assert.ok(calls.includes('flush'))
assert.ok(
  calls.filter(Array.isArray).every(([action]) => action === 'setSetting'),
  'reset must only persist configuration, never clear library/history/statistics tables'
)
assert.equal(ui.customThemes[0].name, 'Keep theme')
console.log(
  'Initial preference defaults, repeat resets, resource preservation and configuration-only persistence passed'
)
