// Runtime policy shared by the engine and optional background services.
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

export function waitForBackgroundWork(): Promise<void> {
  return playbackOnly ? new Promise((resolve) => waiters.add(resolve)) : Promise.resolve()
}

export function requireBackgroundWork(): void {
  if (playbackOnly) throw new Error('轻量模式已暂停后台任务，请退出该模式后重试。')
}
