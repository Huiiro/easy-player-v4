/* eslint @typescript-eslint/explicit-function-return-type: off -- Node regression checks. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(
  new URL('../src/renderer/src/components/background/songThemeColors.ts', import.meta.url),
  'utf8'
)
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText
const { extractSystemThemeColor, accessibleSongAccent, primarySurfaceColors } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
)
const pixels = (base, detail) =>
  new Uint8ClampedArray([
    ...Array.from({ length: 90 }, () => [...base, 255]).flat(),
    ...Array.from({ length: 10 }, () => [...detail, 255]).flat()
  ])
assert.equal(extractSystemThemeColor(pixels([0, 0, 0], [255, 255, 255])), '0 0 0')
assert.equal(extractSystemThemeColor(pixels([255, 255, 255], [0, 0, 0])), '255 255 255')
assert.equal(extractSystemThemeColor(pixels([10, 12, 14], [235, 235, 235])), '10 12 14')
assert.equal(extractSystemThemeColor(pixels([40, 140, 100], [255, 255, 255])), '40 140 100')
assert.equal(extractSystemThemeColor(new Uint8ClampedArray([255, 0, 0, 0])), null)

// Independent contrast checks cover button labels, accent text, and the lighter hover fill.
const luminance = (rgb) =>
  rgb
    .map((v) => {
      const s = v / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    })
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
const contrast = (a, b) =>
  (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05)
for (const raw of [
  '0 0 0',
  '255 255 255',
  '24 24 24',
  '12 30 80',
  '255 255 0',
  '255 0 0',
  '0 255 0',
  '0 0 255',
  '80 155 132'
]) {
  const accent = accessibleSongAccent(`rgb(${raw})`)
    .match(/[\d.]+/g)
    .map(Number)
  assert(contrast(accent, [16, 20, 22]) >= 4.5, `Button foreground: ${raw}`)
  assert(
    contrast(
      accent.map((v) => v * 0.8 + 255 * 0.2),
      [16, 20, 22]
    ) >= 4.5,
    `Hover foreground: ${raw}`
  )
  assert(contrast(accent, [30, 38, 40]) >= 4.5, `Accent text: ${raw}`)
  const surface = primarySurfaceColors(`rgb(${raw})`)
  const text = surface.text === '#ffffff' ? [255, 255, 255] : [0, 0, 0]
  assert(contrast(raw.split(' ').map(Number), text) >= 4.5, `Raw fill: ${raw}`)
  assert(contrast(surface.hover.match(/[\d.]+/g).map(Number), text) >= 4.5, `Raw hover: ${raw}`)
}
assert.equal(primarySurfaceColors('rgb(0 0 0)').text, '#ffffff')
assert.equal(primarySurfaceColors('rgb(255 255 255)').text, '#000000')
assert.equal(primarySurfaceColors('rgb(18 34 52)').text, '#ffffff')
// Check the foreground crossover, including midtones where either choice is close.
for (let channel = 0; channel <= 255; channel++) {
  const rgb = [channel, channel, channel]
  const surface = primarySurfaceColors(`rgb(${rgb.join(' ')})`)
  const text = surface.text === '#ffffff' ? [255, 255, 255] : [0, 0, 0]
  assert(contrast(rgb, text) >= 4.5)
  assert(contrast(surface.hover.match(/[\d.]+/g).map(Number), text) >= 4.5)
}
console.log(
  'Song theme: dominant black/white coverage, transparent artwork, accent and hover contrast passed.'
)
