let stopping = false
const listeners = new Set<() => void>()
let controller: AbortController | undefined

export const isApplicationShuttingDown = (): boolean => stopping

export function assertApplicationActive(): void {
  if (stopping) throw new Error('Application is shutting down')
}

export function applicationShutdownSignal(): AbortSignal {
  if (!controller) {
    controller = new AbortController()
    onApplicationShutdown(() => controller!.abort(new Error('Application is shutting down')))
  }
  return controller.signal
}

export function onApplicationShutdown(listener: () => void): () => void {
  if (stopping) listener()
  else listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Cancel producers before awaited cleanup and database closure. */
export function beginApplicationShutdown(): void {
  if (stopping) return
  stopping = true
  for (const listener of [...listeners]) listener()
  listeners.clear()
}
