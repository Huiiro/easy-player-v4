/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone integration tests. */
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { build } from 'esbuild'
import ts from 'typescript'
import AdmZip from 'adm-zip'

const buildRoot = path.resolve('build')
const directory = await fs.mkdtemp(path.join(buildRoot, 'optional-runtime-test-'))
try {
  const source = await fs.readFile('src/main/service/autoMixRuntimeService.ts', 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
  }).outputText
  const { AutoMixRuntimeService, validateRuntimeManifest, autoMixReleaseUrl } = await import(
    'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  )
  assert.equal(
    autoMixReleaseUrl('3.3.1'),
    'https://github.com/Huiiro/easy-player-v4/releases/latest/download/'
  )
  assert.equal(
    autoMixReleaseUrl('3.3.2-beta.1'),
    'https://github.com/Huiiro/easy-player-v4/releases/download/v3.3.2-beta.1/'
  )
  const workerFile = path.join(directory, 'extract.cjs')
  await build({
    entryPoints: ['src/main/service/autoMixRuntimeWorker.ts'],
    outfile: workerFile,
    bundle: true,
    platform: 'node',
    format: 'cjs'
  })
  const { extractRuntimeArchive } = createRequire(import.meta.url)(workerFile)
  const zip = new AdmZip()
  const required = [
    'python/python.exe',
    'python/python312.dll',
    'python/python312._pth',
    'models/htdemucs.yaml',
    'models/955717e8-8726e21a.th'
  ]
  for (const name of required) zip.addFile(name, Buffer.from('test fixture'))
  const bytes = zip.toBuffer()
  const manifest = {
    formatVersion: 1,
    version: '1.0.0',
    platform: 'win32',
    arch: 'x64',
    asset: 'easy-player-auto-mix-win32-x64-1.0.0.zip',
    size: bytes.length,
    unpackedSize: 1024,
    sha256: createHash('sha256').update(bytes).digest('hex')
  }
  let fetches = 0,
    verifications = 0
  const statuses = []
  const requestedUrls = []
  const releaseBaseUrl = autoMixReleaseUrl('3.3.2-beta.1')
  const cacheDirectory = path.join(directory, 'stem-cache')
  let beforeMaintenance = async () => {}
  const options = (root) => ({
    root,
    cacheDirectory,
    beforeMaintenance: () => beforeMaintenance(),
    supported: true,
    releaseBaseUrl,
    fetch: async (url) => {
      fetches++
      requestedUrls.push(url)
      return new Response(url.endsWith('.json') ? JSON.stringify(manifest) : bytes)
    },
    extract: async (archive, target, limit) => extractRuntimeArchive(archive, target, limit),
    verify: async (target) => {
      verifications++
      assert.ok((await fs.stat(path.join(target, required[0]))).isFile())
    },
    onChange: (status) => statuses.push(status)
  })
  const root = path.join(directory, '安装目录')
  const service = new AutoMixRuntimeService(options(root))
  assert.equal(service.status().phase, 'not-installed')
  assert.equal(fetches, 0, 'Status must never trigger a download')
  service.start()
  service.start()
  await service.wait()
  assert.equal(service.status().installed, true)
  assert.equal(fetches, 2, 'Concurrent starts must share one download')
  assert.deepEqual(
    requestedUrls,
    [releaseBaseUrl + 'easy-player-auto-mix-win32-x64.json', releaseBaseUrl + manifest.asset],
    'Prerelease manifest and ZIP must come from the same tagged release'
  )
  assert.equal(verifications, 1)
  assert.ok(statuses.some((status) => status.phase === 'downloading'))
  assert.ok(statuses.some((status) => status.phase === 'installing'))
  service.start()
  await service.wait()
  assert.equal(fetches, 2)
  assert.equal(
    new AutoMixRuntimeService(options(root)).status().installed,
    true,
    'Installation survives restart'
  )

  const ordinaryCache = path.join(directory, 'ordinary-cache')
  await fs.mkdir(ordinaryCache)
  await fs.writeFile(path.join(ordinaryCache, 'keep.txt'), 'keep')
  await fs.mkdir(path.join(cacheDirectory, 'models'), { recursive: true })
  await fs.writeFile(path.join(cacheDirectory, 'stem.wav'), '12345')
  await fs.writeFile(path.join(cacheDirectory, 'models', 'legacy.th'), '123')
  assert.equal((await service.cacheInfo()).bytes, 8)
  assert.equal((await service.cacheInfo()).files, 2)
  let releaseMaintenance
  let enteredMaintenance
  const entered = new Promise((resolve) => {
    enteredMaintenance = resolve
  })
  beforeMaintenance = () =>
    new Promise((resolve) => {
      releaseMaintenance = resolve
      enteredMaintenance()
    })
  const clearing = service.clearCache()
  await entered
  assert.equal(service.status().phase, 'clearing-cache')
  await fs.access(path.join(cacheDirectory, 'stem.wav'))
  service.start()
  assert.equal(fetches, 2, 'Maintenance must block new downloads')
  releaseMaintenance()
  assert.equal((await clearing).success, true)
  beforeMaintenance = async () => {}
  assert.equal((await service.cacheInfo()).bytes, 0)
  assert.equal(
    service.status().installed,
    true,
    'Clearing cache must preserve the installed runtime'
  )
  await fs.access(path.join(root, 'installed.json'))
  await fs.access(path.join(ordinaryCache, 'keep.txt'))

  await fs.mkdir(cacheDirectory)
  await fs.writeFile(path.join(cacheDirectory, 'stem.wav'), 'preserved')
  assert.equal((await service.uninstall()).installed, false)
  await assert.rejects(fs.access(root))
  assert.equal(
    await fs.readFile(path.join(cacheDirectory, 'stem.wav'), 'utf8'),
    'preserved',
    'Uninstall must preserve generated stems'
  )
  service.start()
  await service.wait()
  assert.equal(service.status().installed, true, 'Reinstallation must work after uninstall')

  const external = path.join(directory, 'external')
  await fs.mkdir(external)
  await fs.writeFile(path.join(external, 'keep.txt'), 'keep')
  await fs.rm(cacheDirectory, { recursive: true })
  await fs.symlink(external, cacheDirectory, process.platform === 'win32' ? 'junction' : 'dir')
  assert.equal(
    (await service.clearCache()).success,
    false,
    'A linked cache root must not be cleared'
  )
  await fs.access(path.join(external, 'keep.txt'))
  await fs.unlink(cacheDirectory)
  await fs.mkdir(cacheDirectory)
  await fs.symlink(
    external,
    path.join(cacheDirectory, 'linked-child'),
    process.platform === 'win32' ? 'junction' : 'dir'
  )
  assert.equal((await service.clearCache()).success, true)
  await fs.access(path.join(external, 'keep.txt'))
  assert.throws(
    () => new AutoMixRuntimeService({ ...options(root), cacheDirectory: root }),
    /separate/
  )

  const corruptRoot = path.join(directory, 'corrupt')
  const corrupt = new AutoMixRuntimeService({
    ...options(corruptRoot),
    fetch: async (url) =>
      new Response(
        url.endsWith('.json') ? JSON.stringify({ ...manifest, sha256: '0'.repeat(64) }) : bytes
      )
  })
  corrupt.start()
  await corrupt.wait()
  assert.equal(corrupt.status().phase, 'error')
  assert.equal(corrupt.status().installed, false)
  await assert.rejects(fs.access(path.join(corruptRoot, 'installed.json')))
  assert.deepEqual(await fs.readdir(corruptRoot), [], 'Failed downloads must leave no staging data')

  let cancelled
  const cancelRoot = path.join(directory, 'cancelled')
  cancelled = new AutoMixRuntimeService({
    ...options(cancelRoot),
    onChange: (status) => {
      if (status.phase === 'downloading' && status.receivedBytes > 0) cancelled.cancel()
    }
  })
  cancelled.start()
  await cancelled.wait()
  assert.equal(cancelled.status().phase, 'not-installed')
  assert.equal(cancelled.status().installed, false)

  const removingDownload = new AutoMixRuntimeService({
    ...options(path.join(directory, 'remove-downloading')),
    fetch: async (_url, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })
      })
  })
  removingDownload.start()
  assert.equal((await removingDownload.uninstall()).phase, 'not-installed')

  const invalid = new AdmZip()
  invalid.addFile('python/evil:stream', Buffer.from('bad'))
  const invalidFile = path.join(directory, 'invalid.zip')
  invalid.writeZip(invalidFile)
  assert.throws(
    () => extractRuntimeArchive(invalidFile, path.join(directory, 'unsafe'), 1024),
    /Unsafe/
  )
  const validFile = path.join(directory, 'valid.zip')
  zip.writeZip(validFile)
  assert.throws(
    () => extractRuntimeArchive(validFile, path.join(directory, 'overflow'), 1),
    /budget/
  )
  assert.throws(() => validateRuntimeManifest({ ...manifest, asset: '../../other.zip' }), /Invalid/)
  assert.throws(() => validateRuntimeManifest({ ...manifest, arch: 'arm64' }), /Invalid/)
  console.log(
    'Optional runtime: install/uninstall/reinstall, cache isolation, worker drain, linked-directory protection, cancellation and archive validation passed'
  )
} finally {
  assert.equal(path.dirname(directory), buildRoot)
  assert.ok(path.basename(directory).startsWith('optional-runtime-test-'))
  await fs.rm(directory, { recursive: true, force: true })
}
