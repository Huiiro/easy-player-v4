import { getDatabase } from '../index'
import { buildSongSearchFilter } from '../../search/searchQuery'
import type { PagedResult, PlayHistoryDay, RankedSong, Song, SongQuery } from '../types'
import { songColumnsFor, relevanceOrder, attachTags, mapSong, type SongRow } from './songHelpers'

export function savePlayHistory(
  songId: number,
  startedAt: number,
  startOrigin: 'automatic' | 'manual' | 'search' | 'return' | 'recommendation'
): void {
  if (!Number.isInteger(songId) || songId <= 0 || !Number.isFinite(startedAt)) return
  const db = getDatabase()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO history (song_id, play_time) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(song_id) DO UPDATE SET play_time = CURRENT_TIMESTAMP`
    ).run(songId)
    db.prepare('UPDATE song SET play_times = play_times + 1 WHERE id = ?').run(songId)
    db.prepare(
      `INSERT INTO play_history (song_id, started_at, start_origin)
       SELECT ?, ?, ? WHERE NOT EXISTS (
         SELECT 1 FROM play_history WHERE song_id = ? AND started_at = ?
       )`
    ).run(songId, Math.trunc(startedAt), startOrigin, songId, Math.trunc(startedAt))
  })()
}

export function queryRecentPlayedSongs(
  query: SongQuery = {}
): PagedResult<Song & { playTime: string }> {
  const db = getDatabase()
  const size =
    query.size && Number.isFinite(query.size) && query.size > 0 ? Math.floor(query.size) : undefined
  const offset = size ? Math.max(0, (query.page ?? 1) - 1) * size : 0
  const where = ['1 = 1']
  const params: Record<string, string | number> = {}
  if (size) {
    params.size = size
    params.offset = offset
  }
  const searchFilter = buildSongSearchFilter(db, query.search, 's.')
  if (searchFilter.sql) where.push(searchFilter.sql)
  Object.assign(params, searchFilter.params)
  if (query.source === 'local') where.push('s.source_id IS NULL')
  if (query.source === 'remote') {
    where.push(query.sourceId ? 's.source_id = @sourceId' : 's.source_id IS NOT NULL')
    if (query.sourceId) params.sourceId = query.sourceId
  }
  const clause = `WHERE ${where.join(' AND ')}`
  const allowed = new Set(['play_time', 'title', 'artist', 'album', 'duration', 'created_at'])
  const sort = allowed.has(query.sortBy ?? '') ? query.sortBy! : 'play_time'
  const column = sort === 'play_time' ? 'h.play_time' : `s.${sort}`
  const order = query.sortOrder === 'asc' ? 'ASC' : 'DESC'
  const pagination = size ? 'LIMIT @size OFFSET @offset' : ''
  const rows = db
    .prepare(
      `SELECT ${songColumnsFor('s.')}, ${searchFilter.score} AS searchScore, strftime('%Y-%m-%dT%H:%M:%fZ', h.play_time) AS playTime FROM history h JOIN song s ON s.id = h.song_id ${clause} ORDER BY ${relevanceOrder(searchFilter.sql, query)}${column} ${order} ${pagination}`
    )
    .all(params)
  const data = attachTags(
    rows.map((row) => mapSong(row as SongRow) as Song & { playTime: string })
  ) as Array<Song & { playTime: string }>
  const total = (
    db
      .prepare(`SELECT COUNT(*) AS count FROM history h JOIN song s ON s.id = h.song_id ${clause}`)
      .get(params) as { count: number }
  ).count
  return { data, total }
}

export function clearRecentPlayedSongs(): void {
  getDatabase().prepare('DELETE FROM history').run()
}

export function getPlayHistoryDays(days = 365): PlayHistoryDay[] {
  return getDatabase()
    .prepare(
      "SELECT DATE(started_at / 1000, 'unixepoch', 'localtime') AS date, CAST(SUM(played_ms) / 1000 AS INTEGER) AS seconds FROM play_history WHERE started_at >= (strftime('%s', DATE('now', 'localtime', '-' || ? || ' days')) * 1000) GROUP BY DATE(started_at / 1000, 'unixepoch', 'localtime') ORDER BY date"
    )
    .all(Math.max(1, days)) as PlayHistoryDay[]
}

export function getTopPlayedSongs(limit = 10): RankedSong[] {
  return getDatabase()
    .prepare(
      `SELECT ${songColumnsFor('song.')}, COUNT(ph.id) AS value FROM play_history ph JOIN song ON song.id = ph.song_id GROUP BY song.id ORDER BY value DESC LIMIT ?`
    )
    .all(Math.max(1, limit))
    .map((row) => ({
      ...mapSong(row as SongRow),
      value: (row as { value: number }).value
    }))
}

export function getTopDurationSongs(limit = 10): RankedSong[] {
  return getDatabase()
    .prepare(
      `SELECT ${songColumnsFor('song.')}, CAST(COALESCE(SUM(ph.played_ms), 0) / 1000 AS INTEGER) AS value FROM play_history ph JOIN song ON song.id = ph.song_id GROUP BY song.id ORDER BY value DESC LIMIT ?`
    )
    .all(Math.max(1, limit))
    .map((row) => ({
      ...mapSong(row as SongRow),
      value: (row as { value: number }).value
    }))
}
