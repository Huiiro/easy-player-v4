/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import Database from 'better-sqlite3'
import * as Vue from 'vue'
import * as Pinia from 'pinia'

const require = createRequire(import.meta.url)
function load(file, mocks = {}, globals = {}, extra = '') {
  const source = readFileSync(file, 'utf8')
  const script = file.endsWith('.vue')
    ? source.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1]
    : source
  const code = ts.transpileModule(script + '\n' + extra, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const exports = {}
  vm.runInNewContext(
    code,
    {
      exports,
      require: (name) => mocks[name] ?? require(name),
      console,
      setTimeout,
      clearTimeout,
      ...globals
    },
    { filename: file }
  )
  return exports
}

const db = new Database(':memory:')
db.exec(load('src/main/database/schema.ts').schemaV1)
db.exec(
  "INSERT INTO folder (id, name, full_path, is_root_path, import_time) VALUES (1, 'Music', '/music', 1, '2026-01-01')"
)
db.exec(
  "INSERT INTO song (id, title, audio, folder_id, preference, play_times) VALUES (1, 'Song', '/music/1.flac', 1, 1, 0)"
)
db.exec("INSERT INTO song_list (name) VALUES ('Keep this playlist')")
const shared = load('src/shared/statistics.ts')
const settings = load('src/main/database/repository/settings.ts', {
  '../index': { getDatabase: () => db }
})
const policy = load('src/main/database/statisticsControl.ts', {
  './index': { getDatabase: () => db },
  './repository/settings': settings,
  '../../shared/statistics': shared
})
const history = load('src/main/database/repository/playHistory.ts', {
  '../index': { getDatabase: () => db },
  '../../search/searchQuery': {},
  './songHelpers': {}
})
const events = load('src/main/database/recommendations.ts', {
  './index': { getDatabase: () => db }
})
const reads = []
const library = new Proxy(
  { ...settings, savePlayHistory: history.savePlayHistory },
  {
    get: (target, key) =>
      target[key] ??
      (() => {
        reads.push(key)
        return []
      })
  }
)
const asyncHandlers = new Map(),
  syncHandlers = new Map()
load('src/main/ipc/databaseIpcHandlers.ts', {
  electron: {
    ipcMain: {
      handle: (key, fn) => asyncHandlers.set(key, fn),
      on: (key, fn) => syncHandlers.set(key, fn)
    }
  },
  '../i18n': { t: (key) => key },
  '../database/repository': library,
  '../database/recommendations': {
    ...events,
    getRecommendationScores: () => {
      reads.push('getRecommendationScores')
      return []
    }
  },
  '../database/statisticsControl': policy,
  '../service/loggerService': { Logger: { warn() {} } },
  '../service/operationLogger': {
    logParams: (value) => value,
    logOperation: (_name, _params, fn) => fn()
  }
}).registerDatabaseIpcHandlers()
function command(action, params) {
  return asyncHandlers.get('database:command')({}, { action, params })
}
function recordSync(params) {
  const event = {}
  syncHandlers.get('database:record-play-event-sync')(event, params)
  assert.equal(event.returnValue.success, true)
}
const count = (table) => db.prepare('SELECT COUNT(*) AS n FROM ' + table).get().n
const start = (generation, startedAt = Date.now()) => ({
  songId: 1,
  startedAt,
  startOrigin: 'manual',
  statisticsGeneration: generation
})
const finish = (generation, startedAt) => ({
  ...start(generation, startedAt),
  playedMs: 30_000,
  durationMs: 100_000,
  endReason: 'closed'
})

assert.equal(policy.getStatisticsState().enabled, true)
let generation = policy.getStatisticsState().generation
const firstStart = Date.now() - 50_000
command('savePlayHistory', start(generation, firstStart))
recordSync(finish(generation, firstStart))
assert.equal(count('play_history'), 1)
assert.equal(db.prepare('SELECT played_ms FROM play_history').get().played_ms, 30_000)
command('getOverviewStats')
assert.equal(reads.length, 1)

const disabled = command('setStatisticsEnabled', { enabled: false }).data
assert.equal(disabled.enabled, false)
assert.notEqual(disabled.generation, generation)
command('savePlayHistory', start(generation))
command('recordPlayEvent', finish(generation, Date.now()))
recordSync(finish(disabled.generation, Date.now()))
assert.equal(count('play_history'), 1, 'disabled async and unload events must not be written')
const queries = [
  ['getOverviewStats'],
  ['getPlayHistoryDays'],
  ['getTopPlayedSongs'],
  ['getTopDurationSongs'],
  ['getRecommendationScores'],
  ['getRecommendations'],
  ['getHomeRecommendations'],
  ['getHomeRecommendationSongs', { group: 'recommended', generatedFor: '' }],
  ['getRecommendationPage', { group: 'recommended' }],
  ['queryRecentPlayedSongs', {}]
]
for (const [action, params] of queries) assert.equal(command(action, params).success, true)
assert.equal(reads.length, 1, 'disabled queries must not call statistics or recommendation readers')
assert.equal(count('play_history'), 1, 'turning off preserves existing data')
assert.equal(
  settings.getAppSetting(shared.STATISTICS_SETTING_KEY).enabled,
  false,
  'the setting is persisted'
)
assert.equal(command('setStatisticsEnabled', { enabled: 'false' }).success, false)

generation = command('setStatisticsEnabled', { enabled: true }).data.generation
recordSync(finish(disabled.generation, Date.now()))
assert.equal(count('play_history'), 1, 'events from before re-enabling remain invalid')
command('savePlayHistory', start(generation, Date.now()))
assert.equal(count('play_history'), 2)
db.exec("INSERT INTO recommendation_daily VALUES ('2026-01-01', 0, '{}', 0)")
db.exec(
  "CREATE TRIGGER reject_stats_clear BEFORE DELETE ON recommendation_daily BEGIN SELECT RAISE(ABORT, 'test rollback'); END"
)
assert.equal(command('clearStatisticsData').success, false)
assert.equal(count('play_history'), 2, 'failed clear must roll back every table')
assert.equal(policy.getStatisticsState().generation, generation)
db.exec('DROP TRIGGER reject_stats_clear')
const cleared = command('clearStatisticsData').data
for (const table of ['play_history', 'history', 'recommendation_daily'])
  assert.equal(count(table), 0)
assert.equal(db.prepare('SELECT play_times FROM song').get().play_times, 0)
assert.equal(db.prepare('SELECT preference FROM song').get().preference, 1)
assert.equal(count('song_list'), 1)
command('savePlayHistory', start(generation))
recordSync(finish(generation, Date.now()))
assert.equal(count('play_history'), 0, 'late old-session events cannot repopulate cleared data')
command('savePlayHistory', start(cleared.generation))
assert.equal(count('play_history'), 1, 'new sessions record normally after a clear')
command('setStatisticsEnabled', { enabled: false })
assert.equal(
  command('clearStatisticsData').data.enabled,
  false,
  'clearing must not turn statistics back on'
)

// Exercise the real renderer store and player, including reload and pending responses.
const calls = []
let delayedRefresh
const api = {
  database: {
    getSync: (key) => ({ success: true, data: settings.getAppSetting(key) }),
    saveSync: () => ({ success: true }),
    command: async (action, params) => {
      calls.push([action, params])
      if (action === 'getStatisticsState' && delayedRefresh) return delayedRefresh.promise
      return command(action, params)
    },
    recordPlayEventSync: (params) => recordSync(params)
  },
  miniPlayer: { update() {} },
  system: { updateTray() {} }
}
const storeModule = load(
  'src/renderer/src/stores/statistics/statisticsStore.ts',
  {
    vue: Vue,
    pinia: Pinia,
    '../../../../shared/statistics': shared
  },
  { window: { api } }
)
Pinia.setActivePinia(Pinia.createPinia())
const statistics = storeModule.useStatisticsStore()
assert.equal(
  statistics.enabled,
  false,
  'a fresh renderer reads the persisted disabled setting before playback'
)
const ui = Vue.reactive({ extremePlayback: false, customBg: {} })
const playerModule = load(
  'src/renderer/src/stores/player/playerStore.ts',
  {
    vue: Vue,
    pinia: Pinia,
    '@/stores/persistence': { flushPlayerDataStorage() {} },
    '@/stores/statistics/statisticsStore': { useStatisticsStore: () => statistics },
    '@/stores/ui/uiStore': { useUIStore: () => ui },
    '@/services/audioBridge': { audioBridge: new Proxy({}, { get: () => async () => true }) },
    './smartShuffle': { selectSmartNext: () => -1 },
    '@/stores/log/logStore': { useLogStore: () => ({ addEntry() {} }) },
    '@/components/ui/useMessage': { useMessage: () => ({ warning() {}, success() {}, info() {} }) },
    '@/i18n': { t: (key) => key },
    '@/consts': { PlayMode: { List: 0, Random: 1, Single: 2 } },
    '@/utils/eventBus': { default: { emit() {} } }
  },
  { window: { api }, document: { documentElement: { dataset: {}, classList: { toggle() {} } } } }
)
const player = playerModule.usePlayerStore()
player.queue = [{ id: 1, title: 'Song', audio: '/music/1.flac', songStatus: 1, preference: 1 }]
player.currentQueueIndex = 0
player.durationMs = 100_000
await player.play()
player.finishHistoryOnUnload()
assert.equal(calls.length, 0, 'disabled playback must not send recording or score queries')

await statistics.setEnabled(true)
await player.play()
assert.equal(count('play_history'), 1)
const oldGeneration = statistics.generation
player.state = 'playing'
await statistics.setEnabled(false)
assert.notEqual(statistics.generation, oldGeneration)
const beforeDisabledPlayback = calls.length
await player.play()
player.finishHistoryOnUnload()
assert.equal(calls.length, beforeDisabledPlayback)
await player.setPreference(1, -1)
assert.equal(player.getSongPreference(1), -1, 'explicit feedback still works with statistics off')

const staleState = { enabled: false, generation: statistics.generation }
delayedRefresh = {}
delayedRefresh.promise = new Promise((resolve) => {
  delayedRefresh.resolve = resolve
})
const pending = statistics.refresh()
await statistics.setEnabled(true)
delayedRefresh.resolve({ success: true, data: staleState })
await pending
delayedRefresh = undefined
assert.equal(statistics.enabled, true, 'a late settings read must not overwrite a newer toggle')
await statistics.clear()
assert.equal(statistics.enabled, true)
await statistics.setEnabled(false)
await statistics.clear()
assert.equal(count('play_history'), 0)
player.finishHistoryOnUnload()
assert.equal(count('play_history'), 0)
player.state = 'idle'
await Vue.nextTick()

const viewState = Vue.reactive({ enabled: false, generation: 'off' })
const viewCalls = []
const delayedViews = []
let holdViews = false
const viewUi = Vue.reactive({
  homeSectionOrder: [
    'welcome',
    'overview',
    'recommendations',
    'heatmap',
    'topPlayed',
    'topDuration',
    'playlists'
  ],
  hiddenHomeSections: [],
  showWelcomeText: true,
  homeClockEnabled: false
})
const defaultOrder = [...viewUi.homeSectionOrder, 'navigation', 'clock']
const hooks = { ...Vue, onMounted() {}, onActivated() {}, onDeactivated() {}, onBeforeUnmount() {} }
const viewMocks = {
  vue: hooks,
  '@/hooks/useVisibleInterval': { useVisibleInterval() {} },
  'vue-i18n': { useI18n: () => ({ t: (key) => key }) },
  'vue-router': { useRouter: () => ({}) },
  '@/stores/player/playerStore': { usePlayerStore: () => player },
  '@/stores/statistics/statisticsStore': { useStatisticsStore: () => viewState },
  '@/stores/ui/uiStore': {
    useUIStore: () => viewUi,
    DEFAULT_HOME_SECTION_ORDER: defaultOrder,
    DEFAULT_HIDDEN_HOME_SECTIONS: []
  },
  '@/components/ui/useMessage': { useMessage: () => ({ success() {}, warning() {}, error() {} }) },
  '@/utils/eventBus': { default: { on() {}, off() {}, emit() {} } },
  '@/constants/playlists': { LIKED_PLAYLIST_ID: -1 },
  '@/utils/songTextSort': { createSongTextComparator: () => () => 0, songSortText: () => '' },
  './home.css': {}
}
const viewApi = {
  database: {
    command: async (action) => {
      viewCalls.push(action)
      const data =
        action === 'getOverviewStats'
          ? { songCount: 7, totalPlaySeconds: 12 }
          : action === 'getRecommendations'
            ? {
                recommended: [],
                discovery: [],
                lessRecommended: [],
                totals: { recommended: 0, discovery: 0, lessRecommended: 0 },
                generatedFor: '',
                dataThrough: ''
              }
            : action === 'getLikedPlaylistCover'
              ? { cover: null }
              : []
      if (
        holdViews &&
        ['getOverviewStats', 'getRecommendations', 'getHomeRecommendations'].includes(action)
      )
        return new Promise((resolve) => delayedViews.push(() => resolve({ success: true, data })))
      return { success: true, data }
    }
  }
}
const scope = Vue.effectScope()
let home, recommendations, historyView
scope.run(() => {
  home = load(
    'src/renderer/src/views/home/Index.vue',
    viewMocks,
    { window: { api: viewApi }, structuredClone },
    'exports.fixture={load,loadStatistics,isSectionVisible,stats,historyDays,recommendationCards}'
  ).fixture
  recommendations = load(
    'src/renderer/src/views/recommend/Index.vue',
    viewMocks,
    { window: { api: viewApi } },
    'exports.fixture={load,showMore,groups}'
  ).fixture
  historyView = load(
    'src/renderer/src/components/songlist/SongListView.vue',
    viewMocks,
    {
      window: { api: viewApi },
      defineProps: () => ({ source: { type: 'history' } }),
      withDefaults: (props) => props,
      defineExpose() {}
    },
    'exports.fixture={getSongs}'
  ).fixture
})
await home.load()
await recommendations.load()
await recommendations.showMore('recommended')
assert.equal((await historyView.getSongs()).length, 0)
assert.ok(
  viewCalls.every((action) => ['listPlaylists', 'getLikedPlaylistCover'].includes(action)),
  'disabled views may load playlists but must not request statistics, history or recommendations'
)
assert.equal(home.isSectionVisible('overview'), false)
assert.equal(home.isSectionVisible('recommendations'), false)
assert.equal(home.isSectionVisible('welcome'), true)
viewState.enabled = true
viewState.generation = 'on'
await Vue.nextTick()
await home.loadStatistics()
await recommendations.load()
assert.equal(home.stats.value.totalPlaySeconds, 12)
assert.equal(home.isSectionVisible('overview'), true)
holdViews = true
viewState.generation = 'on-with-pending-reads'
await Vue.nextTick()
const pendingHome = home.loadStatistics()
const pendingRecommendations = recommendations.load()
viewState.enabled = false
viewState.generation = 'off-again'
await Vue.nextTick()
for (const resolve of delayedViews) resolve()
await Promise.all([pendingHome, pendingRecommendations])
assert.equal(
  home.stats.value.totalPlaySeconds,
  0,
  'late statistics replies must not restore the cleared view cache'
)
assert.equal(home.recommendationCards.value.length, 0)
assert.equal(recommendations.groups.value.recommended.length, 0)
scope.stop()
db.close()
console.log(
  'Statistics persistence, IPC suspension, atomic clear, stale session rejection, player lifecycle and disabled home/history/recommendation views passed'
)
