import type { PluginSourceManifest } from '../../src/shared/plugins'
import type { NetworkSource } from '../../src/main/sources/types'
import type { PluginDefinition, PluginHostContext } from '../../src/main/plugins/types'

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
      apiVersion: 1,
      sources: [source]
    },
    activate(host) {
      host.registerSource(create(host))
    }
  }
}
