/* eslint-disable @typescript-eslint/explicit-function-return-type */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function load(file, dependencies = {}) {
  const exports = {}
  vm.runInNewContext(
    ts.transpileModule(readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
    }).outputText,
    {
      exports,
      require: (name) => {
        if (!(name in dependencies)) throw new Error('Unexpected dependency: ' + name)
        return dependencies[name]
      },
      queueMicrotask
    }
  )
  return exports
}
const colors = load('src/renderer/src/components/background/songThemeColors.ts')
const dependencies = { '@/components/background/songThemeColors': colors }
const { resolveAppearance } = load('src/renderer/src/services/appearance.ts', dependencies)
const { createAppearanceScheduler, createAppearanceHandoff } = load(
  'src/renderer/src/services/appearanceController.ts',
  dependencies
)
const scene = {
  id: 'rainy',
  colorMode: 'dark',
  accentColor: '#8bb3cd',
  headerBackground: '#101820',
  footerBackground: '#102030',
  chromeBorder: '#778899'
}
const base = {
  colorMode: 'dark',
  background: { type: 'preset', id: 'rainy' },
  accentSource: 'auto',
  accentColor: '#336699',
  themeBackgroundEnabled: true,
  customChrome: { header: '#001122', footer: '#112233', border: '#334455' }
}
let combinations = 0
for (const colorMode of ['light', 'dark', 'system']) {
  for (const systemDark of [false, true]) {
    for (const material of ['none', 'mica', 'acrylic', 'vibrancy']) {
      for (const background of [
        { type: 'none' },
        { type: 'preset', id: 'rainy' },
        { type: 'image' },
        { type: 'video' }
      ]) {
        for (const theme of [
          undefined,
          { name: 'Replace', background: 'replace', tokens: {} },
          { name: 'Inherit', background: 'inherit', tokens: {} }
        ]) {
          const preferences = { ...base, colorMode, background }
          const before = JSON.stringify(preferences)
          const result = resolveAppearance(preferences, {
            systemDark,
            material,
            scene,
            songColor: null,
            theme
          })
          assert.equal(
            result.dark,
            colorMode === 'system' ? systemDark : colorMode === 'dark',
            'color mode is independent of backgrounds and materials'
          )
          assert.equal(
            result.background.type,
            material !== 'none'
              ? 'none'
              : theme?.background === 'replace'
                ? 'theme'
                : background.type
          )
          assert.equal(JSON.stringify(preferences), before, 'resolution cannot rewrite preferences')
          if (material !== 'none')
            assert.equal(
              result.contentDark,
              result.dark || systemDark,
              'native content contrast follows its actual system backdrop'
            )
          if (!result.dark)
            assert.equal(result.backgroundScrim, null, 'light mode preserves original backgrounds')
          combinations++
        }
      }
    }
  }
}
const runtime = { systemDark: false, material: 'none', scene, songColor: null }
assert.equal(
  resolveAppearance({ ...base, background: { type: 'preset', id: 'solid' } }, runtime)
    .backgroundScrim,
  null
)
assert.equal(
  resolveAppearance(
    { ...base, colorMode: 'light', background: { type: 'preset', id: 'solid' } },
    runtime
  ).backgroundScrim,
  null
)
assert.equal(resolveAppearance({ ...base, colorMode: 'light' }, runtime).backgroundScrim, null)
assert.equal(
  resolveAppearance(
    { ...base, colorMode: 'light' },
    { ...runtime, scene: { ...scene, colorMode: 'light' } }
  ).backgroundScrim,
  null
)
assert.equal(resolveAppearance(base, { ...runtime, material: 'mica' }).backgroundScrim, null)
for (const type of ['image', 'video']) {
  const chrome = resolveAppearance(
    { ...base, colorMode: 'light', background: { type } },
    runtime
  ).chrome
  assert.equal(chrome.header, base.customChrome.header)
  assert.equal(chrome.footer, base.customChrome.footer)
  assert.equal(chrome.border, base.customChrome.border)
  assert.equal(chrome.dark, true)
  assert.equal(chrome.accentColor, base.accentColor)
}
const lightSceneChrome = resolveAppearance({ ...base, colorMode: 'light' }, runtime).chrome
assert.equal(lightSceneChrome.header, scene.headerBackground)
assert.equal(lightSceneChrome.footer, scene.footerBackground)
assert.equal(lightSceneChrome.border, scene.chromeBorder)
assert.equal(lightSceneChrome.dark, true)
assert.equal(resolveAppearance({ ...base, colorMode: 'light' }, runtime).contentDark, true)
assert.equal(
  resolveAppearance(
    { ...base, colorMode: 'light', background: { type: 'preset', id: 'solid' } },
    runtime
  ).contentDark,
  false
)
assert.equal(
  resolveAppearance(
    { ...base, colorMode: 'light' },
    { ...runtime, scene: { ...scene, colorMode: 'light' } }
  ).chrome.dark,
  false
)
assert.equal(
  resolveAppearance(
    { ...base, colorMode: 'light', background: { type: 'preset', id: 'solid' } },
    runtime
  ).chrome.dark,
  false
)
const theme = { name: 'Palette', background: 'replace', tokens: { '--color-primary': '#ab1234' } }
let result = resolveAppearance({ ...base, themeBackgroundEnabled: false }, { ...runtime, theme })
assert.equal(
  result.background.type,
  'preset',
  'turning off theme background retains the selected scene'
)
assert.equal(
  result.accentSource,
  'theme',
  'palette overrides remain active with background turned off'
)
assert.equal(result.accentColor, '#ab1234')
const saved = JSON.parse(JSON.stringify(base))
result = resolveAppearance(saved, { ...runtime, material: 'mica', theme })
assert.equal(result.background.type, 'none', 'theme backgrounds cannot obscure native material')
assert.equal(result.accentColor, '#ab1234')
result = resolveAppearance(saved, runtime)
assert.equal(result.background.id, 'rainy', 'disabling material restores the saved scene')
result = resolveAppearance({ ...base, accentSource: 'user' }, runtime)
assert.equal(
  result.accentColor,
  base.accentColor,
  'user accent is available independently of scenes'
)
result = resolveAppearance({ ...base, background: { type: 'none' }, accentSource: 'song' }, runtime)
assert.equal(
  result.accentSource,
  'user',
  'missing artwork falls back without changing the saved source'
)
assert.ok(result.reasons.includes('songUnavailable'))
result = resolveAppearance(
  { ...base, background: { type: 'image' }, accentSource: 'song' },
  { ...runtime, songColor: 'rgb(120 180 220)' }
)
assert.equal(result.accentSource, 'song', 'artwork accent also works with local media backgrounds')
result = resolveAppearance(
  { ...base, background: { type: 'none' }, accentSource: 'scene' },
  runtime
)
assert.ok(result.reasons.includes('sceneUnavailable'))

const jobs = []
let value = 'first'
const applied = []
const schedule = createAppearanceScheduler(
  () => applied.push(value),
  (job) => jobs.push(job)
)
schedule()
value = 'second'
schedule()
value = 'latest'
schedule()
assert.equal(jobs.length, 1, 'rapid changes share one scheduled application')
jobs.shift()()
assert.deepEqual(applied, ['latest'], 'scheduled application reads the latest state')
schedule()
jobs.shift()()
assert.equal(applied.length, 2, 'later changes are not dropped after the first application')
let passes = 0
const reentrant = createAppearanceScheduler(
  () => {
    if (++passes === 1) reentrant()
  },
  (job) => jobs.push(job)
)
reentrant()
jobs.shift()()
jobs.shift()()
assert.equal(passes, 2, 'changes caused during application receive a subsequent pass')
const handoff = createAppearanceHandoff()
const presented = []
const stage = (key) => handoff.stage(key, (animated) => presented.push([key, animated]))
stage('a')
handoff.hold('a')
stage('b')
assert.deepEqual(presented, [['a', false]], 'loading retains the visible palette')
handoff.start('b', true)
assert.deepEqual(presented.at(-1), ['b', true], 'palette starts with the ready background')
stage('c')
stage('d')
assert.equal(presented.length, 2, 'queued selections do not repaint the current fade')
handoff.settle(true)
handoff.start('d', true)
assert.deepEqual(presented.at(-1), ['d', true])
handoff.settle(false)
stage('e')
assert.deepEqual(presented.at(-1), ['e', false], 'normal updates resume after handoff')
handoff.hold('e')
stage('f')
handoff.release('e')
handoff.hold('e')
handoff.start('f', true)
assert.equal(presented.length, 4, 'cancelled candidates cannot apply a stale palette')
handoff.release('native')
stage('native')
assert.deepEqual(presented.at(-1), ['native', false], 'native material bypasses the handoff')
console.log(
  `Appearance policy: ${combinations} combinations, source fallback, material restoration and scheduler ordering passed`
)
