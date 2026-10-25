export type PluginLogLevel = 'debug' | 'info' | 'warn' | 'error'
export interface PluginLogContext {
  pluginId: string
  version?: string
  sourceId?: string
  operation?: string
  code?: string
  elapsedMs?: number
  callId?: number
}
export interface PluginLogEntry {
  id: number
  timestamp: number
  level: PluginLogLevel
  source: 'main' | 'native' | 'renderer' | 'preload'
  message: string
  plugin: PluginLogContext
}

/** Bound and redact diagnostic text before it reaches files or renderer events. */
export function redactPluginLog(value: unknown): string {
  const input = value instanceof Error ? value.message : typeof value === 'string' ? value : ''
  return input
    .slice(0, 16384)
    .replace(/https?:\/\/[^\s"'<>]+/gi, (value) => {
      try {
        const url = new URL(value)
        return `${url.protocol}//${url.host}${url.pathname}`
      } catch {
        return '[invalid URL]'
      }
    })
    .replace(
      /\b(?:authorization|proxy-authorization|cookie|set-cookie)["']?\s*[:=][^\r\n]*/gi,
      '[redacted header]'
    )
    .replace(
      /(["']?(?:access[_-]?token|refresh[_-]?token|token|password|secret|api[_-]?key)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,
      '$1[redacted]'
    )
    .replace(/\bBearer\s+[a-z0-9._~+/-]+=*/gi, 'Bearer [redacted]')
    .replace(/\r\n|\r|\n/g, '\\n')
    .slice(0, 4096)
}

export function pluginLogContext(value: PluginLogContext): PluginLogContext | undefined {
  if (
    !value ||
    typeof value.pluginId !== 'string' ||
    !/^[a-z][a-z0-9._-]{0,95}$/.test(value.pluginId)
  )
    return undefined
  const result: PluginLogContext = { pluginId: value.pluginId }
  for (const key of ['version', 'sourceId', 'operation', 'code'] as const) {
    const field = value[key]
    if (typeof field === 'string' && /^[a-zA-Z0-9._:-]{1,96}$/.test(field)) result[key] = field
  }
  for (const key of ['elapsedMs', 'callId'] as const) {
    const field = value[key]
    if (typeof field === 'number' && Number.isFinite(field) && field >= 0)
      result[key] = Math.round(field)
  }
  return result
}
