import type Database from 'better-sqlite3'

interface V4PlayHistoryRow {
  id: number
  song_id: number
  playlist_id: number | null
  playlist_name: string | null
  played_seconds: number | null
  started_at: unknown
  created_at: unknown
}

export interface PlayHistoryMigrationResult {
  historyRows: number
}

export interface PlayHistorySchemaV5 {
  prepare: string
  complete: string
}

function milliseconds(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  let timestamp: number
  if (typeof value === 'number') timestamp = value
  else if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim()))
    timestamp = Number(value)
  else if (typeof value === 'string') {
    const normalized = value.trim().replace(' ', 'T')
    timestamp = Date.parse(
      /(?:Z|[+-]\d{2}:?\d{2})$/i.test(normalized) ? normalized : `${normalized}Z`
    )
  } else return null
  if (!Number.isFinite(timestamp) || timestamp < 0) return null
  return Math.trunc(timestamp < 100_000_000_000 ? timestamp * 1000 : timestamp)
}

function nonnegativeInteger(value: unknown): number | null {
  const number = Number(value)
  return value !== null && value !== undefined && Number.isFinite(number) && number >= 0
    ? Math.trunc(number)
    : null
}

/** Converts the released v4 play_history layout to v5. */
export function migratePlayHistory(
  db: Database.Database,
  schema: PlayHistorySchemaV5
): PlayHistoryMigrationResult {
  return db.transaction(() => {
    db.exec(schema.prepare)
    const insertHistory = db.prepare(`
      INSERT INTO play_history_v5
        (id, song_id, playlist_id, playlist_name, started_at, created_at,
         played_ms, duration_ms, end_reason, start_origin, ended_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const rows = db
      .prepare(
        `SELECT id, song_id, playlist_id, playlist_name, played_seconds, started_at, created_at
         FROM play_history ORDER BY id`
      )
      .all() as V4PlayHistoryRow[]
    for (const row of rows) {
      const startedAt = milliseconds(row.started_at) ?? milliseconds(row.created_at)
      if (startedAt === null) throw new Error(`Invalid play_history timestamp at id ${row.id}`)
      const createdAt = milliseconds(row.created_at) ?? startedAt
      insertHistory.run(
        row.id,
        row.song_id,
        row.playlist_id,
        row.playlist_name,
        startedAt,
        createdAt,
        (nonnegativeInteger(row.played_seconds) ?? 0) * 1000,
        null,
        null,
        'automatic',
        null
      )
    }
    db.exec(schema.complete)
    if ((db.pragma('foreign_key_check(play_history)') as unknown[]).length)
      throw new Error('Migrated play_history contains invalid foreign keys')
    return { historyRows: rows.length }
  })()
}
