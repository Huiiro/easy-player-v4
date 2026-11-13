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
const ambient = script('src/renderer/src/components/background/player/AmbientBubbleCanvas.vue')
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
let sampledPixels
vm.runInNewContext(compile(readFileSync('src/renderer/src/hooks/useImageColors.ts', 'utf8')), {
  exports: analyzer,
  document: {
    createElement: () => ({
      getContext: () => ({ drawImage() {}, getImageData: () => ({ data: sampledPixels }) })
    })
  }
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
props.secondary = '210 20 20'
assert.ok(
  hueDistance(colors.ambientColor(colors.readPalette()[1]).hue, 0) < 1,
  'similar swatches retain their artwork hue instead of a fixed 42 degree offset'
)

const options = {
  image: { naturalWidth: 32, naturalHeight: 32 },
  isPanelBackground: false,
  useLiquidBackground: true, // Ambient and liquid share the complete vibrant palette path.
  coverAnalysisVersion: 11,
  getLyricsRegion: () => null,
  song: {
    id: 1,
    cover: 'transparent-red',
    coverAnalysisPath: 'transparent-red',
    coverAnalysisVersion: 11,
    coverPrimary: '77 136 220',
    coverSecondary: '205 78 165'
  }
}
sampledPixels = new Uint8ClampedArray(
  Array.from({ length: 1024 }, (_, index) =>
    index % 32 < 16 ? [220, 20, 20, 255] : [0, 0, 0, 0]
  ).flat()
)
const redCover = analyzer.CoverAnalyzer.analyze(options)
assert.equal(
  redCover.source,
  'sampled',
  'Ambient must bypass the persisted two-color album palette'
)
for (const rgb of Object.values(redCover.palette))
  assert.equal(
    rgb,
    '220 20 20',
    'transparent regions must reuse visible artwork, with no default blue or synthetic tertiary hue'
  )
sampledPixels = new Uint8ClampedArray(
  Array.from({ length: 1024 }, (_, index) => [
    ...[
      [220, 20, 20],
      [20, 180, 40],
      [230, 170, 20]
    ][index % 3],
    255
  ]).flat()
)
const threeOptions = {
  ...options,
  song: { ...options.song, cover: 'three-colors', coverAnalysisPath: 'three-colors' }
}
const threeCover = analyzer.CoverAnalyzer.analyze(threeOptions)
assert.equal(
  new Set(Object.values(threeCover.palette)).size,
  3,
  'all three distinct artwork colors are sampled'
)
assert.ok(
  Object.values(threeCover.palette).includes('230 170 20'),
  'the third artwork color survives sampling'
)
const cachedCover = analyzer.CoverAnalyzer.analyze(threeOptions)
assert.equal(cachedCover.source, 'cache')
assert.deepEqual(
  cachedCover.palette,
  threeCover.palette,
  'the complete in-memory cache retains the real third swatch'
)
sampledPixels = new Uint8ClampedArray(4096)
const transparent = analyzer.CoverAnalyzer.analyze({ ...options, song: undefined })
for (const rgb of Object.values(transparent.palette)) {
  const [r, g, b] = rgb.split(' ').map(Number)
  assert.equal(r, g, 'fully transparent artwork uses a neutral fallback')
  assert.equal(g, b)
}

// Exercise the actual preloader callback without a mounted cover component.
const panel = readFileSync('src/renderer/src/components/player/usePlayerBackdrop.ts', 'utf8')
const panelTree = ts.createSourceFile('panel.ts', panel, ts.ScriptTarget.Latest, true)
const backdrop = panelTree.statements.find(
  (node) => ts.isFunctionDeclaration(node) && node.name?.text === 'usePlayerBackdrop'
)
const watcher = backdrop.body.statements.find(
  (node) =>
    ts.isExpressionStatement(node) &&
    ts.isCallExpression(node.expression) &&
    node.expression.expression.getText(panelTree) === 'watch' &&
    node.expression.arguments[0]?.getText(panelTree) === '[coverUrl, useVibrantPalette]'
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
  useVibrantPalette: { value: true },
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
load(['first', true], null, (callback) => {
  cleanup = callback
})
images[0].onload()
await flush()
assert.deepEqual(analyzed, ['first'], 'preloaded cover supplies colors without a visible img load')
assert.equal(displayedCoverUrl.value, 'first')
load(['stale', true], null, (callback) => {
  cleanup = callback
})
images[1].onload()
cleanup()
load(['current', true], null, (callback) => {
  cleanup = callback
})
images[2].onload()
await flush()
assert.deepEqual(analyzed, ['first', 'current'], 'stale decode cannot overwrite current colors')
assert.equal(displayedCoverUrl.value, 'current')
console.log(
  'Ambient palette checks passed: complete three-color cache, transparent artwork, hue fidelity, preloading and stale decodes'
)
