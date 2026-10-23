/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const mainSource = readFileSync('src/main/index.ts', 'utf8')
const handlers = new Map()
const settings = new Map()
const local = new Map()
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
// Use the application's real synchronous IPC handlers, including their key validation.
vm.runInNewContext(
  compile(
    mainSource.slice(
      mainSource.indexOf('const isPersistedRendererSettingKey ='),
      mainSource.indexOf("ipcMain.handle('window:command'")
    )
  ),
  {
    ipcMain: { on: (channel, handler) => handlers.set(channel, handler) },
    setAppSetting: (key, value) => settings.set(key, value),
    getAppSetting: (key) => settings.get(key),
    t: (key) => key,
    Logger: { error() {} },
    logError: String
  }
)
function invoke(channel, value) {
  const event = {}
  handlers.get(channel)(event, value)
  return event.returnValue
}
const exports = {}
vm.runInNewContext(compile(readFileSync('src/renderer/src/stores/persistence.ts', 'utf8')), {
  exports,
  setTimeout: () => 1,
  clearTimeout() {},
  localStorage: {
    getItem: (key) => local.get(key) ?? null,
    setItem: (key, value) => local.set(key, value),
    removeItem: (key) => local.delete(key)
  },
  window: {
    api: {
      database: {
        saveSync: (key, value) => invoke('database:save-setting-sync', { key, value }),
        getSync: (key) => invoke('database:get-setting-sync', key)
      }
    }
  }
})
const stored = JSON.stringify({
  songPlayTrigger: 'single',
  extremePlayback: true,
  playerLyricsFontFamily: 'Noto Sans SC',
  playlistHeaderCollapsed: true,
  recommendationPlaylistHeaderCollapsed: false,
  footerLayout: { enabled: true, mode: 'stacked', maxWidth: 1500, progressWeight: 3, gap: 12 },
  shortcutKeys: { enableLightweight: 'ctrl+shift+m' }
})
exports.playerDataStorage.setItem('ui.preferences.v1', stored)
exports.flushPlayerDataStorage()
assert.equal(
  settings.get('pinia.ui.preferences.v1'),
  stored,
  'Mode and shortcut preferences must reach the database'
)
assert.equal(local.size, 0, 'Successful saves must clear the temporary fallback')
assert.equal(
  exports.playerDataStorage.getItem('ui.preferences.v1'),
  stored,
  'Fresh renderers must read the saved preferences'
)
assert.equal(
  JSON.parse(exports.playerDataStorage.getItem('ui.preferences.v1')).footerLayout.mode,
  'stacked',
  'Footer layout must survive a renderer restart'
)

const startup = {}
assert.equal(
  JSON.parse(exports.playerDataStorage.getItem('ui.preferences.v1')).playerLyricsFontFamily,
  'Noto Sans SC',
  'Separate lyrics font survives a renderer restart'
)
const restoredHeaders = JSON.parse(exports.playerDataStorage.getItem('ui.preferences.v1'))
assert.equal(
  restoredHeaders.songPlayTrigger,
  'single',
  'song activation survives a renderer restart'
)
assert.equal(restoredHeaders.playlistHeaderCollapsed, true, 'Playlist headers restore collapsed')
assert.equal(
  restoredHeaders.recommendationPlaylistHeaderCollapsed,
  false,
  'Recommendation headers retain their independent expanded state'
)
exports.playerDataStorage.setItem(
  'ui.preferences.v1',
  JSON.stringify({
    ...restoredHeaders,
    playlistHeaderCollapsed: false,
    recommendationPlaylistHeaderCollapsed: true
  })
)
exports.flushPlayerDataStorage()
const toggledHeaders = JSON.parse(exports.playerDataStorage.getItem('ui.preferences.v1'))
assert.equal(toggledHeaders.playlistHeaderCollapsed, false, 'Expanded playlist state is saved')
assert.equal(
  toggledHeaders.recommendationPlaylistHeaderCollapsed,
  true,
  'Collapsed recommendations are saved'
)
vm.runInNewContext(
  compile(
    mainSource.slice(
      mainSource.indexOf('function savedExtremeView('),
      mainSource.indexOf('\nfunction createWindow(')
    ) + '\nexports.savedExtremeView = savedExtremeView'
  ),
  {
    exports: startup,
    getAppSetting: (key) => settings.get(key)
  }
)
assert.equal(
  startup.savedExtremeView(),
  true,
  'The main window and renderer must restore the same playback mode'
)
exports.playerDataStorage.setItem('ui.preferences.v1', JSON.stringify({ extremePlayback: false }))
exports.flushPlayerDataStorage()
assert.equal(startup.savedExtremeView(), false, 'Manual exit must remain persisted')
for (const key of ['system.secret', 'credentials', '', undefined]) {
  assert.equal(invoke('database:save-setting-sync', { key, value: 'invalid' }).success, false)
  assert.equal(invoke('database:get-setting-sync', key).success, false)
}
console.log('Renderer settings round-trip, startup mode restoration and key validation passed')
