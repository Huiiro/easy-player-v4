import type Database from 'better-sqlite3'
import { SEARCH_INDEX_VERSION } from './searchTokens'
import type { SearchFields, SearchTerms } from './searchTokens'

export interface PendingSearchRow extends SearchFields {
  id: number
  revision: string
  attempts: number
}

export function readSearchIndexCounts(
  db: Database.Database,
  now = Date.now()
): {
  total: number
  indexed: number
  pending: number
  retrying: number
  ready: number
  nextRetryAt: number | null
} {
  return db
    .prepare(
      `SELECT
    (SELECT COUNT(*) FROM song) AS total,
    (SELECT COUNT(*) FROM song_search WHERE version=@version) AS indexed,
    COUNT(*) AS pending,
    COALESCE(SUM(attempts > 0),0) AS retrying,
    COALESCE(SUM(retry_at <= @now),0) AS ready,
    MIN(CASE WHEN retry_at > @now THEN retry_at END) AS nextRetryAt
    FROM song_search_pending`
    )
    .get({ version: SEARCH_INDEX_VERSION, now }) as ReturnType<typeof readSearchIndexCounts>
}

export function queueOutdatedSearchIndexes(db: Database.Database): void {
  db.prepare(
    `INSERT OR IGNORE INTO song_search_pending(song_id)
    SELECT s.id FROM song s LEFT JOIN song_search i ON i.song_id=s.id
    WHERE i.song_id IS NULL OR i.version != ?`
  ).run(SEARCH_INDEX_VERSION)
  db.prepare('DELETE FROM song_search WHERE version != ?').run(SEARCH_INDEX_VERSION)
}

export function pendingSearchRows(db: Database.Database, now = Date.now()): PendingSearchRow[] {
  return db
    .prepare(
      `SELECT s.id, s.title, s.artist, s.album, s.file_name AS fileName,
    p.revision, p.attempts FROM song_search_pending p JOIN song s ON s.id=p.song_id
    WHERE p.retry_at <= ? ORDER BY p.retry_at, p.song_id LIMIT 100`
    )
    .all(now) as PendingSearchRow[]
}

/** The revision check and index/queue changes must be one database transaction. */
export function commitSearchTerms(
  db: Database.Database,
  row: PendingSearchRow,
  terms: SearchTerms,
  complete: boolean,
  now = Date.now()
): boolean {
  return db.transaction(() => {
    const pending = db
      .prepare('SELECT revision FROM song_search_pending WHERE song_id=?')
      .get(row.id) as { revision: string } | undefined
    if (pending?.revision !== row.revision) return false
    db.prepare(
      `INSERT INTO song_search(song_id,title,artist,album,file_name,version)
      VALUES(?,?,?,?,?,?) ON CONFLICT(song_id) DO UPDATE SET title=excluded.title,
      artist=excluded.artist,album=excluded.album,file_name=excluded.file_name,version=excluded.version`
    ).run(row.id, terms.title, terms.artist, terms.album, terms.fileName, SEARCH_INDEX_VERSION)
    if (complete) db.prepare('DELETE FROM song_search_pending WHERE song_id=?').run(row.id)
    else
      db.prepare(
        'UPDATE song_search_pending SET attempts=attempts+1,retry_at=? WHERE song_id=?'
      ).run(now + Math.min(30 * 60_000, 30_000 * 2 ** Math.min(row.attempts, 6)), row.id)
    return true
  })()
}
