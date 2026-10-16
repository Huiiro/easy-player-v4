/* eslint @typescript-eslint/explicit-function-return-type: off */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const shared = {}
vm.runInNewContext(
  ts.transpileModule(readFileSync('src/shared/themePackage.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText,
  { exports: shared }
)
const nodes = new Map()
const fonts = new Set()
const pendingFonts = []
class TestFontFace {
  constructor(family, source) {
    this.family = family
    this.source = source
  }
  load() {
    return new Promise((resolve) => pendingFonts.push(() => resolve(this)))
  }
}
const exports = {}
vm.runInNewContext(
  ts.transpileModule(readFileSync('src/renderer/src/services/customTheme.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText,
  {
    exports,
    require: () => shared,
    FontFace: TestFontFace,
    TextEncoder,
    CSS: { supports: (property) => property !== 'invalid-property' },
    document: {
      fonts: { add: (face) => fonts.add(face), delete: (face) => fonts.delete(face) },
      getElementById: (id) => nodes.get(id),
      createElement: () => ({
        remove() {
          nodes.delete(this.id)
        }
      }),
      head: { append: (node) => nodes.set(node.id, node) }
    }
  }
)
const { parseCustomTheme, applyCustomTheme, customThemeCSS } = exports
const valid = {
  version: 1,
  name: ' Test ',
  tokens: { '--ep-button-radius': '12px' },
  rules: { '.ep-button:hover': { color: 'red' } }
}
const parsed = parseCustomTheme(JSON.stringify(valid))
assert.equal(parsed.name, 'Test')
assert.equal(parsed.background, 'replace')
assert.equal(
  parseCustomTheme(JSON.stringify({ ...valid, background: 'inherit' })).background,
  'inherit'
)
assert.match(customThemeCSS(parsed), /--ep-button-radius:12px !important/)
applyCustomTheme(parsed)
assert.match(nodes.get('ep-custom-theme').textContent, /\.ep-button:hover\{color:red\}/)
applyCustomTheme(parseCustomTheme(JSON.stringify({ version: 1, name: 'Other', tokens: {} })))
assert.equal(nodes.size, 1)
assert.doesNotMatch(nodes.get('ep-custom-theme').textContent, /12px|color:red/)
applyCustomTheme(null)
assert.equal(nodes.size, 0)
for (const data of [
  { ...valid, version: 2 },
  { ...valid, background: 'unknown' },
  { ...valid, name: '' },
  { ...valid, tokens: [] },
  { ...valid, tokens: { '--color-primary': 'red;}body{display:none' } },
  { ...valid, tokens: { '--color-bg': 'url(https://example.com)' } },
  { ...valid, tokens: { '--color-bg': 'u\\72l(x)' } },
  { ...valid, rules: { body: { color: 'red' } } },
  { ...valid, rules: { '.ep-button,body': { color: 'red' } } },
  { ...valid, rules: { '.ep-button': { 'invalid-property': 'x' } } },
  { ...valid, rules: { '.ep-button': { color: 'red !important' } } }
])
  assert.throws(() => parseCustomTheme(JSON.stringify(data)))
assert.throws(() => parseCustomTheme('{'))
assert.throws(() => parseCustomTheme(' '.repeat(128 * 1024 + 1)))
const packageTheme = parseCustomTheme(
  JSON.stringify({
    ...valid,
    package: {
      id: '12345678-1234-1234-1234-123456789abc',
      manifest: {
        version: 1,
        id: 'font-test',
        theme: 'theme.json',
        resources: {
          body: { type: 'font', path: 'fonts/body.woff2' },
          wall: { type: 'image', path: 'images/wall.png' }
        },
        slots: { global: { font: 'body' }, sidebar: { image: 'wall' } },
        text: { appTitle: 'Test' }
      }
    }
  })
)
assert.match(customThemeCSS(packageTheme), /easy-player-media:\/\/theme\/12345678/)
assert.match(customThemeCSS(packageTheme), /\.ep-sidebar\{background-image:url/)
applyCustomTheme(packageTheme)
applyCustomTheme(null)
pendingFonts.shift()()
await Promise.resolve()
assert.equal(fonts.size, 0, 'stale async fonts must not attach after switching')
applyCustomTheme(packageTheme)
pendingFonts.shift()()
await Promise.resolve()
assert.equal(fonts.size, 1, 'current theme font attached')
applyCustomTheme(null)
assert.equal(fonts.size, 0, 'font removed on deactivation')
console.log('Custom theme validation, switching and cleanup passed')
