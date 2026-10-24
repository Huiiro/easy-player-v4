export type {
  PluginHostServices,
  PluginHostContext,
  PluginDefinition
} from '../../../packages/plugin-sdk/src/host'
import type { MediaInfoRequest } from '../../../packages/plugin-sdk/src/host'
export interface PluginHostDependencies {
  readSetting(key: string): unknown
  writeSetting(key: string, value: unknown): void
  log(pluginId: string, level: 'debug' | 'info' | 'warn' | 'error', message: string): void
  mediaInfo?(request: MediaInfoRequest, signal: AbortSignal): Promise<Record<string, unknown>>
  fetch(url: string, init: RequestInit): Promise<Response>
}
