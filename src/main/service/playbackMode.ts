// Runtime policy shared by the engine and optional background services.
import {
  assertApplicationActive,
  isApplicationShuttingDown,
  onApplicationShutdown
} from './applicationShutdown'
let playbackOnly = false
const listeners = new Set<(enabled: boolean) => void>()
const waiters = new Set<() => void>()

export const isPlaybackOnly = (): boolean => playbackOnly

export function setPlaybackOnly(enabled: boolean): void {
  if (playbackOnly === enabled) return
  playbackOnly = enabled
  for (const listener of listeners) listener(enabled)
  if (!enabled) {
    for (const resume of waiters) resume()
    waiters.clear()
  }
}

export function onPlaybackModeChanged(listener: (enabled: boolean) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function waitForBackgroundWork(signal?: AbortSignal): Promise<void> {
  if (isApplicationShuttingDown()) return Promise.reject(new Error('Application is shutting down'))
  if (signal?.aborted) return Promise.reject(signal.reason)
  if (!playbackOnly) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const resume = (): void => {
      offShutdown()
      signal?.removeEventListener('abort', cancel)
      resolve()
    }
    const cancel = (): void => {
      offShutdown()
      signal?.removeEventListener('abort', cancel)
      waiters.delete(resume)
      reject(signal?.reason ?? new Error('Application is shutting down'))
    }
    waiters.add(resume)
    const offShutdown = onApplicationShutdown(cancel)
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

export function requireBackgroundWork(): void {
  assertApplicationActive()
  if (playbackOnly) throw new Error('轻量模式已暂停后台任务，请退出该模式后重试。')
}
