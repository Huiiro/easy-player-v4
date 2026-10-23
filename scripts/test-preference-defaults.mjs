/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as Vue from 'vue'
import * as Pinia from 'pinia'
import persisted from 'pinia-plugin-persistedstate'

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
const colors = load('src/renderer/src/components/background/songThemeColors.ts')
const appearance = load('src/renderer/src/services/appearance.ts', {
  '@/components/background/songThemeColors': colors
})
const controller = load('src/renderer/src/services/appearanceController.ts', {
  '@/components/background/songThemeColors': colors
})
const uiPreferenceMigration = load('src/renderer/src/stores/ui/uiPreferences.ts')
let savedUiPreferences = null
const uiPreferenceStorage = {
  getItem: () => savedUiPreferences,
  setItem: (_key, value) => {
    savedUiPreferences = value
  }
}
const uiModule = load(
  'src/renderer/src/stores/ui/uiStore.ts',
  {
    pinia: Pinia,
    vue: { ...Vue, watch() {} },
    '@/utils/preferenceDefaults': defaults,
    '@/utils/footerLayout': footer,
    '../../../../shared/shortcuts': shortcuts,
    '../../../../shared/metadataValues': load('src/shared/metadataValues.ts'),
    './uiPreferences': uiPreferenceMigration,
    '@/services/customTheme': {},
    '@/services/themePreview': themePreview,
    '@/services/appearance': appearance,
    '@/services/appearanceController': controller,
    '@/stores/persistence': { playerDataStorage: uiPreferenceStorage },
    '@/components/background/systemBackgroundRegistry': {
      getSystemBackgroundTheme: () => ({ accentColor: '#00ff00' })
    },
    '@/consts': {
      PlayerBgType: { ALBUM: 'album' },
      PlayerCoverStyle: { STANDARD: 'standard' },
      PlayerDisplayMode: { Normal: 0 },
      TagStyle: { Full: 3 },
      DEFAULT_PLAYER_BG_TYPE: 'album',
      DEFAULT_PLAYER_COVER_STYLE: 'standard'
    }
  },
  {
    window: {
      matchMedia: () => ({ addEventListener() {}, removeEventListener() {} }),
      api: { fonts: { list: async () => ({ success: true, data: [] }) } }
    }
  }
)
Pinia.setActivePinia(Pinia.createPinia())
const ui = uiModule.useUIStore()
assert.ok(uiModule.UI_PREFERENCE_KEYS.includes('genreSeparator'))
assert.ok(uiModule.UI_PREFERENCE_KEYS.includes('normalizeMetadataSeparator'))
assert.ok(!uiModule.UI_PREFERENCE_KEYS.includes('normalizeGenreSeparator'))
assert.ok(!uiModule.UI_PREFERENCE_KEYS.includes('normalizeArtistSeparator'))
assert.equal(ui.genreSeparator, '/；;、,，')
assert.equal(ui.normalizeMetadataSeparator, false)
assert.ok(uiModule.UI_PREFERENCE_KEYS.includes('songPlayTrigger'))
assert.equal(ui.songPlayTrigger, 'double', 'song rows retain double click by default')
assert.ok(uiModule.UI_PREFERENCE_KEYS.includes('playerLyricsFontFamily'))
assert.equal(ui.playerLyricsFontFamily, '', 'lyrics follow interface fonts by default')
ui.customFontFamily = 'MiSans'
assert.equal(
  ui.getPlayerLyricsFontStyle.fontFamily,
  undefined,
  'follow mode leaves CSS inheritance intact'
)
ui.playerLyricsFontFamily = 'Noto Sans SC'
const independentFont = ui.getPlayerLyricsFontStyle.fontFamily
assert.match(independentFont, /Noto Sans SC/)
ui.customFontFamily = 'Segoe UI Variable'
assert.equal(
  ui.getPlayerLyricsFontStyle.fontFamily,
  independentFont,
  'global font changes cannot override a separate lyrics font'
)
ui.playerLyricsFontFamily = 'EasyPlayerFont-demo'
assert.match(ui.getPlayerLyricsFontStyle.fontFamily, /EasyPlayerFont-demo/)
await ui.loadCustomFonts()
assert.equal(ui.playerLyricsFontFamily, '', 'a removed imported font falls back to inheritance')
assert.equal(ui.customFontFamily, 'Segoe UI Variable')
ui.customFontFamily = ''
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
for (const [preferences, expectedNormalization] of [
  [{ normalizeArtistSeparator: true, normalizeGenreSeparator: false }, true],
  [{ normalizeArtistSeparator: false, normalizeGenreSeparator: true }, true],
  [{ normalizeArtistSeparator: false, normalizeGenreSeparator: false }, false],
  [{}, false],
  [
    {
      normalizeMetadataSeparator: false,
      normalizeArtistSeparator: true,
      normalizeGenreSeparator: true
    },
    false
  ],
  [{ normalizeMetadataSeparator: true, normalizeArtistSeparator: false }, true]
]) {
  savedUiPreferences = JSON.stringify({ ...preferences, artistSeparator: ';', genreSeparator: ',' })
  const pinia = Pinia.createPinia().use(persisted)
  const app = Vue.createSSRApp({ render: () => null })
  app.use(pinia)
  const hydrated = uiModule.useUIStore(pinia)
  assert.equal(
    hydrated.normalizeMetadataSeparator,
    expectedNormalization,
    'legacy switches migrate before picked-state hydration'
  )
  assert.equal(hydrated.artistSeparator, ';')
  assert.equal(hydrated.genreSeparator, ',')
  hydrated.$persist()
  const saved = JSON.parse(savedUiPreferences)
  assert.equal(saved.normalizeMetadataSeparator, expectedNormalization)
  assert.ok(
    !('normalizeArtistSeparator' in saved) && !('normalizeGenreSeparator' in saved),
    'only the shared normalization preference is persisted'
  )
  hydrated.resetPreferences()
  assert.equal(
    hydrated.normalizeMetadataSeparator,
    false,
    'migrated preferences reset to the original default'
  )
  Pinia.disposePinia(pinia)
}
console.log(
  'Shared separator preference: legacy hydration, explicit value precedence, persistence and reset passed'
)
console.log(
  'Initial preference defaults, repeat resets, resource preservation and configuration-only persistence passed'
)
