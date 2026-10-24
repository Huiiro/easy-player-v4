import type { NetworkSourceCapability } from './networkSources'

export type PluginState = 'inactive' | 'activating' | 'active' | 'deactivating' | 'failed'
export interface PluginSourceManifest {
  id: string
  displayName: string
  capabilities: NetworkSourceCapability[]
  downloadDomains?: string[]
}
export interface PluginManifest {
  id: string
  displayName: string
  version: string
  apiVersion: 1
  sources: PluginSourceManifest[]
}
export type PluginFailureCode = 'ACTIVATION_FAILED' | 'CLEANUP_FAILED'
export interface PluginInfo extends PluginManifest {
  origin: 'official'
  enabled: boolean
  state: PluginState
  error?: PluginFailureCode
}
export interface OfficialPluginEntry extends PluginManifest {
  url: string
  sha256: string
  size: number
}
export interface OfficialPluginCatalog {
  schemaVersion: 1
  plugins: OfficialPluginEntry[]
}

/** Semantic version ordering for the API v1 manifest's core/prerelease format. */
export function comparePluginVersions(left: string, right: string): number {
  const compare = (a: string, b: string): number => (a === b ? 0 : a < b ? -1 : 1)
  const numeric = (a: string, b: string): number => {
    const x = a.replace(/^0+(?=\d)/, ''),
      y = b.replace(/^0+(?=\d)/, '')
    return x.length === y.length ? compare(x, y) : x.length < y.length ? -1 : 1
  }
  const [aCore, ...aSuffix] = left.split('-'),
    [bCore, ...bSuffix] = right.split('-')
  const a = aCore.split('.'),
    b = bCore.split('.')
  for (let index = 0; index < 3; index++) {
    const order = numeric(a[index], b[index])
    if (order) return order
  }
  const aPre = aSuffix.join('-'),
    bPre = bSuffix.join('-')
  if (!aPre || !bPre) return aPre === bPre ? 0 : aPre ? -1 : 1
  const aParts = aPre.split('.'),
    bParts = bPre.split('.')
  for (let index = 0; index < Math.max(aParts.length, bParts.length); index++) {
    if (aParts[index] === undefined || bParts[index] === undefined)
      return aParts[index] === undefined ? -1 : 1
    const x = aParts[index],
      y = bParts[index]
    const xNumber = /^\d+$/.test(x),
      yNumber = /^\d+$/.test(y)
    const order =
      xNumber && yNumber ? numeric(x, y) : xNumber !== yNumber ? (xNumber ? -1 : 1) : compare(x, y)
    if (order) return order
  }
  return 0
}
