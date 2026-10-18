/* eslint-disable @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as Vue from 'vue'

const filename = 'src/renderer/src/views/recommend/Index.vue'
const script = readFileSync(filename, 'utf8').match(
  /<script setup lang="ts">([\s\S]*?)<\/script>/
)[1]
const exports = {}
const errors = []
let accepted = false
let release
let hold = false
let calls = 0
const player = {
  resetSongRecommendation: async () => {
    calls++
    if (hold)
      await new Promise((resolve) => {
        release = resolve
      })
    return accepted
  }
}
const mocks = {
  vue: { ...Vue, onActivated() {} },
  '@/hooks/useVisibleInterval': { useVisibleInterval() {} },
  'vue-i18n': { useI18n: () => ({ t: (key) => key }) },
  '@/stores/player/playerStore': { usePlayerStore: () => player },
  '@/stores/statistics/statisticsStore': { useStatisticsStore: () => ({ enabled: true }) },
  '@/components/ui/useMessage': {
    useMessage: () => ({ error: (message) => errors.push(message) })
  },
  '@/components/svg/SvgIcon.vue': {}
}
vm.runInNewContext(
  ts.transpileModule(
    script + '\nexports.fixture = { resetRecommendation, groups, totals, resettingSongIds }',
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }
  ).outputText,
  {
    exports,
    require: (name) => {
      if (!(name in mocks)) throw new Error(`Unexpected dependency: ${name}`)
      return mocks[name]
    },
    window: {
      api: {
        database: {
          command: async () => ({
            success: true,
            data: {
              recommended: [],
              discovery: [],
              lessRecommended: [],
              totals: { recommended: 0, discovery: 0, lessRecommended: 0 },
              generatedFor: '',
              dataThrough: ''
            }
          })
        }
      }
    }
  },
  { filename }
)
const view = exports.fixture
const song = { id: 1, preference: -1 }
view.groups.value.lessRecommended = [song]
view.totals.value.lessRecommended = 1
await view.resetRecommendation(song)
assert.equal(view.groups.value.lessRecommended.length, 1, 'failed reset keeps the song visible')
assert.equal(view.totals.value.lessRecommended, 1)
assert.equal(view.resettingSongIds.value.size, 0)
assert.deepEqual(errors, ['recommendation.failed'])
accepted = true
hold = true
const pending = view.resetRecommendation(song)
await view.resetRecommendation(song)
assert.equal(calls, 2, 'duplicate clicks cannot start a second reset')
assert.equal(view.resettingSongIds.value.has(1), true)
release()
await pending
assert.equal(
  view.groups.value.lessRecommended.length,
  0,
  'successful reset removes the song and refreshes'
)
assert.equal(view.totals.value.lessRecommended, 0)
assert.equal(view.resettingSongIds.value.size, 0)
console.log(
  'Recommendation reset UI: success, failure, refresh and duplicate-click handling passed.'
)
