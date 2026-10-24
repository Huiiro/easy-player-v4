import type { PluginManifest } from './plugins'
import type { NetworkSource, SourceCallContext } from './source'

export interface PluginHostServices {
  network: {
    fetch(url: string, init?: RequestInit, call?: SourceCallContext): Promise<Response>
  }
  /** Host builds all tool arguments; plugins never supply commands or output paths. */
  media?: {
    extractInfo(
      request: MediaInfoRequest,
      call?: SourceCallContext
    ): Promise<Record<string, unknown>>
  }
  settings: { get(key: string): unknown; set(key: string, value: unknown): void }
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void
}
export interface PluginHostContext extends PluginHostServices {
  readonly signal: AbortSignal
  registerSource(source: NetworkSource): () => void
  own(cleanup: () => void): () => void
}
/** Plugin lifecycle hooks are synchronous; source calls are asynchronous. */
export interface PluginDefinition {
  manifest: PluginManifest
  activate(host: PluginHostContext): void | (() => void)
  deactivate?(): void
}

export type MediaInfoRequest =
  { type: 'url'; url: string } | { type: 'search'; query: string; limit?: number }
