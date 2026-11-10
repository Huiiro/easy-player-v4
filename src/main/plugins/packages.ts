import { officialThemeFrame } from './themeFrame'
import { themeGlassSnapshot } from './themeGlassSnapshot'
import { createHash, randomUUID } from 'node:crypto'
import { assertApplicationActive } from '../service/applicationShutdown'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  statSync
} from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { isDeepStrictEqual } from 'node:util'
import AdmZip from 'adm-zip'
import { validateManifest, type PluginManager } from './manager'
import type { PluginDefinition } from './types'
import type {
  OfficialPluginCatalog,
  OfficialPluginEntry,
  PluginManifest
} from '../../shared/plugins'
import { comparePluginVersions } from '../../shared/plugins'
import type { InstalledPluginTheme } from '../../shared/themePlugins'
import { readThemePlugin, type ThemePluginContent } from './themePackage'

export const OFFICIAL_PLUGIN_CATALOG_URL =
  'https://github.com/Huiiro/easy-player-plugin/releases/download/plugins/catalog.json'
const maxPackageSize = 16 * 1024 * 1024
const maxExpandedSize = 64 * 1024 * 1024
const manifestKeys = ['id', 'displayName', 'version', 'apiVersion', 'sources'] as const
function manifestOf(value: PluginManifest): PluginManifest {
  return Object.fromEntries(
    [
      ...manifestKeys,
      ...(value.author !== undefined ? (['author'] as const) : []),
      ...(value.kind === 'theme' ? (['kind', 'theme'] as const) : [])
    ].map((key) => [key, value[key]])
  ) as unknown as PluginManifest
}
interface StoredPluginEntry extends OfficialPluginEntry {
  origin?: 'third-party'
}
function validateStored(value: StoredPluginEntry): StoredPluginEntry {
  if (value?.origin !== 'third-party')
    return validateCatalog({ schemaVersion: 1, plugins: [value] }).plugins[0]
  const manifest = validateManifest(manifestOf(value))
  if (
    manifest.kind !== 'theme' ||
    manifest.id.startsWith('builtin.') ||
    value.url !== 'local:theme' ||
    !/^[a-f0-9]{64}$/.test(value.sha256) ||
    !Number.isSafeInteger(value.size) ||
    value.size < 1 ||
    value.size > maxPackageSize
  )
    throw new Error('pluginPackageInvalid')
  return {
    ...manifest,
    origin: 'third-party',
    url: 'local:theme',
    sha256: value.sha256,
    size: value.size
  }
}
export function validateCatalog(value: unknown): OfficialPluginCatalog {
  const catalog = value as OfficialPluginCatalog
  if (
    !catalog ||
    catalog.schemaVersion !== 1 ||
    !Array.isArray(catalog.plugins) ||
    catalog.plugins.length > 100
  )
    throw new Error('pluginCatalogInvalid')
  const ids = new Set<string>()
  const plugins = catalog.plugins.map((entry) => {
    const manifest = validateManifest(manifestOf(entry))
    if (
      ids.has(manifest.id) ||
      !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      !Number.isSafeInteger(entry.size) ||
      entry.size < 1 ||
      entry.size > maxPackageSize
    )
      throw new Error('pluginCatalogInvalid')
    ids.add(manifest.id)
    const url = new URL(entry.url)
    if (
      url.origin !== 'https://github.com' ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !(
        /^\/Huiiro\/easy-player-plugin\/releases\/download\/plugins\/[a-zA-Z0-9._-]+\.epp$/.test(
          url.pathname
        ) ||
        // Previously installed API v1 packages retain their original official URL.
        (manifest.apiVersion === 1 &&
          /^\/Huiiro\/easy-player-v4\/releases\/download\/plugins\/[a-zA-Z0-9._-]+\.epp$/.test(
            url.pathname
          ))
      )
    )
      throw new Error('pluginCatalogInvalid')
    return { ...manifest, sha256: entry.sha256, size: entry.size, url: url.href }
  })
  return { schemaVersion: 1, plugins }
}
async function readResponse(response: Response, limit: number): Promise<Buffer> {
  if (!response.ok || !response.body) throw new Error('pluginDownloadFailed')
  const length = Number(response.headers.get('content-length'))
  if (length > limit) throw new Error('pluginPackageInvalid')
  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body.getReader()
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > limit) throw new Error('pluginPackageInvalid')
      chunks.push(chunk.value)
    }
    return Buffer.concat(chunks)
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}
function atomicJson(filename: string, value: unknown): void {
  const temp = filename + '.' + randomUUID() + '.tmp'
  try {
    writeFileSync(temp, JSON.stringify(value), { flag: 'wx' })
    renameSync(temp, filename)
  } finally {
    if (existsSync(temp)) unlinkSync(temp)
  }
}

export interface PluginPackageEvent {
  pluginId: string
  version: string
  level: 'info' | 'error'
  operation: string
  message: string
}

/** Only catalog-approved archives are evaluated. This is not a third-party sandbox. */
export class OfficialPluginPackages {
  private catalog: OfficialPluginCatalog
  private readonly bundled: OfficialPluginCatalog
  private busy = new Set<string>()
  private installed = new Map<string, StoredPluginEntry>()
  private themes = new Map<string, ThemePluginContent>()
  private initialized = false
  constructor(
    private readonly root: string,
    private readonly manager: PluginManager,
    private readonly bridge: object,
    seed: OfficialPluginCatalog,
    private readonly fetcher: typeof fetch = fetch,
    private readonly onFailure: (id: string, reason?: unknown) => void = () => undefined,
    private readonly onEvent: (event: PluginPackageEvent) => void = () => undefined
  ) {
    this.bundled = validateCatalog(seed)
    this.catalog = this.bundled
  }
  private report(
    entry: OfficialPluginEntry,
    operation: string,
    level: 'info' | 'error',
    message: string
  ): void {
    try {
      this.onEvent({ pluginId: entry.id, version: entry.version, operation, level, message })
    } catch {
      /* Logging never changes a transaction. */
    }
  }
  listCatalog(): OfficialPluginEntry[] {
    return structuredClone(this.catalog.plugins)
  }
  isBusy(id: string): boolean {
    return this.busy.has(id)
  }
  private prune(id: string, keep?: string): void {
    const directory = resolve(this.root, id)
    if (!directory.startsWith(resolve(this.root) + sep)) throw new Error('pluginPackageInvalid')
    for (const file of readdirSync(directory, { withFileTypes: true })) {
      if (!file.isDirectory() || !/^[a-f0-9]{64}$/.test(file.name) || file.name === keep) continue
      const target = resolve(directory, file.name)
      if (!target.startsWith(directory + sep)) throw new Error('pluginPackageInvalid')
      try {
        rmSync(target, { recursive: true, force: true })
      } catch {
        /* Retry on next startup. */
      }
    }
  }
  private loadDefinition(bytes: Buffer, entry: OfficialPluginEntry): PluginDefinition {
    if (
      bytes.length !== entry.size ||
      createHash('sha256').update(bytes).digest('hex') !== entry.sha256
    )
      throw new Error('pluginPackageIntegrity')
    const zip = new AdmZip(bytes)
    const files = zip.getEntries()
    const names = new Set<string>()
    let expanded = 0
    for (const file of files) {
      const name = file.entryName
      expanded += file.header.size
      if (
        files.length > 256 ||
        expanded > maxExpandedSize ||
        names.has(name) ||
        !/^[a-zA-Z0-9@_./-]+$/.test(name) ||
        name.startsWith('/') ||
        name.split('/').some((part) => part === '.' || part === '..') ||
        ((file.header.attr >>> 16) & 0xf000) === 0xa000
      )
        throw new Error('pluginPackageInvalid')
      names.add(name)
    }
    if (!names.has('manifest.json')) throw new Error('pluginPackageInvalid')
    const manifest = validateManifest(JSON.parse(zip.readAsText('manifest.json')))
    if (!isDeepStrictEqual(manifestOf(manifest), manifestOf(entry)))
      throw new Error('pluginPackageInvalid')
    const theme =
      manifest.kind === 'theme'
        ? readThemePlugin(bytes, (entry as StoredPluginEntry).origin !== 'third-party')
        : undefined
    if (
      !theme &&
      (!names.has('index.cjs') || (entry as StoredPluginEntry).origin === 'third-party')
    )
      throw new Error('pluginPackageInvalid')
    const directory = join(this.root, entry.id, entry.sha256)
    mkdirSync(directory, { recursive: true })
    // No generic extraction: only the two fixed runtime files and original archive are written.
    if (!theme) writeFileSync(join(directory, 'index.cjs'), zip.readFile('index.cjs')!)
    writeFileSync(join(directory, 'manifest.json'), JSON.stringify(manifest))
    writeFileSync(join(directory, 'package.epp'), bytes)
    if (theme) {
      this.themes.set(entry.sha256, theme)
      return {
        manifest,
        activate() {
          /* Theme activation exposes validated data only. */
        }
      }
    }
    const require = createRequire(join(directory, 'loader.cjs'))
    const factory = require('./index.cjs') as { createPlugin?: (host: object) => PluginDefinition }
    if (typeof factory.createPlugin !== 'function') throw new Error('pluginPackageInvalid')
    const definition = factory.createPlugin(this.bridge)
    if (
      !definition ||
      !isDeepStrictEqual(manifestOf(validateManifest(definition.manifest)), manifestOf(manifest))
    )
      throw new Error('pluginPackageInvalid')
    return definition
  }
  initialize(): void {
    if (this.initialized) return
    this.initialized = true
    mkdirSync(this.root, { recursive: true })
    try {
      const cached = validateCatalog(
        JSON.parse(readFileSync(join(this.root, 'catalog.json'), 'utf8'))
      )
      this.catalog = cached
    } catch {
      /* The bundled index remains available offline. */
    }
    for (const file of readdirSync(this.root, { withFileTypes: true })) {
      if (!file.isDirectory() || !/^[a-z][a-z0-9._-]{0,95}$/.test(file.name)) continue
      const pointer = join(this.root, file.name, 'current.json')
      if (!existsSync(pointer)) {
        this.prune(file.name)
        continue
      }
      try {
        const entry = validateStored(JSON.parse(readFileSync(pointer, 'utf8')))
        if (entry.id !== file.name) throw new Error('pluginPackageInvalid')
        const archive = join(this.root, entry.id, entry.sha256, 'package.epp')
        if (statSync(archive).size !== entry.size) throw new Error('pluginPackageIntegrity')
        const bytes = readFileSync(archive)
        this.manager.load(this.loadDefinition(bytes, entry), entry.origin ?? 'official')
        this.installed.set(entry.id, entry)
        this.prune(entry.id, entry.sha256)
      } catch (reason) {
        try {
          this.onFailure(file.name, reason)
        } catch {
          /* Other installed packages still load. */
        }
      }
    }
  }
  async refreshCatalog(): Promise<OfficialPluginEntry[]> {
    const response = await this.fetcher(OFFICIAL_PLUGIN_CATALOG_URL, {
      signal: AbortSignal.timeout(30000)
    })
    const bytes = await readResponse(response, 256 * 1024)
    const next = validateCatalog(JSON.parse(bytes.toString('utf8')))
    mkdirSync(this.root, { recursive: true })
    atomicJson(join(this.root, 'catalog.json'), next)
    this.catalog = next
    return this.listCatalog()
  }
  async install(id: string, enabled: boolean, localBytes?: Buffer): Promise<void> {
    const entry = this.catalog.plugins.find((plugin) => plugin.id === id)
    if (!entry) throw new Error('pluginUnknown')
    return this.installEntry(entry, enabled, localBytes)
  }
  private async installEntry(
    entry: StoredPluginEntry,
    enabled: boolean,
    localBytes?: Buffer
  ): Promise<void> {
    const id = entry.id
    if (this.busy.has(id)) throw new Error('pluginBusy')
    const current = this.installed.get(id)
    if (current && current.origin !== entry.origin) throw new Error('pluginPackageIntegrity')
    if (current && comparePluginVersions(entry.version, current.version) < 0)
      throw new Error('pluginDowngrade')
    this.busy.add(id)
    const operation = current ? 'update' : 'install'
    this.report(entry, operation, 'info', 'STARTED')
    try {
      const bytes =
        localBytes ??
        (await readResponse(
          await this.fetcher(entry.url, { signal: AbortSignal.timeout(60000) }),
          maxPackageSize
        ))
      assertApplicationActive()
      const next = this.loadDefinition(bytes, entry)
      const previous = this.installed.get(id)
      const previousEnabled = this.manager.get(id)?.enabled ?? false
      // New archive/entry validation finishes before the running version is stopped.
      const previousDefinition = previous
        ? this.loadDefinition(
            readFileSync(join(this.root, id, previous.sha256, 'package.epp')),
            previous
          )
        : undefined
      this.manager.unload(id)
      try {
        this.manager.load(next, entry.origin ?? 'official')
        if (enabled) this.manager.activate(id)
        atomicJson(join(this.root, id, 'current.json'), entry)
        this.installed.set(id, entry)
        this.report(entry, operation, 'info', 'COMMITTED')
        if (previous && previous.sha256 !== entry.sha256) this.themes.delete(previous.sha256)
      } catch (reason) {
        this.manager.unload(id)
        if (previous?.sha256 !== entry.sha256) this.themes.delete(entry.sha256)
        if (previousDefinition) {
          this.manager.load(previousDefinition, previous?.origin ?? 'official')
          if (previousEnabled) this.manager.activate(id)
        }
        throw reason
      }
    } catch (reason) {
      this.report(
        entry,
        operation,
        'error',
        (this.installed.has(id) ? 'FAILED_PREVIOUS_RETAINED: ' : 'FAILED: ') +
          (reason instanceof Error ? reason.message : String(reason))
      )
      throw reason
    } finally {
      this.busy.delete(id)
    }
  }
  async installFile(filename: string, enabled: (id: string) => boolean): Promise<void> {
    if (statSync(filename).size > maxPackageSize) throw new Error('pluginPackageInvalid')
    const bytes = readFileSync(filename)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    // A cached/remote index can predate this application's pinned offline index.
    const entry =
      this.catalog.plugins.find((plugin) => plugin.sha256 === sha256) ??
      this.bundled.plugins.find((plugin) => plugin.sha256 === sha256)
    if (entry) return this.installEntry(entry, enabled(entry.id), bytes)
    if (bytes.subarray(0, 2).toString() !== 'PK') throw new Error('pluginPackageIntegrity')
    // Third parties may contribute data-only themes. Source code remains catalog-only.
    const zip = new AdmZip(bytes)
    const manifestEntry = zip.getEntry('manifest.json')
    if (!manifestEntry || manifestEntry.header.size > 128 * 1024)
      throw new Error('pluginPackageInvalid')
    // Validate the full archive and its resource bounds before reading its manifest.
    readThemePlugin(bytes)
    const manifest = validateManifest(JSON.parse(zip.readAsText('manifest.json')))
    const local = validateStored({
      ...manifest,
      origin: 'third-party',
      url: 'local:theme',
      sha256,
      size: bytes.length
    })
    await this.installEntry(local, enabled(local.id), bytes)
  }
  listThemes(): InstalledPluginTheme[] {
    return [...this.installed.values()].flatMap((entry) => {
      if (!entry.theme || this.manager.get(entry.id)?.state !== 'active') return []
      const content = this.themes.get(entry.sha256)
      if (!content) return []
      return [
        {
          pluginId: entry.id,
          ...(entry.author ? { author: structuredClone(entry.author) } : {}),
          version: entry.version,
          revision: entry.sha256,
          ...entry.theme,
          data: structuredClone(content.data),
          ...(content.data.renderer
            ? {
                rendererUrl: `easy-player-media://plugin-theme/${entry.id}/${entry.sha256}/__frame.html`
              }
            : {}),
          fragmentShader: content.fragmentShader,
          textures: (content.data.shader?.textures ?? []).map((texture) => ({
            ...texture,
            url: `easy-player-media://plugin-theme/${entry.id}/${entry.sha256}/${texture.path}`
          }))
        }
      ]
    })
  }
  themeResource(id: string, hash: string, path: string): Buffer | undefined {
    const entry = this.installed.get(id)
    if (!entry || entry.sha256 !== hash || this.manager.get(id)?.state !== 'active')
      return undefined
    const theme = this.themes.get(hash)
    if (path === '__glass-snapshot.js' && theme?.data.renderer && entry.origin !== 'third-party')
      return themeGlassSnapshot
    if (path === '__frame.html' && theme?.data.renderer && entry.origin !== 'third-party')
      return officialThemeFrame(
        `easy-player-media://plugin-theme/${id}/${hash}/${theme.data.renderer.entry}`
      )
    return theme?.assets.get(path)
  }
  uninstall(id: string): void {
    if (this.busy.has(id)) throw new Error('pluginBusy')
    if (!this.installed.has(id)) throw new Error('pluginUnknown')
    // Removing the startup pointer commits uninstall before changing runtime state.
    unlinkSync(join(this.root, id, 'current.json'))
    this.manager.unload(id)
    this.themes.delete(this.installed.get(id)!.sha256)
    const removed = this.installed.get(id)!
    this.installed.delete(id)
    this.report(removed, 'uninstall', 'info', 'COMMITTED')
    // Version archives are retained for this process's accepted download leases.
    // They are inert without current.json; reinstall reuses the content-addressed version.
  }
}
