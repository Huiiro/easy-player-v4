import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync('src/renderer/src/components/player/spectrumColor.ts', 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
})
const { chooseSpectrumColor, spectrumGradientColors } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const luminance = (color) => {
  const [red, green, blue] = color.split(/\s+/).map(Number)
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255
}

assert.equal(
  chooseSpectrumColor(
    { primary: '240 180 120', secondary: '30 40 60', tertiary: '160 140 130' },
    0.8
  ),
  '30 40 60'
)
assert.equal(
  chooseSpectrumColor({ primary: '30 40 60', secondary: '220 180 100', tertiary: '35 50 70' }, 0.1),
  '220 180 100'
)
const lifted = chooseSpectrumColor(
  { primary: '30 40 60', secondary: '40 45 65', tertiary: '25 50 70' },
  0.15
)
assert(luminance(lifted) - 0.15 >= 0.38)
assert.equal(
  chooseSpectrumColor(
    { primary: '240 210 170', secondary: '40 45 65', tertiary: '25 50 70' },
    0.15
  ),
  '240 210 170'
)
console.log('Spectrum contrast selection passed')
assert.equal(
  chooseSpectrumColor(
    { primary: '220 220 220', secondary: '70 190 220', tertiary: '130 130 130' },
    0.1
  ),
  '70 190 220',
  'Prefer a contrasting cover hue over a neutral highlight'
)
const darkPalette = { primary: '25 25 25', secondary: '20 35 100', tertiary: '30 30 30' }
const adjusted = chooseSpectrumColor(darkPalette, 0.1)
assert(luminance(adjusted) - 0.1 >= 0.38)
assert(Number(adjusted.split(' ')[2]) > Number(adjusted.split(' ')[0]))
for (const color of ['70 190 220', '30 40 60', '0 0 0', '255 255 255']) {
  const { bottom, top } = spectrumGradientColors(color)
  assert(luminance(top) > luminance(bottom), 'The shared gradient is slightly lighter at the top')
  const contrast = luminance(top) - luminance(bottom)
  assert(contrast > 0.17 && contrast < 0.19, 'Keep the gradient visible without a harsh contrast')
  for (const channel of [...bottom.split(' '), ...top.split(' ')].map(Number)) {
    assert(Number.isInteger(channel) && channel >= 0 && channel <= 255)
  }
}
assert.deepEqual(spectrumGradientColors('invalid'), spectrumGradientColors('77 136 220'))
assert.match(chooseSpectrumColor(darkPalette, Number.NaN), /^\d+ \d+ \d+$/)
console.log('Spectrum cover hue selection and subtle vertical gradient passed')
