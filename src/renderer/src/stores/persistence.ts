import type { StorageLike } from 'pinia-plugin-persistedstate'

const prefix = 'pinia.'
const fallbackPrefix = 'easy-player.'

/**
 * Synchronous bridge required by pinia-plugin-persistedstate. App settings are
 * stored by the main process in the player_data database; localStorage is only
 * a temporary fallback while the database bridge is unavailable.
 */
export const playerDataStorage: StorageLike = {
  getItem(key) {
    try {
      const response = window.api.database.getSync(`${prefix}${key}`)
      if (response.success && typeof response.data === 'string') return response.data
    } catch {
      // The renderer can start before a development database bridge is ready.
    }
    return localStorage.getItem(`${fallbackPrefix}${key}`)
  },
  setItem(key, value) {
    try {
      const response = window.api.database.saveSync(`${prefix}${key}`, value)
      if (response.success) {
        localStorage.removeItem(`${fallbackPrefix}${key}`)
        return
      }
    } catch {
      // Keep the setting available for this profile until the database recovers.
    }
    localStorage.setItem(`${fallbackPrefix}${key}`, value)
  }
}

export function hasPersistedStore(key: string): boolean {
  try {
    const response = window.api.database.getSync(`${prefix}${key}`)
    return response.success && typeof response.data === 'string'
  } catch {
    return localStorage.getItem(`${fallbackPrefix}${key}`) !== null
  }
}
