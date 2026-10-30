/* eslint-disable @typescript-eslint/explicit-function-return-type -- Build preparation regression test. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { assets, prepareYtdlpAsset, resolveYtdlpRelease, selectYtdlpTarget } from './lib/ytdlp.mjs'

const directory = await fs.mkdtemp(path.resolve('build/ytdlp-prepare-check-'))
try {
  const data = Buffer.from('synthetic executable bytes')
  const sha256 = createHash('sha256').update(data).digest('hex')
  const release = {
    formatVersion: 1,
    version: '2026.10.26',
    assets: Object.fromEntries(assets.map((name) => [name, { size: data.length, sha256 }]))
  }
  const target = selectYtdlpTarget('win32', 'x64')
  const destination = path.join(directory, 'yt-dlp.exe')
  let downloads = 0
  const options = {
    release,
    target,
    destination,
    platform: 'win32',
    arch: 'x64',
    fetcher: async () => {
      downloads++
      return new Response(data)
    },
    verify: (file, version) => {
      assert.equal(version, release.version)
      assert.ok(file.endsWith('.exe'))
    }
  }
  await fs.writeFile(destination, 'old nonempty cache')
  assert.equal((await prepareYtdlpAsset(options)).cached, false)
  assert.equal((await prepareYtdlpAsset(options)).cached, true)
  assert.equal(downloads, 1)
  await assert.rejects(
    prepareYtdlpAsset({
      ...options,
      release: {
        ...release,
        assets: { ...release.assets, 'yt-dlp.exe': { size: data.length, sha256: '0'.repeat(64) } }
      }
    }),
    /SHA-256/
  )
  assert.deepEqual(await fs.readFile(destination), data)
  await fs.writeFile(destination, 'preserve previous executable')
  await assert.rejects(
    prepareYtdlpAsset({
      ...options,
      verify: () => {
        throw new Error('bad executable version')
      }
    }),
    /bad executable version/
  )
  assert.equal(await fs.readFile(destination, 'utf8'), 'preserve previous executable')
  assert.ok(!(await fs.readdir(directory)).some((name) => name.includes('.download-')))
  assert.equal(selectYtdlpTarget('darwin', 'arm64').asset, selectYtdlpTarget('darwin', 'x64').asset)
  assert.equal(selectYtdlpTarget('linux', 'arm64').asset, 'yt-dlp_linux_aarch64')
  assert.throws(() => selectYtdlpTarget('win32', 'ia32'), /Unsupported/)
  const metadata = {
    tag_name: release.version,
    prerelease: false,
    draft: false,
    assets: assets.map((name) => ({ name, size: data.length, digest: `sha256:${sha256}` }))
  }
  const fetcher = async (url) =>
    url.includes('api.github.com')
      ? new Response(JSON.stringify(metadata))
      : new Response(assets.map((name) => `${sha256}  ${name}`).join('\n'))
  assert.deepEqual(await resolveYtdlpRelease(fetcher), release)
  await assert.rejects(
    resolveYtdlpRelease(
      async () => new Response(JSON.stringify({ ...metadata, prerelease: true }))
    ),
    /stable/
  )
  console.log(
    'yt-dlp: old cache replacement, verified reuse, hash/version rejection, preserved previous file, stable release checks and platform mapping passed'
  )
} finally {
  await fs.rm(directory, { recursive: true, force: true })
}
