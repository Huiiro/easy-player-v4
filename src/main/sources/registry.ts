import { SourceCallError } from './errors'
import type { NetworkSource } from './types'
import type { NetworkSourceInfo } from '../../shared/networkSources'
import { NETWORK_SOURCE_CAPABILITIES } from '../../shared/networkSources'
import type { PluginSourceManifest, PluginState } from '../../shared/plugins'
import type { PluginHostServices } from '../plugins/types'

interface SourceOwner {
  pluginId: string
  signal: AbortSignal
  host: PluginHostServices
}

export class SourceRegistry {
  private readonly sources = new Map<string, NetworkSource>()
  private readonly disabled = new Set<string>()
  private readonly owners = new Map<string, SourceOwner>()
  private readonly declared = new Map<
    string,
    PluginSourceManifest & { pluginId: string; version: string; state: PluginState }
  >()

  declare(pluginId: string, version: string, sources: PluginSourceManifest[]): () => void {
    if (sources.some((source) => this.declared.has(source.id) || this.sources.has(source.id)))
      throw new Error('Source already declared')
    for (const source of sources)
      this.declared.set(source.id, {
        ...structuredClone(source),
        pluginId,
        version,
        state: 'inactive'
      })
    return () => {
      for (const source of sources)
        if (this.declared.get(source.id)?.pluginId === pluginId) this.declared.delete(source.id)
    }
  }
  setPluginState(pluginId: string, state: PluginState): void {
    for (const source of this.declared.values())
      if (source.pluginId === pluginId) source.state = state
  }
  ownerOf(id: string): SourceOwner | undefined {
    return this.owners.get(id)
  }
  knows(id: string): boolean {
    return this.sources.has(id) || this.declared.has(id)
  }
  listDescriptors(): NetworkSourceInfo[] {
    const descriptors = [...this.declared.values()].map((source): NetworkSourceInfo => ({
      id: source.id,
      displayName: source.displayName,
      version: source.version,
      apiVersion: 1,
      origin: 'official',
      enabled: this.isEnabled(source.id),
      capabilities: [...source.capabilities],
      pluginId: source.pluginId,
      pluginState: source.state
    }))
    for (const source of this.sources.values())
      if (!this.declared.has(source.id))
        descriptors.push({
          id: source.id,
          displayName: source.displayName,
          version: source.version,
          apiVersion: source.apiVersion,
          origin: 'official',
          enabled: this.isEnabled(source.id),
          capabilities: NETWORK_SOURCE_CAPABILITIES.filter((capability) => !!source[capability])
        })
    return descriptors
  }

  register(source: NetworkSource, owner?: SourceOwner): () => void {
    if (!source.id.trim() || source.apiVersion !== 1) throw new Error('Invalid source definition')
    if (this.sources.has(source.id)) throw new Error('Source already registered: ' + source.id)
    const declaration = this.declared.get(source.id)
    if (declaration && declaration.pluginId !== owner?.pluginId)
      throw new Error('Source ownership mismatch')
    this.sources.set(source.id, source)
    if (owner) this.owners.set(source.id, owner)
    return () => {
      if (this.sources.get(source.id) === source) {
        this.sources.delete(source.id)
        this.owners.delete(source.id)
      }
    }
  }

  list(): NetworkSource[] {
    return this.listAll().filter((source) => this.isEnabled(source.id))
  }
  listAll(): NetworkSource[] {
    return [...this.sources.values()]
  }
  isEnabled(id: string): boolean {
    return this.sources.has(id) && !this.disabled.has(id) && !this.owners.get(id)?.signal.aborted
  }
  setEnabled(id: string, enabled: boolean): void {
    if (!this.knows(id)) throw new SourceCallError('SOURCE_NOT_FOUND', id)
    if (enabled) this.disabled.delete(id)
    else this.disabled.add(id)
  }
  requireEnabled(id: string): NetworkSource {
    const source = this.sources.get(id)
    if (!source)
      throw new SourceCallError(this.declared.has(id) ? 'SOURCE_DISABLED' : 'SOURCE_NOT_FOUND', id)
    if (!this.isEnabled(id)) throw new SourceCallError('SOURCE_DISABLED', id)
    return source
  }
  /** Definition lookup for management. Calls must use requireEnabled or the enabled-only list. */
  get(id: string): NetworkSource | undefined {
    return this.sources.get(id)
  }

  requireDownload(id: string): NonNullable<NetworkSource['download']> {
    const capability = this.requireEnabled(id).download
    if (!capability) throw new Error('Source does not support downloads: ' + id)
    return capability
  }

  findDownload(url: string): NetworkSource {
    const parsed = new URL(url)
    if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Unsupported source URL')
    const source = this.listAll().find((entry) => entry.download?.matchesUrl(parsed))
    if (!source) {
      const unavailable = [...this.declared.values()].find((entry) =>
        entry.downloadDomains?.some(
          (domain) => parsed.hostname === domain || parsed.hostname.endsWith('.' + domain)
        )
      )
      if (unavailable) return this.requireEnabled(unavailable.id)
      throw new Error('Unsupported download source')
    }
    return this.requireEnabled(source.id)
  }
}
