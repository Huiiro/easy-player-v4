/* eslint-disable @typescript-eslint/explicit-function-return-type -- Build dependency preparation. */
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'

export const assets = ['yt-dlp.exe', 'yt-dlp_macos', 'yt-dlp_linux', 'yt-dlp_linux_aarch64']
const checksum = (data) => createHash('sha256').update(data).digest('hex')

export async function resolveYtdlpRelease(fetcher = fetch, version = 'latest') {
  const endpoint = version === 'latest' ? 'latest' : `tags/${encodeURIComponent(version)}`
  const response = await fetcher(
    `https://api.github.com/repos/yt-dlp/yt-dlp/releases/${endpoint}`,
    {
      signal: AbortSignal.timeout(60_000),
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'easy-player-build' }
    }
  )
  if (!response.ok) throw new Error(`yt-dlp release lookup failed: HTTP ${response.status}`)
  const release = await response.json()
  if (!/^20\d{2}\.\d{2}\.\d{2}$/.test(release.tag_name) || release.prerelease || release.draft)
    throw new Error('Expected an official stable yt-dlp release')
  const checksums = await fetcher(
    `https://github.com/yt-dlp/yt-dlp/releases/download/${release.tag_name}/SHA2-256SUMS`,
    { signal: AbortSignal.timeout(60_000) }
  )
  if (!checksums.ok) throw new Error(`yt-dlp checksum download failed: HTTP ${checksums.status}`)
  const hashes = new Map(
    [...(await checksums.text()).matchAll(/^([a-f0-9]{64})\s+\*?([^\r\n]+)$/gm)].map((match) => [
      match[2],
      match[1]
    ])
  )
  return {
    formatVersion: 1,
    version: release.tag_name,
    assets: Object.fromEntries(
      assets.map((name) => {
        const asset = release.assets.find((asset) => asset.name === name)
        const sha256 = hashes.get(name)
        if (
          !asset ||
          !sha256 ||
          !Number.isSafeInteger(asset.size) ||
          asset.size < 1 ||
          asset.size > 150 * 1024 ** 2 ||
          (asset.digest && asset.digest !== `sha256:${sha256}`)
        )
          throw new Error(`Invalid official yt-dlp asset metadata: ${name}`)
        return [name, { size: asset.size, sha256 }]
      })
    )
  }
}

export function selectYtdlpTarget(platform, arch) {
  if (platform === 'win32' && arch === 'x64')
    return { asset: 'yt-dlp.exe', directory: 'win', executable: 'yt-dlp.exe' }
  if (platform === 'darwin' && ['x64', 'arm64'].includes(arch))
    return { asset: 'yt-dlp_macos', directory: 'mac', executable: 'yt-dlp' }
  if (platform === 'linux' && ['x64', 'arm64'].includes(arch))
    return {
      asset: arch === 'x64' ? 'yt-dlp_linux' : 'yt-dlp_linux_aarch64',
      directory: `linux/${arch}`,
      executable: 'yt-dlp'
    }
  throw new Error(`Unsupported yt-dlp platform: ${platform}/${arch}`)
}

export function verifyYtdlpVersion(executable, version) {
  const result = spawnSync(executable, ['--version'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 30_000
  })
  if (result.error) throw result.error
  if (result.status !== 0 || result.stdout.trim() !== version)
    throw new Error(
      `yt-dlp version verification failed: expected ${version}, got ${result.stdout?.trim() || result.stderr}`
    )
}

export async function prepareYtdlpAsset({
  release,
  target,
  destination,
  platform,
  arch,
  fetcher = fetch,
  verify = verifyYtdlpVersion
}) {
  const expected = release.assets[target.asset]
  if (
    release.formatVersion !== 1 ||
    !/^20\d{2}\.\d{2}\.\d{2}$/.test(release.version) ||
    !expected ||
    !/^[a-f0-9]{64}$/.test(expected.sha256) ||
    !Number.isSafeInteger(expected.size) ||
    expected.size < 1 ||
    expected.size > 150 * 1024 ** 2
  )
    throw new Error('Invalid yt-dlp release lock')
  const existing = await stat(destination).catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return null
  })
  const matches =
    existing?.isFile() &&
    existing.size === expected.size &&
    checksum(await readFile(destination)) === expected.sha256
  if (matches) {
    if (platform !== 'win32') await chmod(destination, 0o755)
    verify(destination, release.version)
  } else {
    const response = await fetcher(
      `https://github.com/yt-dlp/yt-dlp/releases/download/${release.version}/${target.asset}`,
      { signal: AbortSignal.timeout(300_000) }
    )
    if (!response.ok) throw new Error(`yt-dlp download failed: HTTP ${response.status}`)
    const data = Buffer.from(await response.arrayBuffer())
    if (data.length !== expected.size || checksum(data) !== expected.sha256)
      throw new Error('yt-dlp size/SHA-256 verification failed')
    await mkdir(dirname(destination), { recursive: true })
    const temporary = `${destination}.download-${randomUUID()}${platform === 'win32' ? '.exe' : ''}`
    try {
      await writeFile(temporary, data, { flag: 'wx' })
      if (platform !== 'win32') await chmod(temporary, 0o755)
      verify(temporary, release.version)
      await rename(temporary, destination)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  const metadata = {
    formatVersion: 1,
    version: release.version,
    asset: target.asset,
    platform,
    arch: platform === 'darwin' ? 'universal' : arch,
    ...expected
  }
  await writeFile(`${destination}.manifest.json`, JSON.stringify(metadata, null, 2))
  return { ...metadata, cached: Boolean(matches) }
}
