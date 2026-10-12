import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync('src/renderer/src/components/player/spectrumColor.ts', 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 }
})
const { chooseSpectrumColor } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
)

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
const luminance = (color) => {
  const [red, green, blue] = color.split(/\s+/).map(Number)
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255
}

assert.equal(
  chooseSpectrumColor({ primary: '240 180 120', secondary: '30 40 60', tertiary: '160 140 130' }, 0.8),
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
  chooseSpectrumColor({ primary: '240 210 170', secondary: '40 45 65', tertiary: '25 50 70' }, 0.15),
  '240 210 170'
)
console.log('Spectrum contrast selection passed')
