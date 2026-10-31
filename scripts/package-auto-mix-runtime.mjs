/* eslint-disable @typescript-eslint/explicit-function-return-type -- Plain JavaScript build runner. */
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import AdmZip from 'adm-zip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = path.join(root, 'build/auto-mix-runtime')
const output = path.join(root, 'dist')
const version = '1.0.0'
if (!(
  (process.platform === 'win32' && process.arch === 'x64') ||
  (process.platform === 'darwin' && process.arch === 'arm64')
))
  throw new Error('Auto Mix packaging supports Windows x64 and Mac ARM64 only')
const target = `${process.platform}-${process.arch}`
const asset = `easy-player-auto-mix-${target}-${version}.zip`
fs.mkdirSync(output, { recursive: true })
const zip = new AdmZip()
let unpackedSize = 0
for (const folder of ['python', 'models']) {
  const directory = path.join(source, folder)
  if (!fs.existsSync(directory)) throw new Error('Run npm run prepare:auto-mix first')
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else {
        if (entry.isSymbolicLink())
          throw new Error(`Materialize runtime symlinks before packaging: ${file}`)
        unpackedSize += fs.statSync(file).size
        zip.addLocalFile(file, path.relative(source, path.dirname(file)).replaceAll('\\', '/'))
      }
    }
  }
  walk(directory)
}
const component = Buffer.from(
  JSON.stringify({ formatVersion: 1, version, platform: process.platform, arch: process.arch })
)
unpackedSize += component.length
zip.addFile('component.json', component)
const archive = path.join(output, asset)
zip.writeZip(archive)
const sha256 = createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
const manifest = {
  formatVersion: 1,
  version,
  platform: process.platform,
  arch: process.arch,
  asset,
  sha256,
  size: fs.statSync(archive).size,
  unpackedSize
}
fs.writeFileSync(
  path.join(output, `easy-player-auto-mix-${target}.json`),
  JSON.stringify(manifest, null, 2)
)
console.log(
  JSON.stringify({
    ...manifest,
    downloadMiB: +(manifest.size / 1024 ** 2).toFixed(1),
    installedMiB: +(unpackedSize / 1024 ** 2).toFixed(1)
  })
)
