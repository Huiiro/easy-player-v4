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
let indexChanged
const module = { exports: {} }
vm.runInNewContext(
  source,
  {
    exports: module.exports,
    module,
    console,
    window: {
      addEventListener() {},
      removeEventListener() {},
      api: {
        database: {
          onSearchIndexChanged(callback) {
            indexChanged = callback
            return () => {
              indexChanged = undefined
            }
          },
          command(action, params) {
            if (action === 'listSources') return Promise.resolve({ success: true, data: [] })
            return new Promise((resolve) => requests.push({ action, params, resolve }))
          }
        }
      }
    },
    setTimeout(callback) {
      timers.set(++nextTimer, callback)
      return nextTimer
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    require(name) {
      if (name.endsWith('songTextSort')) return sortModule.exports
      if (name === 'vue')
        return {
          ...Vue,
          onMounted: (callback) => mounts.push(callback),
          onBeforeUnmount: (callback) => cleanups.push(callback)
        }
      if (name === 'vue-i18n') return { useI18n: () => ({ t: (key) => key }) }
      if (name.endsWith('playerStore')) return { usePlayerStore: () => ({ queue: [] }) }
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
const state = scope.run(() =>
  module.exports.default.setup({ source: { type: 'songs' } }, { expose() {}, emit() {} })
)
const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve()
  await Vue.nextTick()
}
const flushSearch = async () => {
  await Vue.nextTick()
  for (const [id, callback] of [...timers]) {
    timers.delete(id)
    callback()
  }
}
const reply = async (request, songs) => {
  request.resolve({ success: true, data: { data: songs, total: songs.length } })
  await settle()
}
const ids = () => Array.from(state.filteredSongs.value, (song) => song.id)
try {
  mounts.forEach((mount) => mount())
  await reply(requests.shift(), [])
  state.songs.value = [
    { id: 1, title: '七里香', artist: '周杰伦', album: '晴天', fileName: 'Zebra' },
    { id: 2, title: 'Banana', artist: 'Adele', album: '爱你', fileName: '七里香' },
    { id: 3, title: 'Zebra', artist: '陈奕迅', album: 'Zoo', fileName: 'Banana' },
    { id: 4, title: '爱你', artist: '张学友', album: 'Blue', fileName: '爱你' },
    { id: 5, title: '晴天', artist: 'Bob', album: 'Morning', fileName: '晴天' }
  ]
  state.toggleSort('title')
  assert.deepEqual(ids(), [4, 2, 1, 5, 3], 'Chinese pinyin and English share A–Z ordering')
  state.toggleSort('title')
  assert.deepEqual(ids(), [3, 5, 1, 2, 4], 'descending reverses the combined alphabet')
  state.toggleSort('artist')
  assert.deepEqual(ids(), [2, 5, 3, 4, 1], 'artists use the same alphabet')
  state.toggleSort('album')
  assert.deepEqual(ids(), [2, 4, 5, 1, 3], 'albums use the same alphabet')
  state.toggleSort('title')
  state.showFileName.value = true
  assert.deepEqual(ids(), [4, 3, 2, 5, 1], 'file-name view sorts the displayed names')
  state.showFileName.value = false
  const compareNames = sortModule.exports.createSongTextComparator()
  assert.ok(compareNames('Track 2', 'Track 10') < 0, 'natural number order remains')
  assert.equal(compareNames('ＡＢＣ', 'abc'), 0, 'width and case are normalized')
  assert.ok(compareNames('重庆森林', 'Dawn') < 0, 'word-aware pinyin handles common polyphones')
  state.songs.value = [
    { id: 6, title: 'Zebra' },
    { id: 5, title: '東京', artist: 'ヨル', sortReadings: { title: 'toukyou' } },
    { id: 4, title: '七里香' },
    { id: 3, title: '君が好き', sortReadings: { title: 'kimigasuki' } },
    { id: 2, title: 'Banana' },
    { id: 1, title: '爱你' }
  ]
  assert.deepEqual(
    ids(),
    [1, 2, 3, 4, 5, 6],
    'Japanese romaji shares the Chinese/English A–Z order'
  )
  state.toggleSort('title')
  assert.deepEqual(ids(), [6, 5, 4, 3, 2, 1], 'Japanese mixed order reverses too')
  state.toggleSort('title')
  assert.equal(
    sortModule.exports.songSortText(
      { title: '七里香', sortReadings: { title: 'japanesealias' } },
      'title'
    ),
    '七里香',
    'Chinese metadata keeps its pinyin'
  )
  assert.equal(
    sortModule.exports.songSortText({ title: 'ｷﾐ', sortReadings: { title: 'kimi' } }, 'title'),
    'kimi',
    'halfwidth kana supplies Japanese context'
  )
  state.songs.value = []
  state.keyword.value = 'qlx'
  await flushSearch()
  assert.equal(state.sortBy.value, 'relevance')
  assert.equal(state.sortOrder.value, 'desc')
  await reply(requests.shift(), [
    { id: 100, title: 'A', searchScore: 320 },
    { id: 1, title: 'Z', searchScore: 760 }
  ])
  assert.deepEqual(ids(), [1, 100], 'frontend preserves relevance instead of re-sorting by ID')
  state.toggleSort('title')
  assert.deepEqual(ids(), [100, 1], 'explicit title sort overrides relevance')
  indexChanged()
  assert.equal(state.sortBy.value, 'title', 'background refresh keeps the manual sort')
  await reply(requests.shift(), [
    { id: 100, title: 'A', searchScore: 320 },
    { id: 1, title: 'Z', searchScore: 760 }
  ])
  state.keyword.value = ''
  await flushSearch()
  assert.equal(state.sortBy.value, 'title', 'clearing search restores browsing order')
  assert.equal(state.hasSearch.value, false)
  await reply(requests.shift(), [])
  state.keyword.value = 'qlx'
  await flushSearch()
  const oldRequest = requests.shift()
  state.keyword.value = 'qilixiang'
  await flushSearch()
  const newRequest = requests.shift()
  await reply(newRequest, [{ id: 3, title: 'New', searchScore: 760 }])
  await reply(oldRequest, [{ id: 4, title: 'Old', searchScore: 320 }])
  assert.deepEqual(ids(), [3], 'an old query cannot replace new results')
  state.composing.value = true
  state.keyword.value = 'shi'
  await flushSearch()
  assert.equal(requests.length, 0, 'IME composition does not issue intermediate queries')
  state.keyword.value = '世界'
  state.composing.value = false
  await flushSearch()
  assert.equal(requests[0].params.search, '世界')
  await reply(requests.shift(), [])
  process.stdout.write(
    'Song search UI: relevance, manual sort, clearing, refresh, request races and IME passed\n'
  )
} finally {
  cleanups.forEach((cleanup) => cleanup())
  scope.stop()
}

// Exercise the actual global status component, including snapshot/event races.
{
  const statusFile = 'src/renderer/src/components/search/SearchIndexStatus.vue'
  const statusDescriptor = parse(readFileSync(statusFile, 'utf8'), {
    filename: statusFile
  }).descriptor
  const compiled = ts.transpileModule(
    compileScript(statusDescriptor, { id: 'search-status-ui' }).content,
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }
  ).outputText
  const mounted = []
  const unmounted = []
  const pendingSnapshots = []
  const retryTimers = new Map()
  const listeners = new Map()
  let listener
  let removed = false
  const statusModule = { exports: {} }
  vm.runInNewContext(
    compiled,
    {
      exports: statusModule.exports,
      module: statusModule,
      console,
      window: {
        addEventListener: (name, callback) => listeners.set(name, callback),
        removeEventListener: (name) => listeners.delete(name),
        api: {
          database: {
            onSearchIndexStatusChanged(callback) {
              listener = callback
              return () => {
                removed = true
              }
            },
            getSearchIndexStatus: () =>
              new Promise((resolve, reject) => pendingSnapshots.push({ resolve, reject }))
          }
        }
      },
      setTimeout(callback) {
        retryTimers.set(1, callback)
        return 1
      },
      clearTimeout(id) {
        retryTimers.delete(id)
      },
      require(name) {
        if (name === 'vue')
          return {
            ...Vue,
            onMounted: (callback) => mounted.push(callback),
            onBeforeUnmount: (callback) => unmounted.push(callback)
          }
        if (name === 'vue-i18n') return { useI18n: () => ({ t: (key) => key }) }
        return require(name)
      }
    },
    { filename: statusFile }
  )
  const statusScope = Vue.effectScope()
  const ui = statusScope.run(() => statusModule.exports.default.setup({}, { expose() {} }))
  const working = {
    phase: 'indexing',
    total: 10000,
    completed: 2500,
    indexed: 2500,
    pending: 7500,
    retrying: 0,
    nextRetryAt: null,
    currentTitle: '七里香',
    revision: 5
  }
  try {
    mounted.forEach((callback) => callback())
    listener(working)
    pendingSnapshots.shift().resolve({ ...working, completed: 0, revision: 1 })
    await settle()
    assert.equal(
      ui.status.value.completed,
      2500,
      'late initial snapshot cannot replace live progress'
    )
    assert.equal(ui.percentage.value, 25)
    assert.equal(ui.visible.value, true)
    assert.equal(ui.label.value, 'searchIndex.indexing')
    listener({ ...working, phase: 'paused', revision: 6 })
    assert.equal(ui.label.value, 'searchIndex.paused')
    assert.equal(ui.visible.value, false, 'paused background work is hidden from the header')
    listener({
      ...working,
      phase: 'retrying',
      completed: 9999,
      indexed: 10000,
      pending: 1,
      retrying: 1,
      nextRetryAt: Date.now() + 30_000,
      currentTitle: null,
      revision: 7
    })
    assert.ok(ui.percentage.value < 100, 'basic fallback is not presented as completed')
    assert.equal(ui.label.value, 'searchIndex.retrying')
    assert.equal(ui.visible.value, false)
    listener({
      ...working,
      phase: 'ready',
      completed: 10000,
      indexed: 10000,
      pending: 0,
      currentTitle: null,
      revision: 8
    })
    assert.equal(ui.percentage.value, 100)
    assert.equal(ui.label.value, 'searchIndex.ready')
    assert.equal(ui.visible.value, false, 'idle/ready status must not occupy the header')
    listener({ ...working, phase: 'queued', revision: 9 })
    assert.equal(ui.visible.value, true)
    ui.open.value = true
    listener({ ...working, phase: 'ready', pending: 0, currentTitle: null, revision: 10 })
    assert.equal(ui.open.value, false, 'finishing closes an open status panel')
    ui.open.value = true
    listeners.get('keydown')({ key: 'Escape' })
    assert.equal(ui.open.value, false)
    const waiting = ui.refresh()
    unmounted.forEach((callback) => callback())
    pendingSnapshots.shift().resolve({ ...working, revision: 11 })
    await waiting
    assert.equal(
      ui.status.value.phase,
      'ready',
      'unmounted component ignores asynchronous snapshots'
    )
    assert.equal(removed, true)
    assert.equal(listeners.size, 0)
    assert.equal(retryTimers.size, 0)
    process.stdout.write(
      'Search status UI: progress, pause, retry, ready, stale snapshots and cleanup passed\n'
    )
  } finally {
    statusScope.stop()
  }
}
