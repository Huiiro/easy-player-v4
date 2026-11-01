/* eslint-disable @typescript-eslint/explicit-function-return-type */
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { spawnSync, execFile } from 'node:child_process'
import { promisify } from 'node:util'
import AdmZip from 'adm-zip'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const release = JSON.parse(
  await fs.readFile(path.join(root, 'resources/lib/fpcalc-release.json'), 'utf8')
)
const targetKey = `${process.platform}-${process.arch}`
const target = release.targets[targetKey]
if (!target) throw new Error(`Unsupported fingerprint tool platform: ${targetKey}`)
const directory = path.join(root, 'resources/lib/fpcalc', targetKey)
const executable = process.platform === 'win32' ? 'fpcalc.exe' : 'fpcalc'
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
await fs.mkdir(directory, { recursive: true })
await fs.copyFile(
  path.join(root, 'resources/lib/fpcalc-LICENSE.md'),
  path.join(directory, 'LICENSE.md')
)
await fs.copyFile(
  path.join(root, 'resources/lib/fpcalc-LGPL-2.1.txt'),
  path.join(directory, 'LGPL-2.1.txt')
)
await fs.writeFile(
  path.join(directory, 'SOURCES.txt'),
  `Chromaprint ${release.version}: https://github.com/acoustid/chromaprint/tree/v${release.version}\nOfficial fpcalc builds include FFmpeg decoding: https://ffmpeg.org/download.html\nRelease information: https://github.com/acoustid/chromaprint/releases/tag/v${release.version}\n`
)
try {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'))
  if (
    manifest.version === release.version &&
    manifest.archiveSha256 === target.sha256 &&
    digest(await fs.readFile(path.join(directory, executable))) === manifest.executableSha256
  ) {
    console.log(`Chromaprint ${release.version}: verified cached ${targetKey} tool`)
    process.exit(0)
  }
} catch {
  /* Prepare an absent or changed component. */
}
const name = `chromaprint-fpcalc-${release.version}-${target.asset}`
const downloadDirectory = path.join(root, 'build/fpcalc-downloads')
const downloadPath = path.join(downloadDirectory, name)
await fs.mkdir(downloadDirectory, { recursive: true })
let bytes
try {
  bytes = await fs.readFile(downloadPath)
} catch {
  /* No cached archive. */
}
if (!bytes || digest(bytes) !== target.sha256) {
  const url = `https://github.com/acoustid/chromaprint/releases/download/v${release.version}/${name}`
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
    if (!response.ok) throw new Error(`Chromaprint download failed: ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
  } catch {
    // Use the OS TLS/proxy configuration when Node's direct connection is unavailable.
    await promisify(execFile)(
      process.platform === 'win32' ? 'curl.exe' : 'curl',
      [
        '--fail',
        '--location',
        '--connect-timeout',
        '15',
        '--max-time',
        '60',
        '--output',
        downloadPath,
        url
      ],
      { windowsHide: true, timeout: 65_000 }
    )
    bytes = await fs.readFile(downloadPath)
  }
}
if (digest(bytes) !== target.sha256) throw new Error('Chromaprint archive SHA-256 mismatch')
await fs.writeFile(downloadPath, bytes)
await fs.mkdir(path.join(root, 'build'), { recursive: true })
const staging = await fs.mkdtemp(path.join(root, 'build/fpcalc-'))
if (
  path.dirname(staging) !== path.join(root, 'build') ||
  !path.basename(staging).startsWith('fpcalc-')
)
  throw new Error('Invalid fingerprint staging path')
try {
  const archive = path.join(staging, name)
  await fs.writeFile(archive, bytes)
  if (target.asset.endsWith('.zip')) new AdmZip(bytes).extractAllTo(staging, true)
  else {
    const extracted = spawnSync('tar', ['-xzf', archive, '-C', staging], {
      windowsHide: true,
      stdio: 'inherit'
    })
    if (extracted.error || extracted.status !== 0)
      throw extracted.error ?? new Error('Chromaprint extraction failed')
  }
  const source = path.join(staging, name.replace(/\.(zip|tar\.gz)$/, ''))
  await fs.mkdir(directory, { recursive: true })
  const files = await fs.readdir(source, { withFileTypes: true })
  for (const entry of files)
    if (entry.isFile())
      await fs.copyFile(path.join(source, entry.name), path.join(directory, entry.name))
  if (process.platform !== 'win32') await fs.chmod(path.join(directory, executable), 0o755)
  await fs.writeFile(
    path.join(directory, 'manifest.json'),
    JSON.stringify(
      {
        version: release.version,
        archiveSha256: target.sha256,
        executableSha256: digest(await fs.readFile(path.join(directory, executable)))
      },
      null,
      2
    ) + '\n'
  )
  console.log(`Chromaprint ${release.version}: downloaded and SHA-256 verified ${targetKey} tool`)
} finally {
  await fs.rm(staging, { recursive: true, force: true })
}
