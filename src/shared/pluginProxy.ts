export type PluginProxyMode = 'direct' | 'system' | 'custom'

export interface PluginProxySettings {
  mode: PluginProxyMode
  url: string
}

export function normalizePluginProxy(value: unknown): PluginProxySettings {
  if (!value || typeof value !== 'object') throw new Error('pluginProxyInvalid')
  const legacy = value as { mode?: unknown; enabled?: unknown; url?: unknown }
  // Migrate the original switch without changing the user's connection choice.
  const mode =
    legacy.mode ??
    (typeof legacy.enabled === 'boolean' ? (legacy.enabled ? 'custom' : 'direct') : undefined)
  const { url } = legacy
  if (
    !['direct', 'system', 'custom'].includes(mode as string) ||
    typeof url !== 'string' ||
    url.length > 2048
  )
    throw new Error('pluginProxyInvalid')
  const text = url.trim()
  if (mode !== 'custom') return { mode: mode as PluginProxyMode, url: text }
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    throw new Error('pluginProxyInvalid')
  }
  if (
    !['http:', 'https:', 'socks5:'].includes(parsed.protocol) ||
    !parsed.hostname ||
    !/^(?:[a-z\d._-]+|\[[a-f\d:.]+\])$/i.test(parsed.hostname) ||
    parsed.port === '0' ||
    parsed.username ||
    parsed.password ||
    (parsed.pathname !== '' && parsed.pathname !== '/') ||
    parsed.search ||
    parsed.hash
  )
    throw new Error('pluginProxyInvalid')
  return { mode, url: `${parsed.protocol}//${parsed.host}` } as PluginProxySettings
}
