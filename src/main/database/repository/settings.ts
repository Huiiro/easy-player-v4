import { getDatabase } from '../index'
import {
  PLAYBACK_QUEUE_KEY,
  PLAYBACK_SESSION_KEY,
  type PlaybackSessionWrite
} from '../../../shared/playbackSession'

export function getAppSetting(key: string): unknown | null {
  const row = getDatabase().prepare('SELECT value_json FROM app_setting WHERE key = ?').get(key) as
    { value_json?: string } | undefined
  if (!row?.value_json) return null
  try {
    return JSON.parse(row.value_json)
  } catch {
    return null
  }
}

export function setAppSetting(key: string, value: unknown): void {
  getDatabase()
    .prepare(
      `INSERT INTO app_setting (key, value_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP`
    )
    .run(key, JSON.stringify(value))
}

export function savePlaybackSession({ revision, state, queue }: PlaybackSessionWrite): boolean {
  if (
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !state ||
    typeof state !== 'object' ||
    Array.isArray(state) ||
    (queue !== undefined && !Array.isArray(queue))
  ) {
    throw new Error('Invalid playback session')
  }

  return getDatabase()
    .transaction(() => {
      const previous = getAppSetting(PLAYBACK_SESSION_KEY) as { revision?: number } | null
      // An asynchronous save may reach the main process after a synchronous flush.
      if (typeof previous?.revision === 'number' && previous.revision >= revision) return false
      if (queue === undefined && !previous?.revision) throw new Error('Playback queue is missing')
      if (queue !== undefined) setAppSetting(PLAYBACK_QUEUE_KEY, queue)
      setAppSetting(PLAYBACK_SESSION_KEY, { ...state, revision })
      return true
    })
    .immediate()
}
