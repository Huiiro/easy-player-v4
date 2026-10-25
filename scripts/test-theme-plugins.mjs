/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, renameSync, rmdirSync } from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'

mkdirSync('build', { recursive: true })
const root = mkdtempSync(path.resolve('build/theme-plugin-test-'))
const bundle = path.join(root, 'host.cjs')
await build({
  stdin: {
    contents: `export * from './src/main/plugins/packages'; export * from './src/main/plugins/manager'; export * from './src/main/sources/registry'`,
    resolveDir: process.cwd()
  },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  outfile: bundle
})
const { OfficialPluginPackages, PluginManager, SourceRegistry } = createRequire(import.meta.url)(
  bundle
)
const catalog = JSON.parse(readFileSync('resources/plugins/catalog.json', 'utf8'))
const settings = new Map()
function instance(directory = path.join(root, 'installed')) {
  const manager = new PluginManager(new SourceRegistry(), {
    readSetting: (key) => settings.get(key),
    writeSetting: (key, value) => settings.set(key, value),
    fetch: () => assert.fail('Unexpected network'),
    log() {}
  })
  const packages = new OfficialPluginPackages(directory, manager, {}, catalog)
  packages.initialize()
  return { manager, packages, directory }
}
const theme = {
  version: 1,
  colorMode: 'dark',
  accentColor: '#a5b4fc',
  headerBackground: '#14152b',
  footerBackground: '#101122',
  chromeBorder: '#34365a',
  background: '#0d0e1c',
  tokens: { '--color-bg': '#101122', '--color-text': '#edf0ff' }
}
const manifest = {
  id: 'example.midnight',
  displayName: 'Midnight',
  version: '1.0.0',
  apiVersion: 2,
  sources: [],
  kind: 'theme',
  theme: { displayName: 'Midnight' }
}
function archive(manifestValue = manifest, data = theme, files = {}) {
  const zip = new AdmZip()
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifestValue)))
  zip.addFile('theme.json', Buffer.from(JSON.stringify(data)))
  for (const [name, bytes] of Object.entries(files)) zip.addFile(name, Buffer.from(bytes))
  const filename = path.join(root, 'theme.epp')
  writeFileSync(filename, zip.toBuffer())
  return filename
}
const app = instance()
assert.equal(app.packages.listThemes().length, 0)
await app.packages.installFile(archive(), () => true)
assert.equal(app.manager.get(manifest.id).origin, 'third-party')
assert.equal(app.packages.listThemes()[0].data.tokens['--color-bg'], '#101122')
const restored = instance(app.directory)
assert.equal(restored.manager.get(manifest.id).state, 'inactive')
restored.manager.activate(manifest.id)
assert.equal(
  restored.packages.listThemes().length,
  1,
  'local theme restores without a catalog entry'
)
restored.manager.deactivate(manifest.id)
assert.equal(restored.packages.listThemes().length, 0)
restored.manager.activate(manifest.id)
const next = { ...manifest, version: '1.1.0' }
await restored.packages.installFile(archive(next, { ...theme, background: '#101020' }), () => false)
assert.equal(
  restored.manager.get(manifest.id).enabled,
  false,
  'update preserves disabled preference'
)
restored.manager.activate(manifest.id)
await assert.rejects(
  restored.packages.installFile(archive(), () => true),
  /pluginDowngrade/
)
for (const [badManifest, badTheme, files] of [
  [{ ...next, id: 'builtin.spoof' }, theme, {}],
  [next, { ...theme, background: 'url(secret)' }, {}],
  [next, { ...theme, tokens: { '--color-bg': 'url(https://example.test)' } }, {}],
  [next, theme, { 'index.cjs': 'globalThis.exploited = true' }],
  [next, { ...theme, shader: { fragment: '../escape.glsl', textures: [] } }, {}],
  [
    next,
    {
      ...theme,
      shader: {
        fragment: 'fragment.glsl',
        textures: [
          { uniform: 'u_paths', width: 2049, height: 1, format: 'rg32f', path: 'paths.bin' }
        ]
      }
    },
    { 'fragment.glsl': '#version 300 es' }
  ],
  [
    { ...next, sources: [{ id: 'evil', displayName: 'Evil', capabilities: ['lyrics'] }] },
    theme,
    {}
  ],
  [next, theme, { 'THEME.json': '{}' }],
  [next, theme, { 'ignored.html': '<script>globalThis.exploited=true</script>' }]
]) {
  await assert.rejects(
    restored.packages.installFile(archive(badManifest, badTheme, files), () => true)
  )
  assert.equal(
    restored.manager.get(manifest.id).version,
    '1.1.0',
    'invalid replacement leaves the running theme intact'
  )
  assert.equal(restored.packages.listThemes().length, 1)
}
assert.equal(globalThis.exploited, undefined, 'theme JavaScript is never evaluated')
const duplicateNames = instance(path.join(root, 'same-name'))
const alice = {
  ...manifest,
  id: 'alice.midnight',
  author: { name: 'Alice', url: 'https://example.test/alice' }
}
const bob = { ...manifest, id: 'bob.midnight', author: { name: 'Bob' } }
await duplicateNames.packages.installFile(archive(alice), () => true)
await duplicateNames.packages.installFile(archive(bob), () => true)
assert.equal(
  duplicateNames.packages.listThemes().length,
  2,
  'same display names with different IDs coexist'
)
assert.deepEqual(duplicateNames.manager.get(alice.id).author, alice.author)
assert.deepEqual(
  duplicateNames.packages.listThemes().find((theme) => theme.pluginId === bob.id).author,
  bob.author
)
const duplicateRestart = instance(duplicateNames.directory)
for (const plugin of [alice, bob]) duplicateRestart.manager.activate(plugin.id)
assert.deepEqual(
  duplicateRestart.manager.get(alice.id).author,
  alice.author,
  'author survives restart'
)
await duplicateRestart.packages.installFile(
  archive({
    ...alice,
    version: '1.0.1',
    displayName: 'Renamed',
    author: { name: 'Alice Updated' }
  }),
  () => true
)
assert.equal(
  duplicateRestart.packages.listThemes().length,
  2,
  'same ID updates without creating a new plugin'
)
assert.equal(duplicateRestart.manager.get(alice.id).author.name, 'Alice Updated')
assert.equal(duplicateRestart.manager.get(bob.id).version, '1.0.0')
for (const author of [null, {}, { name: '' }, { name: 'Alice', url: 'javascript:alert(1)' }])
  await assert.rejects(
    duplicateRestart.packages.installFile(
      archive({ ...alice, author, version: '1.0.2' }),
      () => true
    )
  )
const blackhole = catalog.plugins.find((entry) => entry.id === 'builtin.theme.blackhole')
assert(blackhole)
const blackholeBytes = readFileSync(
  path.join('build/plugins', new URL(blackhole.url).pathname.split('/').at(-1))
)
const oldCatalogDirectory = path.join(root, 'old-catalog')
mkdirSync(oldCatalogDirectory)
writeFileSync(
  path.join(oldCatalogDirectory, 'catalog.json'),
  JSON.stringify({
    schemaVersion: 1,
    plugins: catalog.plugins.filter((entry) => entry.kind !== 'theme')
  })
)
const offlineUpgrade = instance(oldCatalogDirectory)
assert.equal(
  offlineUpgrade.packages.listCatalog().some((entry) => entry.kind === 'theme'),
  false
)
const localBlackhole = path.join(root, 'blackhole.epp')
writeFileSync(localBlackhole, blackholeBytes)
await offlineUpgrade.packages.installFile(localBlackhole, () => true)
assert.equal(
  offlineUpgrade.manager.get(blackhole.id).origin,
  'official',
  'pinned official theme imports even with an older cached index'
)
assert.equal(offlineUpgrade.packages.listThemes().length, 1)
await restored.packages.install(blackhole.id, true, blackholeBytes)
const installed = restored.packages.listThemes().find((theme) => theme.pluginId === blackhole.id)
assert(installed.fragmentShader.startsWith('#version 300 es'))
assert.equal(installed.textures.length, 2)
const url = new URL(installed.textures[0].url)
const [, id, hash, ...parts] = url.pathname.split('/')
const bytes = restored.packages.themeResource(id, hash, parts.join('/'))
assert.equal(bytes.length, installed.textures[0].width * installed.textures[0].height * 8)
assert.equal(restored.packages.themeResource(id, hash, '../package.epp'), undefined)
restored.manager.deactivate(id)
assert.equal(
  restored.packages.themeResource(id, hash, parts.join('/')),
  undefined,
  'disabled themes cannot serve resources'
)
restored.manager.activate(id)
restored.packages.uninstall(id)
assert.equal(restored.packages.themeResource(id, hash, parts.join('/')), undefined)
restored.packages.uninstall(manifest.id)
assert.equal(instance(restored.directory).manager.list().length, 0)
const rainyEntry = catalog.plugins.find((entry) => entry.id === 'builtin.theme.rainy')
const rainyFile = path.join('build/plugins', new URL(rainyEntry.url).pathname.split('/').at(-1))
const rainy = instance(path.join(root, 'rainy-installed'))
await rainy.packages.installFile(rainyFile, () => true)
const rainyDto = rainy.packages.listThemes()[0]
assert.equal(rainyDto.data.shader.fps, 24)
assert.equal(rainyDto.data.shader.textures[0].format, 'image')
const street = rainy.packages.themeResource(
  rainyDto.pluginId,
  rainyDto.revision,
  'images/rainy-night-cool.webp'
)
assert(street.length > 100000)
assert.equal(street.subarray(8, 12).toString(), 'WEBP')
const rainyRestart = instance(rainy.directory)
rainyRestart.manager.activate(rainyEntry.id)
assert.equal(rainyRestart.packages.listThemes()[0].revision, rainyDto.revision)
const rainyZip = new AdmZip(readFileSync(rainyFile))
assert(rainyZip.readAsText('licenses/NOTICE.txt').includes('Heartfelt'))
const rainyFiles = Object.fromEntries(
  rainyZip
    .getEntries()
    .filter((entry) => !['manifest.json', 'theme.json'].includes(entry.entryName))
    .map((entry) => [entry.entryName, entry.getData()])
)
const localRainy = { ...rainyEntry, id: 'example.rainy', version: '1.0.0' }
await assert.rejects(
  rainy.packages.installFile(
    archive(localRainy, rainyDto.data, {
      ...rainyFiles,
      'images/rainy-night-cool.webp': Buffer.from('not an image')
    }),
    () => true
  )
)
await assert.rejects(
  rainy.packages.installFile(
    archive(
      localRainy,
      rainyDto.data,
      Object.fromEntries(
        Object.entries(rainyFiles).filter(([name]) => name !== 'images/rainy-night-cool.webp')
      )
    ),
    () => true
  )
)
rainy.manager.deactivate(rainyEntry.id)
assert.equal(
  rainy.packages.themeResource(
    rainyDto.pluginId,
    rainyDto.revision,
    'images/rainy-night-cool.webp'
  ),
  undefined
)
rainy.manager.activate(rainyEntry.id)
rainy.packages.uninstall(rainyEntry.id)
assert.equal(
  rainy.packages.themeResource(
    rainyDto.pluginId,
    rainyDto.revision,
    'images/rainy-night-cool.webp'
  ),
  undefined
)
const renderers = catalog.plugins.filter(
  (entry) =>
    entry.kind === 'theme' && !['builtin.theme.blackhole', 'builtin.theme.rainy'].includes(entry.id)
)
assert.equal(renderers.length, 8)
const officialScenes = instance(path.join(root, 'official-scenes'))
for (const entry of renderers) {
  const filename = path.join('build/plugins', new URL(entry.url).pathname.split('/').at(-1))
  const bytes = readFileSync(filename)
  await officialScenes.packages.installFile(filename, () => true)
  const dto = officialScenes.packages.listThemes().find((theme) => theme.pluginId === entry.id)
  assert(dto.rendererUrl.endsWith('/__frame.html'))
  const shell = officialScenes.packages
    .themeResource(entry.id, dto.revision, '__frame.html')
    .toString()
  assert(shell.includes("connect-src 'none'"))
  assert(
    shell.includes(
      'script-src easy-player-media://plugin-theme/' +
        entry.id +
        '/' +
        dto.revision +
        '/background.js'
    )
  )
  assert(
    officialScenes.packages.themeResource(entry.id, dto.revision, 'background.js').length > 20000
  )
  const zip = new AdmZip(bytes)
  const files = Object.fromEntries(
    zip
      .getEntries()
      .filter((entry) => !['manifest.json', 'theme.json'].includes(entry.entryName))
      .map((entry) => [entry.entryName, entry.getData()])
  )
  await assert.rejects(
    officialScenes.packages.installFile(
      archive({ ...entry, id: 'thirdparty.' + entry.id.split('.').at(-1) }, dto.data, files),
      () => true
    ),
    'untrusted renderer code must be rejected even if it came from an official template'
  )
  await assert.rejects(
    officialScenes.packages.installFile(
      archive({ ...entry, version: '1.0.1' }, dto.data, files),
      () => true
    ),
    'reserved IDs cannot replace official themes with an unindexed archive'
  )
  assert.equal(officialScenes.manager.get(entry.id).version, '1.0.0')
  officialScenes.manager.deactivate(entry.id)
  assert.equal(
    officialScenes.packages.themeResource(entry.id, dto.revision, '__frame.html'),
    undefined
  )
  assert.equal(
    officialScenes.packages.themeResource(entry.id, dto.revision, 'background.js'),
    undefined
  )
  officialScenes.manager.activate(entry.id)
}
const scenesRestart = instance(officialScenes.directory)
for (const entry of renderers) scenesRestart.manager.activate(entry.id)
assert.equal(
  scenesRestart.packages.listThemes().length,
  8,
  'all official renderers restore without code execution in the main process'
)
for (const entry of renderers) {
  const dto = officialScenes.packages.listThemes().find((theme) => theme.pluginId === entry.id)
  officialScenes.packages.uninstall(entry.id)
  assert.equal(
    officialScenes.packages.themeResource(entry.id, dto.revision, 'background.js'),
    undefined
  )
}
const nyan = instance(path.join(root, 'nyan-installed'))
const fixtureFile = path.join(root, 'nyan.epp')
const fixture = createRequire(import.meta.url)('./theme-plugin-fixture.cjs')(fixtureFile)
await nyan.packages.installFile(fixtureFile, () => true)
const restoredNyan = instance(nyan.directory)
restoredNyan.manager.activate(fixture.manifest.id)
const dto = restoredNyan.packages.listThemes()[0]
assert.deepEqual(dto.data.tokens, fixture.data.tokens)
assert.deepEqual(dto.data.rules, fixture.data.rules)
assert.deepEqual(dto.data.assets.text, fixture.data.assets.text)
const sourceZip = new AdmZip(readFileSync(fixtureFile))
assert.deepEqual(sourceZip.readFile('fonts/OFL.txt'), fixture.files['fonts/OFL.txt'])
for (const resource of Object.values(dto.data.assets.resources))
  assert.deepEqual(
    restoredNyan.packages.themeResource(dto.pluginId, dto.revision, resource.path),
    fixture.files[resource.path]
  )
assert.equal(
  restoredNyan.packages.themeResource(dto.pluginId, dto.revision, 'fonts/OFL.txt'),
  undefined,
  'licenses are retained in the package, not exposed as runtime resources'
)
assert.equal(
  restoredNyan.packages.themeResource(dto.pluginId, 'old-revision', 'images/nyan-cat.png'),
  undefined
)
for (const [data, files] of [
  [{ ...fixture.data, rules: { body: { color: 'red' } } }, fixture.files],
  [
    { ...fixture.data, rules: { '.ep-footer': { background: 'url(https://example.test)' } } },
    fixture.files
  ],
  [
    {
      ...fixture.data,
      assets: { ...fixture.data.assets, slots: { playbackThumb: { image: 'cute' } } }
    },
    fixture.files
  ],
  [
    {
      ...fixture.data,
      assets: {
        ...fixture.data.assets,
        resources: { vector: { type: 'image', path: 'cat.svg' } },
        slots: {}
      }
    },
    { 'cat.svg': '<svg/>' }
  ],
  [fixture.data, { ...fixture.files, 'fonts/kuaile.ttf': Buffer.from('not-a-font') }],
  [fixture.data, { ...fixture.files, 'images/starfield.png': Buffer.from('not-an-image') }],
  [
    fixture.data,
    Object.fromEntries(Object.entries(fixture.files).filter(([name]) => name !== 'fonts/OFL.txt'))
  ]
]) {
  await assert.rejects(
    restoredNyan.packages.installFile(
      archive({ ...fixture.manifest, version: '1.1.0' }, data, files),
      () => true
    )
  )
  assert.equal(
    restoredNyan.packages.listThemes()[0].version,
    '1.0.0',
    'invalid updates retain the active theme'
  )
}
// A validated replacement must roll back when its startup pointer cannot be committed.
const pointer = path.join(restoredNyan.directory, dto.pluginId, 'current.json')
renameSync(pointer, pointer + '.saved')
mkdirSync(pointer)
try {
  await assert.rejects(
    restoredNyan.packages.installFile(
      archive(
        { ...fixture.manifest, version: '1.1.0' },
        { ...fixture.data, background: '#111122' },
        fixture.files
      ),
      () => true
    )
  )
  assert.equal(restoredNyan.packages.listThemes()[0].revision, dto.revision)
  assert.equal(restoredNyan.manager.get(dto.pluginId).state, 'active')
  assert.equal(restoredNyan.packages.isBusy(dto.pluginId), false)
  assert.deepEqual(
    restoredNyan.packages.themeResource(dto.pluginId, dto.revision, 'images/nyan-cat.png'),
    fixture.files['images/nyan-cat.png']
  )
} finally {
  rmdirSync(pointer)
  renameSync(pointer + '.saved', pointer)
}
const afterRollback = instance(restoredNyan.directory)
afterRollback.manager.activate(dto.pluginId)
assert.equal(
  afterRollback.packages.listThemes()[0].revision,
  dto.revision,
  'failed commit preserves the theme across restart'
)
restoredNyan.manager.deactivate(dto.pluginId)
assert.equal(
  restoredNyan.packages.themeResource(dto.pluginId, dto.revision, 'fonts/kuaile.ttf'),
  undefined
)
restoredNyan.manager.activate(dto.pluginId)
restoredNyan.packages.uninstall(dto.pluginId)
assert.equal(
  restoredNyan.packages.themeResource(dto.pluginId, dto.revision, 'images/nyan-cat.png'),
  undefined
)
console.log(
  'Theme plugins: third-party install/update/restart, lifecycle, downgrade, malformed/code rejection, official Black Hole and gated resources passed'
)
