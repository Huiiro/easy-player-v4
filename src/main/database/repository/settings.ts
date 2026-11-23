import { getDatabase } from '../index'
import {
  PLAYBACK_QUEUE_KEY,
  PLAYBACK_SESSION_KEY,
  PLAYBACK_SESSION_STATE_KEY,
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

function writeCompatibleSession(state: object, queue: unknown): void {
  if (!Array.isArray(queue)) throw new Error('Playback queue is missing')
  setAppSetting(PLAYBACK_SESSION_KEY, { ...state, queue, compatible: true })
}

export function prepareCompatiblePlaybackSession(): void {
  const previous = getAppSetting(PLAYBACK_SESSION_KEY) as {
    revision?: number
    queue?: unknown
  } | null
  if (!previous?.revision || Array.isArray(previous.queue)) return
  const queue = getAppSetting(PLAYBACK_QUEUE_KEY)
  if (!Array.isArray(queue)) return
  getDatabase().transaction(() => {
    setAppSetting(PLAYBACK_SESSION_STATE_KEY, previous)
    writeCompatibleSession(previous, queue)
  })()
}

export function flushCompatiblePlaybackSession(): void {
  const previous = getAppSetting(PLAYBACK_SESSION_KEY) as { compatible?: boolean } | null
  if (previous?.compatible !== true) return
  const latest = getAppSetting(PLAYBACK_SESSION_STATE_KEY) as { revision?: number } | null
  if (!latest?.revision) return
  const queue = getAppSetting(PLAYBACK_QUEUE_KEY)
  if (Array.isArray(queue)) writeCompatibleSession(latest, queue)
}

export function savePlaybackSession(
  { revision, state, queue }: PlaybackSessionWrite,
  flush = false
): boolean {
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
      const previous = (getAppSetting(PLAYBACK_SESSION_STATE_KEY) ??
        getAppSetting(PLAYBACK_SESSION_KEY)) as { revision?: number } | null
      // An asynchronous save may reach the main process after a synchronous flush.
      if (typeof previous?.revision === 'number' && previous.revision >= revision) return false
      if (queue === undefined && !previous?.revision) throw new Error('Playback queue is missing')
      if (queue !== undefined) setAppSetting(PLAYBACK_QUEUE_KEY, queue)
      const snapshot = { ...state, revision }
      setAppSetting(PLAYBACK_SESSION_STATE_KEY, snapshot)
      // Keep a complete snapshot for older players, while cursor-only saves stay small.
      if (queue !== undefined || flush)
        writeCompatibleSession(snapshot, queue ?? getAppSetting(PLAYBACK_QUEUE_KEY))
      return true
    })
    .immediate()
}
