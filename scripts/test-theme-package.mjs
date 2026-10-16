/* eslint @typescript-eslint/explicit-function-return-type: off */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync, mkdtempSync, existsSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, relative } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import AdmZip from 'adm-zip'

const require = createRequire(import.meta.url)
const target = mkdtempSync(join(tmpdir(), 'ep-package-test-'))
const compile = (file) =>
  ts.transpileModule(readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true
    }
  }).outputText
const shared = {}
vm.runInNewContext(compile('src/shared/themePackage.ts'), { exports: shared })
const service = {}
vm.runInNewContext(compile('src/main/service/themePackageService.ts'), {
  exports: service,
  Uint8Array,
  Buffer,
  require: (id) =>
    id === '../utils/pathUtils'
      ? { getDataPath: () => target }
      : id === '../../shared/themePackage'
        ? shared
        : require(id)
})
const manifest = {
  version: 1,
  id: 'resource-test',
  theme: 'theme.json',
  resources: { wallpaper: { type: 'image', path: 'images/bg.png' } },
  slots: { appBackground: { image: 'wallpaper' }, dialog: { image: 'wallpaper' } },
  text: { appTitle: 'Theme title', homeWelcome: 'Hello <b>world</b>' }
}
const image = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
  'base64'
)
function zipOf(value = manifest, extras = []) {
  const zip = new AdmZip()
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(value)))
  zip.addFile(
    'theme.json',
    Buffer.from(JSON.stringify({ version: 1, name: 'Resource Test', tokens: {}, rules: {} }))
  )
  zip.addFile('images/bg.png', image)
  for (const [path, data] of extras) zip.addFile(path, data)
  return zip.toBuffer()
}
try {
  const imported = await service.importThemePackage(zipOf())
  assert.equal(imported.package.manifest.slots.dialog.image, 'wallpaper')
  const file = await service.resolveThemeResource(imported.package.id, 'images/bg.png')
  assert.deepEqual(readFileSync(file), image)
  await assert.rejects(service.resolveThemeResource(imported.package.id, 'theme.json'))
  await assert.rejects(service.resolveThemeResource(imported.package.id, '../theme.json'))
  const exported = await service.exportThemePackage(imported.package.id)
  const roundTrip = await service.importThemePackage(exported)
  assert.equal(roundTrip.package.manifest.text.appTitle, 'Theme title')
  assert.equal(JSON.parse(roundTrip.source).name, 'Resource Test')
  await service.removeThemePackage(imported.package.id)
  assert.equal(existsSync(join(target, 'themes', imported.package.id)), false)
  const count = readdirSync(join(target, 'themes')).length
  const demo = await service.importThemePackage(readFileSync('docs/themes/resource-demo.theme.zip'))
  assert.equal(demo.package.manifest.id, 'resource-demo')
  await service.removeThemePackage(demo.package.id)
  for (const invalid of [
    { ...manifest, slots: { global: { image: 'wallpaper' } } },
    { ...manifest, licenses: ['../OFL.txt'] },
    { ...manifest, licenses: ['images/code.js'] },
    { ...manifest, slots: { playbackThumb: { font: 'wallpaper' } } },
    { ...manifest, slots: { sidebar: { font: 'wallpaper' } } },
    { ...manifest, slots: { unknown: { image: 'wallpaper' } } },
    { ...manifest, resources: { wallpaper: { type: 'image', path: '../escape.png' } } },
    { ...manifest, resources: { wallpaper: { type: 'image', path: 'images/code.svg' } } },
    { ...manifest, text: { unknown: 'Hello' } }
  ])
    await assert.rejects(service.importThemePackage(zipOf(invalid)))
  await assert.rejects(service.importThemePackage(zipOf(manifest, [['code.js', Buffer.from('x')]])))
  const corrupted = new AdmZip(zipOf())
  corrupted.updateFile('images/bg.png', Buffer.from('not an image'))
  await assert.rejects(service.importThemePackage(corrupted.toBuffer()))
  assert.equal(
    readdirSync(join(target, 'themes')).length,
    count,
    'invalid packages leave no installed files'
  )
  await assert.rejects(service.removeThemePackage('../outside'))
  assert.throws(() =>
    shared.parseThemeManifest({
      ...manifest,
      resources: { f: { type: 'font', path: 'font.woff2' } },
      slots: { appBackground: { font: 'f' } }
    })
  )
  console.log(
    'Theme package import/export, resource resolution, slots, text, cleanup and invalid archives passed'
  )
} finally {
  const cleanup = resolve(target)
  assert.ok(relative(resolve(tmpdir()), cleanup).startsWith('ep-package-test-'))
  rmSync(cleanup, { recursive: true, force: true })
}
