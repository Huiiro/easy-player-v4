import type { StorageLike } from 'pinia-plugin-persistedstate'

const prefix = 'pinia.'
const fallbackPrefix = 'easy-player.'
const pendingWrites = new Map<string, string>()
let writeTimer: ReturnType<typeof setTimeout> | undefined

function flushPendingWrites(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = undefined
  for (const [key, value] of pendingWrites) {
    try {
      const response = window.api.database.saveSync(key, value)
      if (response.success) localStorage.removeItem(`${fallbackPrefix}${key.slice(prefix.length)}`)
    } catch {
      // Keep the local copy for the next startup when the database is unavailable.
    }
  }
  pendingWrites.clear()
}

function schedulePendingWrite(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = setTimeout(flushPendingWrites, 400)
}

/** Flushes debounced Pinia preference writes before a renderer is destroyed. */
export function flushPlayerDataStorage(): void {
  flushPendingWrites()
}

/**
 * Synchronous bridge required by pinia-plugin-persistedstate. App settings are
 * stored by the main process in the player_data database; localStorage is only
 * a temporary fallback while the database bridge is unavailable.
 */
export const playerDataStorage: StorageLike = {
  getItem(key) {
    const fallbackKey = `${fallbackPrefix}${key.slice(prefix.length)}`
    const pending = localStorage.getItem(fallbackKey)
    if (pending !== null) return pending
    try {
      const response = window.api.database.getSync(`${prefix}${key}`)
      if (response.success && typeof response.data === 'string') return response.data
    } catch {
      // The renderer can start before a development database bridge is ready.
    }
    return localStorage.getItem(fallbackKey)
  },
  setItem(key, value) {
    const storageKey = `${prefix}${key}`
    // Pinia persists after every reactive change. Keep an immediate recovery copy
    // in the renderer, then coalesce its synchronous SQLite writes.
    localStorage.setItem(`${fallbackPrefix}${key}`, value)
    pendingWrites.set(storageKey, value)
    schedulePendingWrite()
  }
}

export function hasPersistedStore(key: string): boolean {
  if (localStorage.getItem(`${fallbackPrefix}${key}`) !== null) return true
  try {
    const response = window.api.database.getSync(`${prefix}${key}`)
    return response.success && typeof response.data === 'string'
  } catch {
    return localStorage.getItem(`${fallbackPrefix}${key}`) !== null
  }
}
