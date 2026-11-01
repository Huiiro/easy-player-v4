import type Database from 'better-sqlite3'

export interface DuplicateAnalysisCache {
  get<T>(kind: string, key: string): T | undefined
  set(kind: string, key: string, value: unknown): void
  clear(): void
  setMany?(kind: string, values: Array<{ key: string; value: unknown }>): void
  getMany?<T>(kind: string, keys: string[]): Map<string, T>
}

/** Disposable derived data; separate from songs, playlists and user choices. */
export function createDuplicateAnalysisCache(db: Database.Database): DuplicateAnalysisCache {
  db.exec(`CREATE TABLE IF NOT EXISTS duplicate_analysis_cache (
    kind TEXT NOT NULL, cache_key TEXT NOT NULL, value_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL, PRIMARY KEY (kind, cache_key)
  )`)
  const get = db.prepare(
    'SELECT value_json FROM duplicate_analysis_cache WHERE kind = ? AND cache_key = ?'
  )
  const set = db.prepare(`INSERT INTO duplicate_analysis_cache VALUES (?, ?, ?, ?)
    ON CONFLICT(kind, cache_key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`)
  const writeBatch = db.transaction(
    (kind: string, values: Array<{ key: string; value: unknown }>) => {
      const now = Date.now()
      for (const entry of values) set.run(kind, entry.key, JSON.stringify(entry.value), now)
    }
  )
  const reads = new Map<number, Database.Statement>()
  // Bound storage even when files or algorithms change repeatedly.
  db.prepare('DELETE FROM duplicate_analysis_cache WHERE updated_at < ?').run(
    Date.now() - 30 * 86400_000
  )
  db.exec(`DELETE FROM duplicate_analysis_cache WHERE rowid IN (
    SELECT rowid FROM duplicate_analysis_cache WHERE kind = 'report' ORDER BY updated_at DESC LIMIT -1 OFFSET 20);
    DELETE FROM duplicate_analysis_cache WHERE rowid IN (
    SELECT rowid FROM duplicate_analysis_cache ORDER BY updated_at DESC LIMIT -1 OFFSET 100000)`)
  return {
    get<T>(kind: string, key: string): T | undefined {
      const row = get.get(kind, key) as { value_json: string } | undefined
      if (!row) return undefined
      try {
        return JSON.parse(row.value_json) as T
      } catch {
        return undefined
      }
    },
    set(kind, key, value): void {
      set.run(kind, key, JSON.stringify(value), Date.now())
    },
    setMany(kind, values): void {
      if (values.length) writeBatch(kind, values)
    },
    getMany<T>(kind: string, keys: string[]): Map<string, T> {
      const result = new Map<string, T>()
      for (let offset = 0; offset < keys.length; offset += 128) {
        const batch = keys.slice(offset, offset + 128)
        let statement = reads.get(batch.length)
        if (!statement) {
          statement = db.prepare(
            `SELECT cache_key, value_json FROM duplicate_analysis_cache WHERE kind = ? AND cache_key IN (${batch.map(() => '?').join(',')})`
          )
          reads.set(batch.length, statement)
        }
        for (const row of statement.all(kind, ...batch) as Array<{
          cache_key: string
          value_json: string
        }>) {
          try {
            result.set(row.cache_key, JSON.parse(row.value_json) as T)
          } catch {
            /* Recompute corrupt derived data. */
          }
        }
      }
      return result
    },
    clear(): void {
      db.exec('DELETE FROM duplicate_analysis_cache')
    }
  }
}

/** A forced job reuses only its own completed checkpoints when resumed. */
export function duplicateTaskCache(
  cache: DuplicateAnalysisCache,
  taskId: string,
  force: boolean
): DuplicateAnalysisCache {
  if (!force) return cache
  const scoped = (kind: string): string => `task:${taskId}:${kind}`
  return {
    get: <T>(kind: string, key: string): T | undefined => cache.get<T>(scoped(kind), key),
    set(kind, key, value): void {
      cache.set(scoped(kind), key, value)
      cache.set(kind, key, value)
    },
    getMany: <T>(kind: string, keys: string[]): Map<string, T> =>
      cache.getMany
        ? cache.getMany<T>(scoped(kind), keys)
        : new Map(
            keys
              .map((key) => [key, cache.get<T>(scoped(kind), key)])
              .filter((entry) => entry[1] !== undefined) as Array<[string, T]>
          ),
    setMany(kind, values): void {
      if (cache.setMany) {
        cache.setMany(scoped(kind), values)
        cache.setMany(kind, values)
      } else
        for (const { key, value } of values) {
          cache.set(scoped(kind), key, value)
          cache.set(kind, key, value)
        }
    },
    clear: () => cache.clear()
  }
}
