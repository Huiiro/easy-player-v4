/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import { parse, compileScript } from '@vue/compiler-sfc'
import * as Vue from 'vue'

const require = createRequire(import.meta.url)
const sortModule = { exports: {} }
vm.runInNewContext(
  ts.transpileModule(readFileSync('src/renderer/src/utils/songTextSort.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText,
  { exports: sortModule.exports, module: sortModule, require }
)
const filename = 'src/renderer/src/components/songlist/SongListView.vue'
const { descriptor } = parse(readFileSync(filename, 'utf8'), { filename })
const source = ts.transpileModule(compileScript(descriptor, { id: 'song-search-ui' }).content, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
const mounts = []
const cleanups = []
const timers = new Map()
const requests = []
let nextTimer = 0
const statistics = Vue.reactive({ enabled: true, generation: 'test' })
const playback = []
const module = { exports: {} }
let serviceWindow
vm.runInNewContext(
  source,
  {
    exports: module.exports,
    module,
    console,
    window: (serviceWindow = {
      addEventListener() {},
      removeEventListener() {},
      api: {
        database: {
          onSearchIndexChanged() {
            return () => {}
          },
          command(action, params) {
            if (action === 'listSources') return Promise.resolve({ success: true, data: [] })
            return new Promise((resolve) => requests.push({ action, params, resolve }))
          }
        }
      }
    }),
    setTimeout(callback) {
      timers.set(++nextTimer, callback)
      return nextTimer
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    require(name) {
      if (name.endsWith('searchPlayback')) {
        const playback = { exports: {} }
        vm.runInNewContext(
          ts.transpileModule(readFileSync('src/renderer/src/services/searchPlayback.ts', 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
          }).outputText,
          { exports: playback.exports, module: playback }
        )
        return playback.exports
      }
      if (name.endsWith('songListQuery') || name.endsWith('useSongSelection')) {
        const file = name.endsWith('songListQuery')
          ? 'src/renderer/src/services/songListQuery.ts'
          : 'src/renderer/src/components/songlist/useSongSelection.ts'
        const helper = { exports: {} }
        vm.runInNewContext(
          ts.transpileModule(readFileSync(file, 'utf8'), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
          }).outputText,
          {
            exports: helper.exports,
            module: helper,
            window: serviceWindow,
            require: (dependency) => (dependency === 'vue' ? Vue : require(dependency))
          }
        )
        return helper.exports
      }
      if (name.endsWith('songTextSort')) return sortModule.exports
      if (name === 'vue')
        return {
          ...Vue,
          onMounted: (callback) => mounts.push(callback),
          onBeforeUnmount: (callback) => cleanups.push(callback)
        }
      if (name === 'vue-i18n') return { useI18n: () => ({ t: (key) => key }) }
      if (name.endsWith('statisticsStore')) return { useStatisticsStore: () => statistics }
      if (name.endsWith('playerStore'))
        return {
          usePlayerStore: () => ({
            queue: [],
            playCollection: async (...args) => {
              playback.push(args)
              return true
            }
          })
        }
      if (name.endsWith('uiStore'))
        return { useUIStore: () => Vue.reactive({ musicSource: 'all', musicSourceId: 0 }) }
      if (name.endsWith('useMessage'))
        return {
          useMessage: () => ({
            success() {},
            warning() {},
            error(message) {
              throw new Error(message)
            }
          })
        }
      if (name.endsWith('eventBus')) return { default: { on() {}, off() {}, emit() {} } }
      if (name.endsWith('playlists')) return { LIKED_PLAYLIST_ID: -1 }
      if (name.endsWith('.vue')) return { default: {} }
      return require(name)
    }
  },
  { filename }
)

const scope = Vue.effectScope()
const props = Vue.reactive({
  source: { type: 'recommendation', group: 'discovery', generatedFor: '2026-10-17' }
})
const state = scope.run(() => module.exports.default.setup(props, { expose() {}, emit() {} }))
const settle = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
  await Vue.nextTick()
}
const respond = async (request, data) => {
  request.resolve({ success: true, data })
  await settle()
}
const ids = () => Array.from(state.filteredSongs.value, (song) => song.id)
const songs = [
  { id: 3, title: 'C', songStatus: 1 },
  { id: 9, title: 'A', songStatus: 1 },
  { id: 1, title: 'B', songStatus: 0 }
]
try {
  mounts.forEach((callback) => callback())
  const initial = requests.shift()
  assert.equal(initial.action, 'getHomeRecommendationSongs')
  assert.equal(initial.params.group, 'discovery')
  assert.equal(initial.params.generatedFor, '2026-10-17')
  await respond(initial, songs)
  assert.deepEqual(ids(), [3, 9, 1], 'default order preserves the dated recommendation ranking')
  await state.playAll()
  assert.deepEqual(
    Array.from(playback.at(-1)[0], (song) => song.id),
    [3, 9],
    'play all excludes unavailable songs'
  )
  assert.equal(
    playback.at(-1)[3],
    'recommendation',
    'recommendation origin is retained for statistics'
  )
  await state.playSong(songs[1])
  assert.equal(playback.at(-1)[1], 9)
  assert.equal(playback.at(-1)[2], null, 'recommendations are not user playlists')
  state.toggleSort('title')
  assert.deepEqual(ids(), [9, 1, 3])
  state.keyword.value = 'A'
  await Vue.nextTick()
  for (const [id, callback] of [...timers]) {
    timers.delete(id)
    callback()
  }
  await respond(requests.shift(), songs)
  const search = requests.shift()
  assert.equal(search.action, 'querySongs')
  assert.equal(search.params.search, 'A')
  await respond(search, {
    data: [
      { id: 9, searchScore: 100 },
      { id: 999, searchScore: 200 }
    ],
    total: 2
  })
  assert.deepEqual(ids(), [9], 'search is restricted to the dated playlist, not the full library')
  state.keyword.value = ''
  await Vue.nextTick()
  for (const [id, callback] of [...timers]) {
    timers.delete(id)
    callback()
  }
  await respond(requests.shift(), songs)
  props.source = { type: 'recommendation', group: 'recommended', generatedFor: '2026-10-18' }
  await settle()
  const stale = requests.shift()
  props.source = { type: 'recommendation', group: 'discovery', generatedFor: '2026-10-16' }
  await settle()
  const current = requests.shift()
  assert.equal(current.params.generatedFor, '2026-10-16')
  await respond(current, [{ id: 7, title: 'Current', songStatus: 1 }])
  await respond(stale, songs)
  assert.deepEqual(ids(), [7], 'late route requests cannot overwrite a new dated playlist')
  statistics.enabled = false
  await settle()
  assert.deepEqual(ids(), [], 'disabling statistics clears recommendation data')
  assert.equal(requests.length, 0)
} finally {
  cleanups.forEach((callback) => callback())
  scope.stop()
}
// Render the actual home card and exercise its title/cover handlers.
const navigation = []
const emitted = []
const homeFile = 'src/renderer/src/views/home/HomeRecommendations.vue'
const homeDescriptor = parse(readFileSync(homeFile, 'utf8'), { filename: homeFile }).descriptor
const home = { exports: {} }
vm.runInNewContext(
  ts.transpileModule(
    compileScript(homeDescriptor, { id: 'recommendation-card', inlineTemplate: true }).content,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
  ).outputText,
  {
    module: home,
    exports: home.exports,
    require(name) {
      if (name === 'vue') return Vue
      if (name === 'vue-router')
        return { useRouter: () => ({ push: (route) => navigation.push(route) }) }
      if (name === 'vue-i18n') return { useI18n: () => ({ t: (key) => key }) }
      return { default: {} }
    }
  }
)
const card = {
  group: 'discovery',
  generatedFor: '2026-10-17',
  songs: [{ id: 1, cover: 'cover.jpg' }],
  total: 1
}
const render = home.exports.default.setup(
  { cards: [card], activeCard: null, pending: false, playlistBusy: false, isPlaying: false },
  { emit: (...args) => emitted.push(args) }
)
const buttons = []
function walk(node) {
  if (!node) return
  if (Array.isArray(node)) {
    node.forEach(walk)
    return
  }
  if (node.type === 'button') buttons.push(node)
  if (Array.isArray(node.children)) walk(node.children)
}
walk(render({}, []))
const title = buttons.find(
  (button) => button.props?.title === 'recommendation.discovery · 2026-10-17'
)
assert.ok(title, 'card title renders as an interactive control')
title.props.onClick()
assert.equal(navigation[0].name, 'RecommendationPlaylist')
assert.equal(navigation[0].params.generatedFor, '2026-10-17')
assert.equal(navigation[0].params.group, 'discovery')
assert.equal(emitted.length, 0, 'title navigation does not start playback')
buttons.find((button) => button.props?.['aria-label'] === 'home.playRecommendation').props.onClick()
assert.equal(emitted[0][0], 'play', 'cover still starts playback')
console.log(
  'Recommendation playlist: title navigation, cover playback, dated songs, search, queue origin, stale requests and statistics disable passed'
)
