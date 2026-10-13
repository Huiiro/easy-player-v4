import type Database from 'better-sqlite3'

/** Keep the latest import day marked, including after an empty rescan or deletion. */
export function refreshNewestSongs(db: Database.Database): void {
  const latest = db
    .prepare(
      'SELECT date(created_at) AS importDay FROM song WHERE datetime(created_at) IS NOT NULL ORDER BY datetime(created_at) DESC, id DESC LIMIT 1'
    )
    .get() as { importDay: string } | undefined
  if (latest) {
    db.prepare(
      `
      UPDATE song
      SET is_newest = CASE WHEN date(created_at) = ? THEN 1 ELSE 0 END
      WHERE is_newest IS NOT CASE WHEN date(created_at) = ? THEN 1 ELSE 0 END
    `
    ).run(latest.importDay, latest.importDay)
    return
  }
  // Legacy rows can have missing dates. Keep at least one latest row selected.
  const latestId = (db.prepare('SELECT MAX(id) AS id FROM song').get() as { id: number | null }).id
  if (latestId === null) return
  db.prepare(
    `
    UPDATE song
    SET is_newest = CASE WHEN id = ? THEN 1 ELSE 0 END
    WHERE is_newest IS NOT CASE WHEN id = ? THEN 1 ELSE 0 END
  `
  ).run(latestId, latestId)
}
