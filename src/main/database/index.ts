import { t } from '../i18n'
import { logOperation } from '../service/operationLogger'
import Database from 'better-sqlite3'
import { join } from 'node:path'
import { DATABASE_SCHEMA_VERSION, schemaV1 } from './schema'
import { refreshNewestSongs } from './newestSongs'
import { getDataPath } from '../utils/pathUtils'
import { searchSchema } from '../search/schema'
import { normalizeSearchText, japaneseSortReading } from '../search/searchTokens'

let database: Database.Database | undefined

function databasePath(overridePath?: string): string {
  if (overridePath) return overridePath
  return join(getDataPath(), 'player.db')
}

function migrate(db: Database.Database): void {
  db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        version INTEGER PRIMARY KEY,
        applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    const { version } = db
      .prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migration')
      .get() as { version: number }
    if (version >= DATABASE_SCHEMA_VERSION) return

    // V1 is the complete baseline, including the search schema.
    // Add future version migrations after this block.
    if (version < 1) {
      db.exec(schemaV1)
      db.exec(searchSchema)
      db.prepare('INSERT INTO schema_migration (version) VALUES (?)').run(1)
    }
    if (version < 2) {
      // V2 is retained as a compatibility marker; metadata is stored in audio files.
      db.prepare('INSERT INTO schema_migration (version) VALUES (?)').run(2)
    }
  })()
}

/** Opens the local library database and applies pending schema versions. */
export function initDatabase(overridePath?: string): Database.Database {
  return logOperation(
    '[Database] initialize',
    { path: databasePath(overridePath) },
    () => {
      if (database) return database

      const db = new Database(databasePath(overridePath))
      try {
        db.function('search_normalize', { deterministic: true }, normalizeSearchText)
        db.function('search_japanese_sort', { deterministic: true }, japaneseSortReading)
        db.pragma('foreign_keys = ON')
        db.pragma('journal_mode = WAL')
        db.pragma('busy_timeout = 5000')
        migrate(db)
        refreshNewestSongs(db)
        database = db
        return db
      } catch (error) {
        db.close()
        throw error
      }
    },
    { successLevel: 'debug', warnOnFalse: false }
  )
}

export function getDatabase(): Database.Database {
  if (!database) throw new Error(t('databaseNotReady'))
  return database
}

export function closeDatabase(): void {
  return logOperation(
    '[Database] close',
    {},
    () => {
      if (!database) return
      database.close()
      database = undefined
    },
    { successLevel: 'debug', warnOnFalse: false }
  )
}
