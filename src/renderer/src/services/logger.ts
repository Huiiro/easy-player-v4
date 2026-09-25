function format(value: unknown): string {
  if (value instanceof Error) return value.stack || value.message
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

// Preserve DevTools output while forwarding application console calls to the
// main process, which owns the log file and the in-app log stream.
export function installRendererLogging(): void {
  for (const level of ['debug', 'info', 'warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...values: unknown[]): void => {
      original(...values)
      window.api.log.write(level, values.map(format).join(' '))
    }
  }
  const originalLog = console.log.bind(console)
  console.log = (...values: unknown[]): void => {
    originalLog(...values)
    window.api.log.write('info', values.map(format).join(' '))
  }
}
