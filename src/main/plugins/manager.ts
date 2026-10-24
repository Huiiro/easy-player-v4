import { NETWORK_SOURCE_CAPABILITIES } from '../../shared/networkSources'
import type {
  PluginManifest,
  PluginInfo,
  PluginFailureCode,
  PluginState
} from '../../shared/plugins'
import { SourceCallError } from '../sources/errors'
import type { SourceRegistry } from '../sources/registry'
import type { NetworkSource } from '../sources/types'
import type { PluginDefinition, PluginHostContext, PluginHostDependencies } from './types'
import { hasDownloadLease } from './callLeases'

export class PluginLifecycleError extends Error {
  constructor(readonly code: PluginFailureCode) {
    super(code)
  }
}
interface PluginScope {
  controller: AbortController
  open: boolean
  cleanups: (() => void)[]
}
interface LoadedPlugin {
  definition: PluginDefinition
  info: PluginInfo
  undeclare: () => void
  scope?: PluginScope
}
export function validateManifest(manifest: PluginManifest): PluginManifest {
  const id = (value: unknown): boolean =>
    typeof value === 'string' && /^[a-z][a-z0-9._-]{0,95}$/.test(value)
  if (
    !manifest ||
    !id(manifest.id) ||
    typeof manifest.displayName !== 'string' ||
    !manifest.displayName.trim() ||
    typeof manifest.version !== 'string' ||
    manifest.version.length > 64 ||
    !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(manifest.version) ||
    ![1, 2].includes(manifest.apiVersion) ||
    !Array.isArray(manifest.sources)
  )
    throw new Error('Invalid or incompatible plugin manifest')
  const seen = new Set<string>()
  for (const source of manifest.sources) {
    if (
      !source ||
      !id(source.id) ||
      seen.has(source.id) ||
      typeof source.displayName !== 'string' ||
      !source.displayName.trim() ||
      !Array.isArray(source.capabilities) ||
      !source.capabilities.length ||
      new Set(source.capabilities).size !== source.capabilities.length ||
      source.capabilities.some((capability) => !NETWORK_SOURCE_CAPABILITIES.includes(capability)) ||
      (source.downloadDomains !== undefined &&
        (!source.capabilities.includes('download') ||
          !Array.isArray(source.downloadDomains) ||
          source.downloadDomains.some(
            (domain) =>
              typeof domain !== 'string' ||
              !/^[a-z0-9]+(?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(domain)
          )))
    )
      throw new Error('Invalid plugin source declaration')
    seen.add(source.id)
  }
  return structuredClone(manifest)
}
function settingKey(pluginId: string, key: string): string {
  if (typeof key !== 'string' || !/^[a-zA-Z0-9._-]{1,80}$/.test(key))
    throw new Error('Invalid plugin setting key')
  return 'plugins.data.' + pluginId + ':' + key
}
function jsonValue(value: unknown): unknown {
  const json = JSON.stringify(value, (_key, entry) => {
    if (
      ['undefined', 'function', 'symbol', 'bigint'].includes(typeof entry) ||
      (typeof entry === 'number' && !Number.isFinite(entry)) ||
      (entry &&
        typeof entry === 'object' &&
        !Array.isArray(entry) &&
        Object.prototype.toString.call(entry) !== '[object Object]')
    )
      throw new Error('Invalid plugin setting value')
    return entry
  })
  if (json === undefined || json.length > 65536) throw new Error('Invalid plugin setting value')
  return JSON.parse(json)
}
function requireSynchronous(result: unknown): void {
  if (result && typeof result === 'object' && 'then' in result) {
    void Promise.resolve(result).catch(() => undefined)
    throw new Error('Plugin API v1 requires synchronous lifecycle hooks')
  }
}
export class PluginManager {
  private readonly plugins = new Map<string, LoadedPlugin>()
  private closed = false
  constructor(
    private readonly registry: SourceRegistry,
    private readonly host: PluginHostDependencies
  ) {}
  load(definition: PluginDefinition): void {
    if (this.closed) throw new Error('Plugin manager is closed')
    const manifest = validateManifest(definition.manifest)
    if (
      typeof definition.activate !== 'function' ||
      (definition.deactivate !== undefined && typeof definition.deactivate !== 'function')
    )
      throw new Error('Invalid plugin entry point')
    if (this.plugins.has(manifest.id)) throw new Error('Plugin already loaded')
    const undeclare = this.registry.declare(manifest.id, manifest.version, manifest.sources)
    this.plugins.set(manifest.id, {
      definition: { ...definition, manifest },
      undeclare,
      info: { ...manifest, origin: 'official', enabled: false, state: 'inactive' }
    })
  }
  list(): PluginInfo[] {
    return [...this.plugins.values()].map((plugin) => structuredClone(plugin.info))
  }
  get(id: string): PluginInfo | undefined {
    const info = this.plugins.get(id)?.info
    return info ? structuredClone(info) : undefined
  }
  private log(id: string, level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
    try {
      this.host.log(id, level, message)
    } catch {
      /* Logging cannot interrupt cleanup or activation rollback. */
    }
  }
  private state(plugin: LoadedPlugin, state: PluginState): void {
    plugin.info.state = state
    this.registry.setPluginState(plugin.info.id, state)
  }
  private release(plugin: LoadedPlugin): boolean {
    const scope = plugin.scope
    if (!scope) return true
    let success = true
    for (const cleanup of scope.cleanups.splice(0).reverse()) {
      try {
        cleanup()
      } catch {
        success = false
      }
    }
    scope.open = false
    plugin.scope = undefined
    return success
  }
  activate(id: string): void {
    if (this.closed) throw new Error('Plugin manager is closed')
    const plugin = this.plugins.get(id)
    if (!plugin) throw new Error('Unknown plugin')
    if (plugin.info.state === 'active') return
    if (plugin.info.state === 'activating' || plugin.info.state === 'deactivating')
      throw new Error('Plugin is busy')
    const scope: PluginScope = { controller: new AbortController(), open: true, cleanups: [] }
    plugin.scope = scope
    plugin.info.error = undefined
    this.state(plugin, 'activating')
    const pending = new Map<string, NetworkSource>()
    const disposers = new Map<string, () => void>()
    const requireOpen = (): void => {
      if (!scope.open) throw new Error('Plugin context is closed')
    }
    const own = (cleanup: () => void): (() => void) => {
      requireOpen()
      if (!['active', 'activating'].includes(plugin.info.state) || typeof cleanup !== 'function')
        throw new Error('Invalid plugin resource')
      let owned = true
      const dispose = (): void => {
        if (owned) {
          owned = false
          requireSynchronous(cleanup())
        }
      }
      scope.cleanups.push(dispose)
      return dispose
    }
    const callSignal = (
      call?: import('../sources/types').SourceCallContext,
      signal?: AbortSignal | null,
      timeoutMs = 30000
    ): AbortSignal => {
      const detached = hasDownloadLease(call, id)
      if (!detached) requireOpen()
      const signals = [signal, call?.signal, ...(detached ? [] : [scope.controller.signal])].filter(
        (value): value is AbortSignal => !!value
      )
      const combined = AbortSignal.any([...signals, AbortSignal.timeout(timeoutMs)])
      combined.throwIfAborted()
      return combined
    }
    const services = {
      network: {
        fetch: async (
          url: string,
          init: RequestInit = {},
          call?: import('../sources/types').SourceCallContext
        ): Promise<Response> => {
          const signal = callSignal(call, init.signal)
          return this.host.fetch(url, { ...init, signal })
        }
      },
      media: {
        extractInfo: (
          request: import('../../../packages/plugin-sdk/src/host').MediaInfoRequest,
          call?: import('../sources/types').SourceCallContext
        ): Promise<Record<string, unknown>> => {
          const signal = callSignal(call, undefined, 60000)
          if (!this.host.mediaInfo) throw new SourceCallError('UNSUPPORTED_CAPABILITY', id)
          return this.host.mediaInfo(request, signal)
        }
      },
      settings: {
        get: (key: string): unknown => {
          requireOpen()
          return structuredClone(this.host.readSetting(settingKey(id, key)))
        },
        set: (key: string, value: unknown): void => {
          requireOpen()
          this.host.writeSetting(settingKey(id, key), jsonValue(value))
        }
      },
      log: (level: 'debug' | 'info' | 'warn' | 'error', message: string): void => {
        this.log(id, level, message)
      }
    }
    const context: PluginHostContext = {
      ...services,
      signal: scope.controller.signal,
      own,
      registerSource: (source) => {
        requireOpen()
        const declaration = plugin.info.sources.find((entry) => entry.id === source?.id)
        const capabilities = NETWORK_SOURCE_CAPABILITIES.filter(
          (capability) => !!source[capability]
        )
        if (
          plugin.info.state !== 'activating' ||
          !declaration ||
          pending.has(source.id) ||
          source.apiVersion !== 1 ||
          capabilities.length !== declaration.capabilities.length ||
          capabilities.some((capability) => !declaration.capabilities.includes(capability))
        )
          throw new Error('Plugin source does not match its manifest')
        const required = {
          lyrics: ['search'],
          metadata: ['search', 'get'],
          artwork: ['search'],
          download: ['matchesUrl', 'search', 'parse', 'resolve']
        }
        for (const capability of capabilities) {
          const implementation = source[capability] as unknown as Record<string, unknown>
          if (required[capability].some((method) => typeof implementation[method] !== 'function'))
            throw new Error('Invalid source capability implementation')
        }
        pending.set(source.id, {
          ...source,
          displayName: declaration.displayName,
          version: plugin.info.version
        })
        // Sources become visible only after activation finishes successfully.
        return () => {
          if (plugin.info.state === 'activating') pending.delete(source.id)
          else disposers.get(source.id)?.()
        }
      }
    }
    try {
      const result = plugin.definition.activate(context)
      requireSynchronous(result)
      if (result !== undefined && typeof result !== 'function')
        throw new Error('Invalid plugin activation result')
      if (typeof result === 'function') own(result)
      if (pending.size !== plugin.info.sources.length)
        throw new Error('Plugin did not register its declared sources')
      for (const source of pending.values()) {
        const controller = new AbortController()
        const remove = this.registry.register(source, {
          pluginId: id,
          signal: AbortSignal.any([scope.controller.signal, controller.signal]),
          host: services
        })
        disposers.set(
          source.id,
          own(() => {
            controller.abort(new SourceCallError('SOURCE_DISABLED', source.id))
            remove()
          })
        )
      }
      plugin.info.enabled = true
      this.state(plugin, 'active')
    } catch {
      scope.controller.abort(new SourceCallError('SOURCE_DISABLED'))
      this.release(plugin)
      plugin.info.enabled = false
      plugin.info.error = 'ACTIVATION_FAILED'
      this.state(plugin, 'failed')
      this.log(id, 'error', 'ACTIVATION_FAILED')
      throw new PluginLifecycleError('ACTIVATION_FAILED')
    }
  }
  deactivate(id: string): void {
    const plugin = this.plugins.get(id)
    if (!plugin) throw new Error('Unknown plugin')
    if (['activating', 'deactivating'].includes(plugin.info.state))
      throw new Error('Plugin is busy')
    plugin.info.enabled = false
    if (!plugin.scope) {
      plugin.info.error = undefined
      this.state(plugin, 'inactive')
      return
    }
    this.state(plugin, 'deactivating')
    plugin.scope.controller.abort(new SourceCallError('SOURCE_DISABLED'))
    let success = true
    try {
      requireSynchronous(plugin.definition.deactivate?.())
    } catch {
      success = false
    }
    success = this.release(plugin) && success
    plugin.info.error = success ? undefined : 'CLEANUP_FAILED'
    this.state(plugin, success ? 'inactive' : 'failed')
    if (!success) this.log(id, 'warn', 'CLEANUP_FAILED')
  }
  unload(id: string): void {
    const plugin = this.plugins.get(id)
    if (!plugin) return
    this.deactivate(id)
    plugin.undeclare()
    this.plugins.delete(id)
  }
  shutdown(): void {
    this.closed = true
    for (const id of [...this.plugins.keys()].reverse()) this.unload(id)
  }
}
