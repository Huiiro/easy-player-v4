import { createHash, randomUUID } from 'node:crypto'
import { promises as fs, existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import type {
  AutoMixRuntimeManifest,
  AutoMixRuntimeStatus,
  AutoMixStemCacheInfo,
  AutoMixStemCacheResult
} from '../../shared/autoMixRuntime'

export const AUTO_MIX_RELEASE_URL =
  'https://github.com/Huiiro/easy-player-v4/releases/latest/download/'
export function autoMixReleaseUrl(version: string): string {
  return /^\d+\.\d+\.\d+-[0-9A-Za-z.-]+(?:\+[0-9A-Za-z.-]+)?$/.test(version)
    ? `https://github.com/Huiiro/easy-player-v4/releases/download/v${encodeURIComponent(version)}/`
    : AUTO_MIX_RELEASE_URL
}
export function autoMixTarget(
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): string | undefined {
  return (platform === 'win32' && arch === 'x64') || (platform === 'darwin' && arch === 'arm64')
    ? `${platform}-${arch}`
    : undefined
}
function requiredFiles(platform: NodeJS.Platform): string[] {
  return [
    ...(platform === 'darwin'
      ? ['python/bin/python3', 'python/lib/python3.12/os.py']
      : ['python/python.exe', 'python/python312.dll', 'python/python312._pth']),
    'models/htdemucs.yaml',
    'models/955717e8-8726e21a.th'
  ]
}

interface Options {
  root: string
  fetch: (url: string, signal: AbortSignal) => Promise<Response>
  extract: (archive: string, target: string, maxBytes: number, signal: AbortSignal) => Promise<void>
  verify: (directory: string, signal: AbortSignal) => Promise<void>
  onChange: (status: AutoMixRuntimeStatus) => void
  supported?: boolean
  cacheDirectory?: string
  beforeMaintenance?: () => Promise<void>
  releaseBaseUrl?: string
  platform?: NodeJS.Platform
  arch?: string
}

export function validateRuntimeManifest(
  value: unknown,
  platform: NodeJS.Platform = process.platform,
  arch: string = process.arch
): AutoMixRuntimeManifest {
  const m = value as AutoMixRuntimeManifest
  const target = autoMixTarget(platform, arch)
  if (
    !m ||
    m.formatVersion !== 1 ||
    !target ||
    m.platform !== platform ||
    m.arch !== arch ||
    typeof m.version !== 'string' ||
    !/^\d+\.\d+\.\d+$/.test(m.version) ||
    typeof m.asset !== 'string' ||
    m.asset !== `easy-player-auto-mix-${target}-${m.version}.zip` ||
    typeof m.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(m.sha256) ||
    !Number.isSafeInteger(m.size) ||
    m.size <= 0 ||
    m.size > 512 * 1024 ** 2 ||
    !Number.isSafeInteger(m.unpackedSize) ||
    m.unpackedSize <= 0 ||
    m.unpackedSize > 1536 * 1024 ** 2
  ) {
    throw new Error('Invalid or incompatible Auto Mix component manifest')
  }
  return m
}

/** Installation is explicit; status queries never download or start inference. */
export class AutoMixRuntimeService {
  private get platform(): NodeJS.Platform {
    return this.options.platform ?? process.platform
  }
  private get arch(): string {
    return this.options.arch ?? process.arch
  }
  private controller?: AbortController
  private task?: Promise<void>
  private maintenance?: Promise<void>
  private state: AutoMixRuntimeStatus

  constructor(private readonly options: Options) {
    this.options = {
      ...options,
      root: path.resolve(options.root),
      cacheDirectory: options.cacheDirectory ? path.resolve(options.cacheDirectory) : undefined
    }
    if (this.options.cacheDirectory) {
      const inside = (parent: string, child: string): boolean => {
        const relative = path.relative(parent, child)
        return (
          !relative ||
          (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
        )
      }
      if (
        inside(this.options.root, this.options.cacheDirectory) ||
        inside(this.options.cacheDirectory, this.options.root)
      ) {
        throw new Error('Component installation and stem cache directories must be separate')
      }
    }
    this.state = this.installedStatus()
  }

  private installedStatus(): AutoMixRuntimeStatus {
    const supported = this.options.supported ?? Boolean(autoMixTarget(this.platform, this.arch))
    let hasFiles = false
    try {
      hasFiles = readdirSync(this.options.root).length > 0
    } catch {
      hasFiles = existsSync(this.options.root)
    }
    try {
      const installed = JSON.parse(
        readFileSync(path.join(this.options.root, 'installed.json'), 'utf8')
      )
      if (
        typeof installed.directory === 'string' &&
        typeof installed.version === 'string' &&
        /^\d+\.\d+\.\d+$/.test(installed.version) &&
        /^v\d+\.\d+\.\d+-[a-f0-9]{12}$/.test(installed.directory) &&
        requiredFiles(this.platform).every((file) =>
          existsSync(path.join(this.options.root, 'versions', installed.directory, file))
        )
      ) {
        return {
          supported,
          installed: true,
          hasFiles,
          phase: 'ready',
          version: installed.version,
          receivedBytes: 0,
          totalBytes: 0
        }
      }
    } catch {
      /* Optional component is absent or incomplete. */
    }
    return {
      supported,
      installed: false,
      hasFiles,
      phase: 'not-installed',
      receivedBytes: 0,
      totalBytes: 0
    }
  }

  status(): AutoMixRuntimeStatus {
    return { ...this.state }
  }

  private update(changes: Partial<AutoMixRuntimeStatus>): void {
    this.state = { ...this.state, ...changes }
    this.options.onChange(this.status())
  }

  start(): AutoMixRuntimeStatus {
    if (
      this.task ||
      this.maintenance ||
      this.state.installed ||
      this.state.hasFiles ||
      !this.state.supported
    )
      return this.status()
    this.controller = new AbortController()
    this.update({ phase: 'checking', error: undefined, receivedBytes: 0, totalBytes: 0 })
    this.task = this.install(this.controller.signal).finally(() => {
      this.task = undefined
      this.controller = undefined
    })
    return this.status()
  }

  cancel(): void {
    this.controller?.abort()
  }
  async wait(): Promise<void> {
    await this.task
    await this.maintenance
  }

  private async removeDirectory(directory: string, expected: string): Promise<void> {
    const target = path.resolve(directory)
    if (target !== path.resolve(expected) || path.dirname(target) === target)
      throw new Error('Unsafe maintenance directory')
    const stat = await fs.lstat(target).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (!stat) return
    if (stat.isSymbolicLink()) throw new Error('Refusing to clear a linked maintenance directory')
    await fs.rm(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }

  private async maintain(
    phase: 'uninstalling' | 'clearing-cache',
    action: () => Promise<void>
  ): Promise<AutoMixRuntimeStatus> {
    let result = this.status()
    const operation = (this.maintenance ?? Promise.resolve()).then(async () => {
      this.cancel()
      await this.task
      this.update({ phase, error: undefined })
      let failure: string | undefined
      try {
        await this.options.beforeMaintenance?.()
        await action()
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      }
      this.state = this.installedStatus()
      this.update(failure ? { phase: 'error', error: failure } : {})
      result = this.status()
    })
    this.maintenance = operation
    try {
      await operation
      return result
    } finally {
      if (this.maintenance === operation) this.maintenance = undefined
    }
  }

  async uninstall(): Promise<AutoMixRuntimeStatus> {
    this.cancel()
    return this.maintain('uninstalling', () =>
      this.removeDirectory(this.options.root, this.options.root)
    )
  }

  async cacheInfo(): Promise<AutoMixStemCacheInfo> {
    const directory = this.options.cacheDirectory
    if (!directory) throw new Error('Stem cache directory is not configured')
    const result: AutoMixStemCacheInfo = { directory, bytes: 0, files: 0 }
    const walk = async (folder: string): Promise<void> => {
      const entries = await fs.readdir(folder, { withFileTypes: true }).catch((error) => {
        if (error.code === 'ENOENT') return []
        throw error
      })
      for (const entry of entries) {
        const file = path.join(folder, entry.name)
        if (entry.isDirectory()) await walk(file)
        else if (entry.isFile()) {
          const stat = await fs.stat(file).catch((error) => {
            if (error.code === 'ENOENT') return undefined
            throw error
          })
          if (stat) {
            result.bytes += stat.size
            result.files++
          }
        }
      }
    }
    const stat = await fs.lstat(directory).catch((error) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (stat?.isSymbolicLink()) throw new Error('Refusing to inspect a linked stem cache directory')
    if (stat) await walk(directory)
    return result
  }

  async clearCache(): Promise<AutoMixStemCacheResult> {
    if (this.task)
      return {
        success: false,
        error: 'Finish or cancel component installation before clearing the cache'
      }
    if (!this.options.cacheDirectory)
      return { success: false, error: 'Stem cache directory is not configured' }
    const directory = this.options.cacheDirectory
    const result = await this.maintain('clearing-cache', () =>
      this.removeDirectory(directory, directory)
    )
    return result.phase === 'error'
      ? { success: false, error: result.error }
      : { success: true, data: await this.cacheInfo() }
  }

  private async install(signal: AbortSignal): Promise<void> {
    const staging = path.join(this.options.root, '.install-' + randomUUID())
    const timeout = setTimeout(() => this.controller?.abort(), 30 * 60_000)
    timeout.unref()
    try {
      const response = await this.options.fetch(
        (this.options.releaseBaseUrl ?? AUTO_MIX_RELEASE_URL) +
          `easy-player-auto-mix-${autoMixTarget(this.platform, this.arch)}.json`,
        signal
      )
      if (!response.ok)
        throw new Error(
          'Component download is unavailable; retry after the optional runtime release is published'
        )
      const text = await response.text()
      if (text.length > 16_384) throw new Error('Component manifest is too large')
      const manifest = validateRuntimeManifest(JSON.parse(text), this.platform, this.arch)
      this.update({ phase: 'downloading', totalBytes: manifest.size, version: manifest.version })
      const download = await this.options.fetch(
        (this.options.releaseBaseUrl ?? AUTO_MIX_RELEASE_URL) + manifest.asset,
        signal
      )
      if (!download.ok || !download.body) throw new Error('Component archive download failed')
      await fs.mkdir(staging, { recursive: true })
      const archive = path.join(staging, 'download.zip')
      const file = await fs.open(archive, 'wx')
      const hash = createHash('sha256')
      let received = 0,
        reportedAt = 0
      const reader = download.body.getReader()
      try {
        for (;;) {
          signal.throwIfAborted()
          const { value, done } = await reader.read()
          if (done) break
          received += value.byteLength
          if (received > manifest.size) throw new Error('Component archive exceeds declared size')
          hash.update(value)
          await file.writeFile(value)
          if (Date.now() - reportedAt > 100) {
            this.update({ receivedBytes: received })
            reportedAt = Date.now()
          }
        }
      } finally {
        await reader.cancel().catch(() => {})
        await file.close()
      }
      if (received !== manifest.size || hash.digest('hex') !== manifest.sha256)
        throw new Error('Component archive integrity check failed')
      this.update({ phase: 'installing', receivedBytes: received })
      const extracted = path.join(staging, 'unpacked')
      await this.options.extract(archive, extracted, manifest.unpackedSize, signal)
      signal.throwIfAborted()
      if (!requiredFiles(this.platform).every((file) => existsSync(path.join(extracted, file))))
        throw new Error('Component archive is incomplete')
      await this.options.verify(extracted, signal)
      signal.throwIfAborted()
      const directory = `v${manifest.version}-${manifest.sha256.slice(0, 12)}`
      const versions = path.join(this.options.root, 'versions')
      await fs.mkdir(versions, { recursive: true })
      const destination = path.join(versions, directory)
      if (!existsSync(destination)) await fs.rename(extracted, destination)
      const pointer = path.join(staging, 'installed.json')
      await fs.writeFile(
        pointer,
        JSON.stringify({ directory, version: manifest.version, sha256: manifest.sha256 })
      )
      await fs.rename(pointer, path.join(this.options.root, 'installed.json'))
      this.state = this.installedStatus()
      this.update({})
    } catch (error) {
      this.state = this.installedStatus()
      this.update(
        signal.aborted
          ? {}
          : { phase: 'error', error: String(error instanceof Error ? error.message : error) }
      )
    } finally {
      clearTimeout(timeout)
      // Only our random staging directory, under the explicitly selected component root.
      if (
        path.dirname(staging) === path.resolve(this.options.root) &&
        path.basename(staging).startsWith('.install-')
      ) {
        await fs
          .rm(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
          .catch(() => {})
      }
      const current = this.installedStatus()
      if (current.hasFiles !== this.state.hasFiles) this.update({ hasFiles: current.hasFiles })
    }
  }
}
