import type { PluginManifest } from '../../shared/plugins'
import type { NetworkSource, SourceCallContext } from '../sources/types'

export interface PluginHostServices {
  network: {
    fetch(url: string, init?: RequestInit, call?: SourceCallContext): Promise<Response>
  }
  settings: { get(key: string): unknown; set(key: string, value: unknown): void }
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void
}
export interface PluginHostContext extends PluginHostServices {
  readonly signal: AbortSignal
  registerSource(source: NetworkSource): () => void
  own(cleanup: () => void): () => void
}
/** API v1 runs trusted official packages synchronously in the main process. */
export interface PluginDefinition {
  manifest: PluginManifest
  activate(host: PluginHostContext): void | (() => void)
  deactivate?(): void
}
export interface PluginHostDependencies {
  readSetting(key: string): unknown
  writeSetting(key: string, value: unknown): void
  log(pluginId: string, level: 'debug' | 'info' | 'warn' | 'error', message: string): void
  fetch(url: string, init: RequestInit): Promise<Response>
}
