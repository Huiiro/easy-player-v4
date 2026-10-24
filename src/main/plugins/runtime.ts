import { SourceRegistry } from '../sources/registry'
import { PluginManager } from './manager'
import type { PluginHostDependencies } from './types'
import { SourceCallError } from '../sources/errors'

let dependencies: PluginHostDependencies = {
  readSetting() {
    throw new Error('Plugin storage is not initialized')
  },
  writeSetting() {
    throw new Error('Plugin storage is not initialized')
  },
  log() {
    /* Host logging is configured after the application database opens. */
  },
  fetch: (url, init) => fetch(url, init)
}
export function configurePluginHost(host: PluginHostDependencies): void {
  dependencies = host
}
let runtime: { registry: SourceRegistry; manager: PluginManager } | undefined
function getRuntime(): NonNullable<typeof runtime> {
  if (!runtime) {
    const registry = new SourceRegistry()
    const manager = new PluginManager(registry, {
      readSetting: (key) => dependencies.readSetting(key),
      writeSetting: (key, value) => dependencies.writeSetting(key, value),
      log: (id, level, message) => dependencies.log(id, level, message),
      fetch: (url, init) => dependencies.fetch(url, init),
      mediaInfo: (request, signal) => {
        if (!dependencies.mediaInfo) throw new SourceCallError('UNSUPPORTED_CAPABILITY')
        return dependencies.mediaInfo(request, signal)
      }
    })
    runtime = { registry, manager }
  }
  return runtime
}
export function getPluginManager(): PluginManager {
  return getRuntime().manager
}
export function getSourceRegistry(): SourceRegistry {
  return getRuntime().registry
}
export function shutdownPlugins(): void {
  runtime?.manager.shutdown()
}
