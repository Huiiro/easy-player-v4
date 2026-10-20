import type Database from 'better-sqlite3'
import { DATABASE_SCHEMA_VERSION, schemaV1 } from '../../src/main/database/schema'
import { searchSchema } from '../../src/main/search/schema'
import { normalizeSearchText, japaneseSortReading } from '../../src/main/search/searchTokens'

const searchTables = [
  'song_search',
  'song_fts',
  'song_search_pending',
  'song_original_fts',
  'song_sort_reading'
]

export function needsMigration(db: Database.Database): boolean {
  const version = (
    db.prepare('SELECT MAX(version) AS version FROM schema_migration').get() as {
      version: number
    }
  ).version
  const columns = (table: string): Set<string> =>
    new Set((db.pragma(`table_info(${table})`) as { name: string }[]).map((row) => row.name))
  // The supported starting point is b0947bc3 (V5). Never reinterpret pre-V5
  // play-history timestamps or an unknown future schema as the current baseline.
  if (
    ![1, 5, 6, 7, 8].includes(version) ||
    !columns('play_history').has('played_ms') ||
    !columns('song').has('preference')
  ) {
    throw new Error(
      'Unsupported database: this tool supports legacy V5–V8 and the current V1 baseline.'
    )
  }
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?")
  return version !== DATABASE_SCHEMA_VERSION || searchTables.some((name) => !hasTable.get(name))
}

export function migrateLegacyLibrary(db: Database.Database): boolean {
  if (!needsMigration(db)) return false
  db.function('search_normalize', { deterministic: true }, normalizeSearchText)
  db.function('search_japanese_sort', { deterministic: true }, japaneseSortReading)
  db.transaction(() => {
    // Only derived search data is discarded. Original song metadata, playlists,
    // settings, sources and history are left intact.
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as {
      name: string
    }[]
    for (const { name } of triggers) {
      if (/^song_(search|original|sort)_/.test(name))
        db.exec(`DROP TRIGGER "${name.replace(/"/g, '""')}"`)
    }
    for (const name of searchTables) db.exec(`DROP TABLE IF EXISTS ${name}`)
    db.exec(schemaV1)
    db.exec(searchSchema)
    db.exec(`
      INSERT INTO song_original_fts(rowid,title,artist,album,file_name)
        SELECT id,search_normalize(COALESCE(title,'')),search_normalize(COALESCE(artist,'')),
          search_normalize(COALESCE(album,'')),search_normalize(COALESCE(file_name,'')) FROM song;
      INSERT INTO song_search_pending(song_id) SELECT id FROM song;
      DELETE FROM schema_migration;
    `)
    db.prepare('INSERT INTO schema_migration(version) VALUES (?)').run(DATABASE_SCHEMA_VERSION)
    if (db.pragma('foreign_key_check').length)
      throw new Error('Foreign-key check failed; migration rolled back.')
    if (db.pragma('integrity_check', { simple: true }) !== 'ok')
      throw new Error('Integrity check failed; migration rolled back.')
  }).immediate()
  return true
}
