import { getDatabase } from '../index'
import { getListeningInsights } from '../listeningStats'
import { getLibraryQualityStats } from '../libraryQuality'
import type { OverviewStats } from '../types'

export function getOverviewStats(): OverviewStats {
  const db = getDatabase()
  const overview = db
    .prepare(
      `SELECT COUNT(*) AS songCount, COUNT(DISTINCT NULLIF(album, '')) AS albumCount, COUNT(DISTINCT NULLIF(artist, '')) AS artistCount, COALESCE(SUM(file_size), 0) AS librarySize, (SELECT CAST(COALESCE(SUM(played_ms), 0) / 1000 AS INTEGER) FROM play_history) AS totalPlaySeconds, (SELECT CAST(COALESCE(SUM(played_ms), 0) / 1000 AS INTEGER) FROM play_history WHERE date(started_at / 1000, 'unixepoch', 'localtime') = date('now', 'localtime')) AS todayPlaySeconds FROM song`
    )
    .get() as Pick<
    OverviewStats,
    | 'songCount'
    | 'albumCount'
    | 'artistCount'
    | 'librarySize'
    | 'totalPlaySeconds'
    | 'todayPlaySeconds'
  >
  return { ...overview, ...getListeningInsights(db), quality: getLibraryQualityStats(db) }
}
