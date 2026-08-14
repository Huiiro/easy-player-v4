import type { StorageLike } from 'pinia-plugin-persistedstate'

const prefix = 'pinia.'
const fallbackPrefix = 'easy-player.'
const pendingWrites = new Map<string, string>()
let writeTimer: ReturnType<typeof setTimeout> | undefined

function databaseKey(key: string): string {
  return key.startsWith(prefix) ? key : `${prefix}${key}`
}

function localFallbackKey(key: string): string {
  return `${fallbackPrefix}${databaseKey(key).slice(prefix.length)}`
}

function flushPendingWrites(): void {
  if (writeTimer) clearTimeout(writeTimer)
  writeTimer = undefined
  for (const [key, value] of pendingWrites) {
    try {
      const response = window.api.database.saveSync(key, value)
      if (response.success) localStorage.removeItem(localFallbackKey(key))
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
    const fallbackKey = localFallbackKey(key)
    const pending = localStorage.getItem(fallbackKey)
    if (pending !== null) return pending
    try {
      const response = window.api.database.getSync(databaseKey(key))
      if (response.success && typeof response.data === 'string') return response.data
    } catch {
      // The renderer can start before a development database bridge is ready.
    }
    return localStorage.getItem(fallbackKey)
  },
  setItem(key, value) {
    const storageKey = databaseKey(key)
    // Pinia persists after every reactive change. Keep an immediate recovery copy
    // in the renderer, then coalesce its synchronous SQLite writes.
    localStorage.setItem(localFallbackKey(key), value)
    pendingWrites.set(storageKey, value)
    schedulePendingWrite()
  }
}

export function hasPersistedStore(key: string): boolean {
  if (localStorage.getItem(localFallbackKey(key)) !== null) return true
  try {
    const response = window.api.database.getSync(databaseKey(key))
    return response.success && typeof response.data === 'string'
  } catch {
    return localStorage.getItem(localFallbackKey(key)) !== null
  }
}
