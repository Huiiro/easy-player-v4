import assert from 'node:assert/strict'
import { readFileSync, mkdirSync, mkdtempSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import Ajv from 'ajv'
import { build } from 'esbuild'

mkdirSync('build', { recursive: true })
const root = mkdtempSync(path.resolve('build/theme-contract-'))
const host = path.join(root, 'contract.cjs')
await build({
  stdin: {
    contents:
      "export {THEME_GLASS_TOKENS, THEME_BACKTOP_TOKENS, THEME_TOOLTIP_TOKENS} from './packages/plugin-sdk/src/themeGlass'; export * from './src/shared/themePlugins'; export * from './src/shared/themePackage'; export { parsePluginAuthor } from './src/shared/plugins'",
    resolveDir: process.cwd()
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: host
})
const require = createRequire(import.meta.url)
const {
  parsePluginThemeData,
  parsePluginThemeManifest,
  parsePluginAuthor,
  THEME_SLOTS,
  THEME_GLASS_TOKENS,
  THEME_BACKTOP_TOKENS,
  THEME_TOOLTIP_TOKENS
} = require(host)
const ajv = new Ajv({ allErrors: true, strict: true })
const schemas = ['theme-plugin-manifest.schema.json', 'theme.schema.json'].map((name) =>
  JSON.parse(readFileSync('packages/plugin-sdk/schemas/' + name, 'utf8'))
)
const [manifestValid, dataValid] = schemas.map((schema) => ajv.compile(schema))
const { manifest, data } = require('./theme-plugin-fixture.cjs')(path.join(root, 'nyan.epp'))
assert(manifestValid(manifest), ajv.errorsText(manifestValid.errors))
assert(dataValid(data), ajv.errorsText(dataValid.errors))
assert.deepEqual(structuredClone(parsePluginThemeData(data)).rules, data.rules)
const glass = {
  selectors: ['.ep-footer', '.ep-dialog-panel'],
  blur: 12,
  refraction: 24,
  saturation: 1.4
}
assert(dataValid({ ...data, glass }), ajv.errorsText(dataValid.errors))
assert.deepEqual(parsePluginThemeData({ ...data, glass }).glass, glass)
for (const override of [
  { selectors: [] },
  { selectors: ['body'] },
  { selectors: ['.ep-footer', '.ep-footer'] },
  { selectors: ['.ep-footer,body'] },
  { selectors: Array.from({ length: 17 }, (_, i) => '.ep-panel-' + i) },
  { blur: -1 },
  { blur: 25 },
  { refraction: 41 },
  { saturation: 0.9 },
  { blur: '12' },
  { url: 'https://example.test/filter.svg' },
  { refraction: null },
  { thickness: 3 },
  { thickness: 65 },
  { ior: 0.99 },
  { ior: 2.51 },
  { dispersion: -1 },
  { dispersion: 1.1 },
  { fresnel: 1.1 },
  { highlight: 2.1 },
  { shadow: -1 },
  { lightAngle: 361 },
  { interactive: 'true' }
]) {
  const invalid = { ...data, glass: { ...glass, ...override } }
  assert.equal(dataValid(invalid), false)
  assert.throws(() => parsePluginThemeData(invalid))
}
assert.throws(() => parsePluginThemeData({ ...data, glass: { ...glass, blur: NaN } }))
const completeGlass = {
  ...glass,
  thickness: 22,
  ior: 1.5,
  dispersion: 0.6,
  fresnel: 0.7,
  highlight: 1.1,
  lightAngle: 225,
  shadow: 0.3,
  interactive: true
}
assert(dataValid({ ...data, glass: completeGlass }))
assert.deepEqual(parsePluginThemeData({ ...data, glass: completeGlass }).glass, completeGlass)
assert.deepEqual(
  Object.keys(schemas[1].properties.assets.properties.slots.properties).sort(),
  Object.keys(THEME_SLOTS).sort()
)
for (const [slot, target] of Object.entries(THEME_SLOTS)) {
  const kinds = Object.keys(
    schemas[1].properties.assets.properties.slots.properties[slot].properties
  ).sort()
  assert.deepEqual(kinds, ['font', 'image'].filter((kind) => target[kind]).sort())
}
assert(dataValid({ ...data, accentColor: 'burlywood', background: 'burlywood' }))
assert.equal(parsePluginThemeData({ ...data, accentColor: 'burlywood' }).accentColor, 'burlywood')
for (const invalid of [
  { ...data, version: 2 },
  { ...data, renderer: { entry: '../background.js' } },
  { ...data, renderer: { entry: 'background.html' } },
  {
    ...data,
    renderer: { entry: 'background.js' },
    shader: { fragment: 'fragment.glsl', textures: [] }
  },
  { ...data, shader: { fragment: 'fragment.glsl', fps: 31, textures: [] } },
  { ...data, shader: { fragment: 'fragment.glsl', fps: 0, textures: [] } },
  {
    ...data,
    shader: {
      fragment: 'fragment.glsl',
      textures: [{ uniform: 'u_image', path: 'image.bin', width: 1, height: 1, format: 'image' }]
    }
  },
  {
    ...data,
    shader: {
      fragment: 'fragment.glsl',
      textures: [{ uniform: 'u_paths', path: 'image.png', width: 1, height: 1, format: 'rg32f' }]
    }
  },
  { ...data, tokens: { '--color-bg': 'url(https://example.test)' } },
  { ...data, tokens: { '--unknown-field': '#fff' } },
  { ...data, rules: { body: { color: 'red' } } },
  { ...data, rules: { '.ep-footer': { color: 'red!important' } } },
  { ...data, assets: { ...data.assets, slots: { appBackground: { font: 'cute' } } } },
  { ...data, assets: { ...data.assets, licenses: ['fonts/OFL.txt', 'fonts/OFL.txt'] } },
  { ...data, shader: { fragment: '../bad.glsl', textures: [] } },
  {
    ...data,
    shader: {
      fragment: 'fragment.glsl',
      textures: [{ uniform: 'u_time', path: 'paths.bin', width: 1, height: 1, format: 'rg32f' }]
    }
  }
]) {
  assert.equal(dataValid(invalid), false, 'Schema must reject an invalid authoring declaration')
  assert.throws(
    () => parsePluginThemeData(invalid),
    'Host must reject the same invalid declaration'
  )
}
for (const invalid of [
  { ...manifest, kind: 'source' },
  { ...manifest, apiVersion: 1 },
  { ...manifest, sources: [{}] }
])
  assert.equal(manifestValid(invalid), false)
assert.throws(() => parsePluginThemeManifest({ displayName: 'x'.repeat(121) }))
console.log(
  'Theme contract: SDK schemas, legacy slot parity, valid resources and invalid declaration parity passed'
)

const author = { name: 'Alice', url: 'https://example.test/alice' }
assert(manifestValid({ ...manifest, author }))
assert.deepEqual(parsePluginAuthor(author), author)
for (const author of [
  null,
  {},
  { name: '' },
  { name: 'x'.repeat(121) },
  { name: 'A\nB' },
  { name: 'Alice', url: 'javascript:alert(1)' }
]) {
  assert.equal(manifestValid({ ...manifest, author }), false)
  assert.throws(() => parsePluginAuthor(author))
}
assert.throws(() => parsePluginAuthor({ name: 'Alice', url: 'https://user:pass@example.test' }))

const imageTheme = {
  ...data,
  shader: {
    fragment: 'fragment.glsl',
    fps: 24,
    textures: [
      { uniform: 'u_image', path: 'images/bg.webp', width: 1672, height: 941, format: 'image' }
    ]
  }
}
assert(dataValid(imageTheme), ajv.errorsText(dataValid.errors))
assert.equal(parsePluginThemeData(imageTheme).shader.fps, 24)
assert.equal(parsePluginThemeData(imageTheme).shader.textures[0].format, 'image')

const officialRenderer = { ...data, renderer: { entry: 'background.js' } }
assert(dataValid(officialRenderer), ajv.errorsText(dataValid.errors))
assert.equal(parsePluginThemeData(officialRenderer).renderer.entry, 'background.js')

const componentTokens = Object.fromEntries(
  Object.entries({ ...THEME_GLASS_TOKENS, ...THEME_BACKTOP_TOKENS, ...THEME_TOOLTIP_TOKENS }).map(
    ([name, spec]) => [name, spec.value]
  )
)
assert(dataValid({ ...data, tokens: componentTokens }), ajv.errorsText(dataValid.errors))
assert.deepEqual(
  { ...parsePluginThemeData({ ...data, tokens: componentTokens }).tokens },
  componentTokens
)
assert.deepEqual(
  Object.keys(schemas[1].properties.tokens.properties).sort(),
  Object.keys(componentTokens).sort()
)
for (const [name, value] of Object.entries(componentTokens)) {
  assert.equal(schemas[1].properties.tokens.properties[name].default, value)
  assert.throws(() =>
    parsePluginThemeData({ ...data, tokens: { [name]: 'url(https://example.test/a.svg)' } })
  )
}
for (const selector of [
  '.ep-message',
  '.ep-color-trigger',
  '.ep-switch-track',
  '.ep-glass-panel',
  '.ep-backtop',
  '.ep-tooltip',
  '.ep-tooltip-trigger'
])
  assert.deepEqual(
    {
      ...parsePluginThemeData({ ...data, rules: { [selector]: { 'border-radius': '12px' } } })
        .rules[selector]
    },
    { 'border-radius': '12px' }
  )
