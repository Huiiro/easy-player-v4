/* eslint @typescript-eslint/explicit-function-return-type: off -- Node regression checks. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const script = (file) =>
  readFileSync(file, 'utf8').match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1]
const compile = (source) =>
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText
const ambient = script('src/renderer/src/components/background/AmbientBubbleCanvas.vue')
const tree = ts.createSourceFile('ambient.ts', ambient, ts.ScriptTarget.Latest, true)
const functions = tree.statements
  .filter(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      ['parseColor', 'ambientColor', 'readPalette'].includes(node.name?.text)
  )
  .map((node) => node.getText(tree))
  .join('\n')
const props = { primary: '', secondary: '', tertiary: '' }
const analyzer = {}
vm.runInNewContext(compile(readFileSync('src/renderer/src/hooks/useImageColors.ts', 'utf8')), {
  exports: analyzer
})
const colors = { props }
vm.createContext(colors)
vm.runInContext(compile(functions), colors)
const hueDistance = (a, b) => Math.abs(((a - b + 540) % 360) - 180)
const cases = [
  { rgb: [40, 24, 24], hue: 0 },
  { rgb: [51, 44, 39], hue: 25 },
  { rgb: [242, 240, 250], hue: 252 },
  { rgb: [230, 240, 238], hue: 168 },
  { rgb: [14, 18, 26], hue: 220 },
  { rgb: [220, 20, 20], hue: 0 }
]
for (const { rgb, hue } of cases) {
  const color = colors.ambientColor(rgb)
  assert.ok(hueDistance(color.hue, hue) < 1, `${rgb}: retain artwork hue ${hue}, got ${color.hue}`)
  assert.equal(color.chromatic, true)
  assert.ok(color.rgb.every(Number.isFinite))
}
for (const gray of [0, 30, 128, 240, 255]) {
  const cached = analyzer.CoverAnalyzer.getCachedPalette(
    {
      cover: 'gray',
      coverAnalysisPath: 'gray',
      coverAnalysisVersion: 11,
      coverPrimary: `${gray} ${gray} ${gray}`,
      coverSecondary: `${gray} ${gray} ${gray}`
    },
    11,
    false
  )
  Object.assign(props, cached)
  for (const rgb of colors.readPalette()) {
    assert.equal(rgb[0], rgb[1], 'neutral artwork must not acquire a fallback hue')
    assert.equal(rgb[1], rgb[2])
  }
}
props.primary = '40 24 24'
props.secondary = '128 128 128'
props.tertiary = '242 240 250'
const palette = colors.readPalette()
assert.ok(palette[0][0] > palette[0][2], 'dark red artwork must not become fallback blue')
assert.equal(palette[1][0], palette[1][2], 'neutral secondary must not be hue-shifted')
assert.ok(palette[2][2] > palette[2][1], 'pastel violet tint remains visible')

// Exercise the actual preloader callback without a mounted cover component.
const panel = script('src/renderer/src/views/layout/playerPanel/Index.vue')
const panelTree = ts.createSourceFile('panel.ts', panel, ts.ScriptTarget.Latest, true)
const watcher = panelTree.statements.find(
  (node) =>
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(panelTree) === 'watch' &&
    node.expression.arguments[0]?.getText(panelTree) === 'coverUrl'
)
assert.ok(watcher)
const images = []
const analyzed = []
const displayedCoverUrl = { value: null }
let load
class TestImage {
  constructor() {
    images.push(this)
  }
  decode() {
    return Promise.resolve()
  }
  removeAttribute(name) {
    if (name === 'src') this.src = ''
  }
}
vm.runInNewContext(compile(watcher.getText(panelTree)), {
  watch: (_source, callback) => {
    load = callback
  },
  coverUrl: {},
  coverFailed: { value: false },
  CoverAnalyzer: { getCachedPalette: () => null },
  player: { currentQueueSong: { id: 1 } },
  COVER_ANALYSIS_VERSION: 11,
  useLiquidBackground: { value: false },
  paletteReady: { value: false },
  coverColors: { value: null },
  coverColorSource: { value: '' },
  displayedCoverUrl,
  resetCoverPalette: () => {},
  Image: TestImage,
  analyzeCoverImage: (image) => analyzed.push(image.src)
})
const flush = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}
let cleanup
load('first', null, (callback) => {
  cleanup = callback
})
images[0].onload()
await flush()
assert.deepEqual(analyzed, ['first'], 'preloaded cover supplies colors without a visible img load')
assert.equal(displayedCoverUrl.value, 'first')
load('stale', null, (callback) => {
  cleanup = callback
})
images[1].onload()
cleanup()
load('current', null, (callback) => {
  cleanup = callback
})
images[2].onload()
await flush()
assert.deepEqual(analyzed, ['first', 'current'], 'stale decode cannot overwrite current colors')
assert.equal(displayedCoverUrl.value, 'current')
console.log(
  'Ambient palette checks passed: dark/pastel hues, neutral artwork, preloading and stale decodes'
)
