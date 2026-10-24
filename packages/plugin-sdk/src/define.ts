import type { PluginSourceManifest } from './plugins'
import type { NetworkSource } from './source'
import type { PluginDefinition, PluginHostContext } from './host'

export function defineSourcePlugin(
  source: PluginSourceManifest,
  create: (host: PluginHostContext) => NetworkSource,
  version = '1.0.0'
): PluginDefinition {
  return {
    manifest: {
      id: 'builtin.' + source.id,
      displayName: source.displayName,
      version,
      apiVersion: 2,
      sources: [source]
    },
    activate(host) {
      host.registerSource(create(host))
    }
  }
}
