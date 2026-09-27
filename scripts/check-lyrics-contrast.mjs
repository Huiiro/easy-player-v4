/* eslint @typescript-eslint/explicit-function-return-type: off -- Node regression checks. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

const source = await readFile(
  new URL('../src/renderer/src/hooks/useImageColors.ts', import.meta.url),
  'utf8'
)
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
}).outputText
let pixels
let renderedPixels
const filters = []
let backdropFills = 0
let crops = 0
// Separate original artwork from filtered render data. This checks that contrast
// reads the rendered crop while palette extraction still reads original pixels.
const context = {
  exports: {},
  document: {
    createElement: () => {
      let cropped = false
      return {
        getContext: () => ({
          set filter(value) {
            filters.push(value)
          },
          fillRect() {
            backdropFills++
          },
          drawImage(...args) {
            if (args.length === 9) {
              cropped = true
              crops++
            }
          },
          getImageData: () => ({ data: cropped ? renderedPixels : pixels })
        })
      }
    }
  }
}
vm.createContext(context)
vm.runInContext(compiled, context)
const { CoverAnalyzer } = context.exports
const solid = (rgb, alpha = 255) =>
  new Uint8ClampedArray(Array.from({ length: 1024 }, () => [...rgb, alpha]).flat())
const image = {
  naturalWidth: 1024,
  naturalHeight: 1024,
  getBoundingClientRect: () => ({
    left: 0,
    top: 0,
    right: 1600,
    bottom: 900,
    width: 1600,
    height: 900
  })
}
const viewport = { width: 1600, height: 900 }
const fixedRegion = CoverAnalyzer.getLyricsRegion(image, viewport)
const projected = CoverAnalyzer.getLyricsRegionBounds(image, fixedRegion)
const expected = [880, 126, 480, 648]
;[projected.left, projected.top, projected.width, projected.height].forEach((value, index) =>
  assert(Math.abs(value - expected[index]) < 1e-8)
)
image.getBoundingClientRect = () => ({
  left: 0,
  top: 0,
  right: 600,
  bottom: 1000,
  width: 600,
  height: 1000
})
const resized = CoverAnalyzer.getLyricsRegionBounds(image, fixedRegion)
assert(Math.abs(resized.width - 300) < 1e-8)
assert(Math.abs(resized.height - 405) < 1e-8)
image.getBoundingClientRect = () => {
  throw new Error('Contrast must not consult resized geometry')
}
assert.equal(CoverAnalyzer.getLyricsRegion({ naturalWidth: 0, naturalHeight: 0 }, viewport), null)
const options = {
  image,
  coverAnalysisVersion: 11,
  isPanelBackground: true,
  useLiquidBackground: false,
  getLyricsRegion: () => [100, 100, 400, 400],
  backgroundFilter: 'blur(52px) saturate(1.68) contrast(1.28) brightness(0.52)'
}
for (const rgb of [
  [255, 255, 255],
  [0, 0, 0],
  [220, 10, 10]
]) {
  pixels = solid(rgb)
  renderedPixels = solid([100, 100, 100])
  assert.equal(CoverAnalyzer.analyze(options).source, 'sampled', 'solid artwork must not throw')
}
pixels = solid([255, 255, 255])
renderedPixels = solid([133, 133, 133])
assert.equal(CoverAnalyzer.analyze(options).useDarkLyrics, true)
assert(backdropFills > 0, 'transparent artwork must be composited over the panel backdrop')
assert(filters.includes('blur(13px) saturate(1.68) contrast(1.28) brightness(0.52)'))
for (const [gray, expectedDark] of [
  [120, false],
  [121, false],
  [123, true],
  [125, true],
  [132, true],
  [133, true],
  [255, true],
  [60, false],
  [110, false],
  [115, false]
]) {
  renderedPixels = solid([gray, gray, gray])
  const analysis = CoverAnalyzer.analyze(options)
  assert.equal(analysis.useDarkLyrics, expectedDark, `Unexpected decision for gray ${gray}`)
  assert(analysis.result.lightContrast >= 1)
  assert(analysis.result.darkContrast >= 1)
}
// A few bright pixels must not make dark text preferable over mostly dark art.
renderedPixels = new Uint8ClampedArray(
  Array.from({ length: 1024 }, (_, index) =>
    index < 256 ? [132, 132, 132, 255] : [40, 40, 40, 255]
  ).flat()
)
const mixed = CoverAnalyzer.analyze(options)
assert.equal(mixed.useDarkLyrics, false)
assert.equal(mixed.result.darkReadableRatio, 0.25)
renderedPixels = solid([133, 133, 133])
const song = {
  id: 'test',
  cover: 'white',
  coverAnalysisPath: 'white',
  coverAnalysisVersion: 11,
  coverPrimary: '255 255 255',
  coverSecondary: '255 255 255',
  coverLyricsDark: 1
}
const before = crops
assert.equal(
  CoverAnalyzer.analyze({ ...options, song }).useDarkLyrics,
  true,
  'old decision must not bypass resampling'
)
assert.equal(crops, before + 1)
renderedPixels = solid([60, 60, 60])
assert.equal(
  CoverAnalyzer.analyze({ ...options, song, backgroundFilter: 'none' }).useDarkLyrics,
  false,
  'same palette must permit a new contrast decision'
)
for (const liquid of [true, false]) {
  assert.equal(
    CoverAnalyzer.analyze({ ...options, isPanelBackground: false, useLiquidBackground: liquid })
      .useDarkLyrics,
    false
  )
}
pixels = solid([255, 255, 255], 0)
renderedPixels = solid([16, 20, 22])
assert.equal(CoverAnalyzer.analyze(options).source, 'sampled')
assert.equal(CoverAnalyzer.analyze(options).useDarkLyrics, false)
console.log(
  'Lyrics contrast checks passed: solid/transparent artwork, filtered crop, stale cache, dark backdrops.'
)

// Exercise the page's actual load handlers with controlled event order.
const panelSource = await readFile(
  new URL('../src/renderer/src/views/layout/playerPanel/Index.vue', import.meta.url),
  'utf8'
)
const script = panelSource.match(/<script setup[^>]*>([\s\S]*?)<\/script>/)[1]
const ast = ts.createSourceFile('panel.ts', script, ts.ScriptTarget.Latest, true)
const handlers = ast.statements
  .filter(
    (node) =>
      ts.isFunctionDeclaration(node) &&
      ['analyzeCoverImage', 'extractCoverColors'].includes(node.name?.text)
  )
  .map((node) => node.getText(ast))
  .join('\n')
let analyses = 0
const stats = {
  averageLuminance: 0.52,
  brightRatio: 0,
  nearWhite: 0,
  lowContrastRisk: 0,
  useDarkText: false
}
const page = {
  useAlbumArtwork: { value: true },
  useLiquidBackground: { value: false },
  analyzedBackgrounds: new WeakSet(),
  coverUrl: { value: 'current-cover' },
  player: { currentQueueSong: { id: 'current' } },
  COVER_ANALYSIS_VERSION: 11,
  coverColors: { value: null },
  paletteReady: { value: false },
  useDarkLyrics: { value: false },
  coverColorSource: { value: 'loading' },
  getComputedStyle: () => ({ filter: 'brightness(0.52)' }),
  window: { innerWidth: 1600, innerHeight: 900 },
  CoverAnalyzer: {
    getLyricsRegion: () => [100, 100, 400, 400],
    analyzeBackground: () => ({ ...stats, averageLuminance: 1 }),
    analyze: (options) => {
      analyses++
      if (options.isPanelBackground) options.getLyricsRegion(options.image)
      return {
        palette: {},
        source: 'sampled',
        useDarkLyrics: false,
        result: options.isPanelBackground ? stats : null
      }
    }
  }
}
vm.createContext(page)
vm.runInContext(
  ts.transpileModule(handlers, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText,
  page
)
const background = { classList: { contains: () => true }, getAttribute: () => 'current-cover' }
const thumbnail = { classList: { contains: () => false }, getAttribute: () => 'current-cover' }
page.extractCoverColors({ currentTarget: background })
page.analyzeCoverImage(background)
assert.equal(analyses, 1, 'load event plus cached-image watcher must analyze only once')
page.useDarkLyrics.value = true
page.extractCoverColors({ currentTarget: thumbnail })
assert.equal(page.useDarkLyrics.value, true, 'thumbnail must not overwrite background contrast')
const beforeStale = analyses
page.extractCoverColors({ currentTarget: { ...background, getAttribute: () => 'previous-cover' } })
assert.equal(analyses, beforeStale, 'late events from old artwork must be ignored')
page.window.innerWidth = 600
page.window.innerHeight = 1000
assert.equal(analyses, beforeStale, 'window resize must not trigger analysis')
console.log(
  'Page load checks passed: ref timing, duplicate load, thumbnail ordering, stale source.'
)
