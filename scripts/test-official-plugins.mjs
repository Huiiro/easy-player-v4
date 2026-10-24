/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-empty-function */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import AdmZip from 'adm-zip'

mkdirSync('build', { recursive: true })
const directory = mkdtempSync(path.resolve('build/official-plugins-test-'))
const hostFile = path.join(directory, 'host.cjs')
await build({
  stdin: {
    contents: `export * from './src/main/plugins/packages'; export * from './src/main/plugins/manager'; export * from './src/main/plugins/runtime'; export * from './src/main/sources/registry'; export * from './src/shared/plugins'`,
    resolveDir: process.cwd()
  },
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  bundle: true,
  packages: 'external',
  outfile: hostFile
})
const require = createRequire(import.meta.url)
const {
  OfficialPluginPackages,
  SourceRegistry,
  PluginManager,
  validateCatalog,
  getPluginManager,
  getSourceRegistry,
  comparePluginVersions
} = require(hostFile)
for (const [a, b] of [
  ['1.10.0', '1.2.0'],
  ['1.0.0', '1.0.0-rc.1'],
  ['1.0.0-beta.11', '1.0.0-beta.2'],
  ['1.0.0-beta', '1.0.0-1']
]) {
  assert.equal(comparePluginVersions(a, b), 1)
  assert.equal(comparePluginVersions(b, a), -1)
  assert.equal(comparePluginVersions(a, a), 0)
}
assert.equal(getPluginManager().list().length, 0, 'fresh application has no installed plugins')
assert.equal(
  getSourceRegistry().list().length,
  0,
  'fresh application has no source implementations'
)
const seed = JSON.parse(readFileSync('plugins/catalog.json', 'utf8'))
const plain = (value) => JSON.parse(JSON.stringify(value))
let transport
const host = {
  readSetting() {
    return null
  },
  writeSetting() {},
  log() {},
  fetch: (...args) => transport(...args)
}
const bridge = {
  t: (key) => key,
  isPlaybackOnly: () => false,
  requireBackgroundWork() {},
  backgroundRequest() {
    throw new Error('Unexpected HTTP request')
  },
  fetchMediaImage() {
    throw new Error('Unexpected image request')
  },
  runYtDlp: async () =>
    JSON.stringify({ id: 'fixture', title: 'Title', webpage_url: 'https://youtu.be/fixture' })
}
const responses = new Map(
  seed.plugins.map((entry) => [
    entry.url,
    readFileSync(path.join('build/plugins', new URL(entry.url).pathname.split('/').at(-1)))
  ])
)
let calls = 0
const fetcher = async (url) => {
  calls++
  if (responses.has(url)) return new Response(responses.get(url))
  if (url.endsWith('catalog.json')) return new Response(JSON.stringify(seed))
  throw new Error('Unexpected request: ' + url)
}
function instance(root = path.join(directory, 'installed'), catalog = seed, fetch = fetcher) {
  const registry = new SourceRegistry()
  const manager = new PluginManager(registry, host)
  const errors = []
  const packages = new OfficialPluginPackages(root, manager, bridge, catalog, fetch, (id) =>
    errors.push(id)
  )
  return { registry, manager, packages, errors, root }
}
const app = instance()
app.packages.initialize()
assert.equal(calls, 0, 'startup never contacts GitHub or installs a source')
assert.equal(app.packages.listCatalog().length, 5)
for (const entry of seed.plugins) await app.packages.install(entry.id, true)
assert.equal(app.manager.list().length, 5)
assert.equal(app.registry.list().length, 5)
assert(app.manager.list().every((entry) => entry.origin === 'official'))
transport = async (_url, init) => {
  assert.equal(JSON.parse(init.body).req_1.method, 'DoSearchForQQMusicDesktop')
  return new Response(
    JSON.stringify({ code: 0, req_1: { code: 0, data: { body: { song: { list: [] } } } } })
  )
}
assert.equal(
  (
    await app.registry.get('qqmusic').metadata.search('Title', {
      signal: new AbortController().signal,
      deadline: Date.now() + 10000,
      operation: 'metadata.search',
      host: app.registry.ownerOf('qqmusic').host
    })
  ).length,
  0,
  'installed QQ package uses host transport'
)
assert.equal((await app.registry.get('youtube').download.search('Title'))[0].id, 'fixture')
await assert.rejects(app.registry.get('netease').metadata.get('../invalid'))
await assert.rejects(app.registry.get('kugou').metadata.get('../invalid'))
const restart = instance(app.root)
restart.packages.initialize()
restart.packages.initialize()
assert.equal(restart.manager.list().length, 5, 'installed archives are restored once on restart')
assert.equal(restart.errors.length, 0)
for (const entry of restart.manager.list()) restart.manager.activate(entry.id)
assert.equal(restart.registry.list().length, 5)
await restart.packages.refreshCatalog()
const original = seed.plugins.find((entry) => entry.id === 'builtin.qqmusic')
const damaged = Buffer.from(responses.get(original.url))
damaged[damaged.length - 1] ^= 1
await assert.rejects(restart.packages.install(original.id, true, damaged), /pluginPackageIntegrity/)
assert.equal(restart.registry.isEnabled('qqmusic'), true, 'bad update leaves running plugin intact')
await assert.rejects(restart.packages.install('../escape', true), /pluginUnknown/)
for (const altered of [
  { ...original, url: 'https://example.com/plugin.epp' },
  { ...original, url: original.url + '?redirect=1' },
  { ...original, sha256: 'bad' },
  { ...original, size: 999999999 },
  { ...original, apiVersion: 2 }
])
  assert.throws(() => validateCatalog({ schemaVersion: 1, plugins: [altered] }))

// A catalog-approved test archive exercises transaction rollback after activation.
function synthetic(version, activate, extra) {
  const manifest = {
    id: 'builtin.qqmusic',
    displayName: 'Fixture',
    version,
    apiVersion: 1,
    sources: []
  }
  const zip = new AdmZip()
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)))
  zip.addFile(
    'index.cjs',
    Buffer.from(
      `exports.createPlugin=()=>({manifest:${JSON.stringify(manifest)},activate(){${activate}}})`
    )
  )
  if (extra) zip.addFile(extra, Buffer.from('unsafe'))
  const bytes = zip.toBuffer()
  return {
    bytes,
    entry: {
      ...manifest,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      url: original.url
    }
  }
}
const failing = synthetic('2.0.0', 'throw new Error("activation failed")')
// Load the previous installation into the transactional store using a separate manager.
const rollback = instance(path.join(directory, 'rollback'), seed)
rollback.packages.initialize()
await rollback.packages.install(original.id, true)
const refreshed = { schemaVersion: 1, plugins: [failing.entry] }
const rollback2 = instance(rollback.root, seed, async (url) =>
  url.endsWith('catalog.json')
    ? new Response(JSON.stringify(refreshed))
    : new Response(failing.bytes)
)
rollback2.packages.initialize()
rollback2.manager.activate(original.id)
await rollback2.packages.refreshCatalog()
await assert.rejects(rollback2.packages.install(original.id, true), /ACTIVATION_FAILED/)
assert.equal(rollback2.manager.get(original.id).version, original.version)
assert.equal(rollback2.registry.isEnabled('qqmusic'), true)
const afterFailure = instance(rollback.root)
afterFailure.packages.initialize()
assert.equal(
  afterFailure.manager.get(original.id).version,
  original.version,
  'failed update keeps startup pointer'
)
const older = instance(
  rollback.root,
  seed,
  async () =>
    new Response(JSON.stringify({ schemaVersion: 1, plugins: [{ ...original, version: '0.9.0' }] }))
)
older.packages.initialize()
await older.packages.refreshCatalog()
await assert.rejects(older.packages.install(original.id, true), /pluginDowngrade/)

const disabled = instance(path.join(directory, 'disabled'))
disabled.packages.initialize()
await disabled.packages.install(original.id, false)
assert.equal(
  disabled.manager.get(original.id).state,
  'inactive',
  'installation preserves saved disable preference'
)
disabled.packages.uninstall(original.id)
assert.equal(disabled.manager.list().length, 0)
const removed = instance(disabled.root)
removed.packages.initialize()
assert.equal(removed.manager.list().length, 0, 'uninstall survives restart')
const localFile = path.join(directory, 'official.epp')
writeFileSync(localFile, responses.get(original.url))
await removed.packages.installFile(localFile, () => true)
assert.equal(removed.registry.isEnabled('qqmusic'), true, 'local import matches official catalog')
writeFileSync(localFile, Buffer.from('untrusted'))
await assert.rejects(
  removed.packages.installFile(localFile, () => true),
  /pluginPackageIntegrity/
)
// Corrupt one installed archive: other packages must still restore.
writeFileSync(path.join(app.root, original.id, original.sha256, 'package.epp'), 'damaged')
const partial = instance(app.root)
partial.packages.initialize()
assert.equal(partial.manager.list().length, 4)
assert.deepEqual(partial.errors, [original.id])
const failedFetch = instance(
  path.join(directory, 'offline'),
  seed,
  async () => new Response('unavailable', { status: 503 })
)
await assert.rejects(failedFetch.packages.refreshCatalog(), /pluginDownloadFailed/)
assert.equal(
  failedFetch.packages.listCatalog().length,
  5,
  'refresh failure preserves cached catalog'
)
assert.deepEqual(plain(validateCatalog(seed)), seed)
console.log(
  'Official plugins: empty startup, five standalone archives, host calls, local import, integrity, restart, update rollback, uninstall, corruption isolation and offline catalog passed'
)
