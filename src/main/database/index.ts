import Database from 'better-sqlite3'
import { join } from 'node:path'
import { DATABASE_SCHEMA_VERSION, schemaV1 } from './schema'
import { getDataPath } from '../utils/pathUtils'

let database: Database.Database | undefined

function databasePath(overridePath?: string): string {
  if (overridePath) return overridePath
  return join(getDataPath(), 'player.db')
}

function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migration (
      version INTEGER PRIMARY KEY,
      applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `)

  const currentVersion = db
    .prepare('SELECT MAX(version) AS version FROM schema_migration')
    .get() as { version: number | null }
  const version = currentVersion.version ?? 0
  if (version >= DATABASE_SCHEMA_VERSION) return

  db.transaction(() => {
    if (version < 1) {
      db.exec(schemaV1)
      db.prepare('INSERT OR IGNORE INTO schema_migration (version) VALUES (1)').run()
    }
  })()
}

/** Opens the local library database and applies all pending migrations. */
export function initDatabase(overridePath?: string): Database.Database {
  if (database) return database

  const db = new Database(databasePath(overridePath))
  try {
    db.pragma('foreign_keys = ON')
    db.pragma('journal_mode = WAL')
    db.pragma('busy_timeout = 5000')
    migrate(db)
    database = db
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

export function getDatabase(): Database.Database {
  if (!database) throw new Error('Database has not been initialized')
  return database
}

export function closeDatabase(): void {
  if (!database) return
  database.close()
  database = undefined
}
