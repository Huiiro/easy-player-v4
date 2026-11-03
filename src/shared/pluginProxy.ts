export interface PluginProxySettings {
  enabled: boolean
  url: string
}

export function normalizePluginProxy(value: unknown): PluginProxySettings {
  if (!value || typeof value !== 'object') throw new Error('pluginProxyInvalid')
  const { enabled, url } = value as Partial<PluginProxySettings>
  if (typeof enabled !== 'boolean' || typeof url !== 'string' || url.length > 2048)
    throw new Error('pluginProxyInvalid')
  const text = url.trim()
  if (!text && !enabled) return { enabled, url: '' }
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
  return { enabled, url: `${parsed.protocol}//${parsed.host}` }
}
