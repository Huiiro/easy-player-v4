import { existsSync, statSync, unlinkSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { getDatabase } from '../index'
import { invalidateDailyRecommendations } from '../recommendations'
import { refreshNewestSongs } from '../newestSongs'
import { buildSongSearchFilter } from '../../search/searchQuery'
import { getDataPath } from '../../utils/pathUtils'
import type { PagedResult, Song, SongQuery } from '../types'
import { attachTags, songColumns, relevanceOrder, mapSong, type SongRow } from './songHelpers'
import { refreshPlaylistCover } from './playlists'

export function querySongs(query: SongQuery = {}): PagedResult<Song> {
  const db = getDatabase()
  const where: string[] = []
  const params: Record<string, string | number> = {}
  if (query.preference === -1 || query.preference === 0 || query.preference === 1) {
    where.push('preference = @preference')
    params.preference = query.preference
  }
  const searchFilter = buildSongSearchFilter(db, query.search)
  if (searchFilter.sql) where.push(searchFilter.sql)
  Object.assign(params, searchFilter.params)
  if (query.source === 'local') where.push('source_id IS NULL')
  if (query.source === 'remote') {
    where.push(query.sourceId ? 'source_id = @sourceId' : 'source_id IS NOT NULL')
    if (query.sourceId) params.sourceId = query.sourceId
  }
  if (query.tags?.length) {
    const keys = query.tags.map((id, index) => {
      const key = `tag${index}`
      params[key] = id
      return `@${key}`
    })
    params.tagCount = query.tags.length
    where.push(
      `id IN (SELECT song_id FROM song_tag WHERE tag_id IN (${keys.join(',')}) GROUP BY song_id HAVING COUNT(DISTINCT tag_id) = @tagCount)`
    )
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const allowed = new Set(['id', 'title', 'artist', 'album', 'duration', 'created_at'])
  const sort = allowed.has(query.sortBy ?? '') ? query.sortBy! : 'id'
  const order = query.sortOrder ? (query.sortOrder === 'desc' ? 'DESC' : 'ASC') : 'DESC'
  const size =
    query.size && Number.isFinite(query.size) && query.size > 0 ? Math.floor(query.size) : undefined
  if (size) {
    params.size = size
    params.offset = Math.max(0, (query.page ?? 1) - 1) * size
  }
  const pagination = size ? 'LIMIT @size OFFSET @offset' : ''
  const data = attachTags(
    db
      .prepare(
        `SELECT ${songColumns}, ${searchFilter.score} AS searchScore FROM song ${clause} ORDER BY ${relevanceOrder(searchFilter.sql, query)}${sort} ${order} ${pagination}`
      )
      .all(params)
      .map((row) => mapSong(row as SongRow))
  )
  const total = (
    db.prepare(`SELECT COUNT(*) AS count FROM song ${clause}`).get(params) as { count: number }
  ).count
  return { data, total }
}

export function getSong(id: number): Song | null {
  const row = getDatabase().prepare(`SELECT ${songColumns} FROM song WHERE id = ?`).get(id) as
    SongRow | undefined
  return row ? attachTags([mapSong(row)])[0] : null
}

export function updateSongCoverAnalysis(
  id: number,
  analysis: {
    path: string
    primary: string
    secondary: string
    lyricsDark: boolean
    version: number
  }
): void {
  getDatabase()
    .prepare(
      `UPDATE song SET cover_analysis_path = ?, cover_primary = ?, cover_secondary = ?,
       cover_lyrics_dark = ?, cover_analysis_version = ? WHERE id = ?`
    )
    .run(
      analysis.path,
      analysis.primary,
      analysis.secondary,
      analysis.lyricsDark ? 1 : 0,
      analysis.version,
      id
    )
}

export function queryAllSongs(): Song[] {
  return attachTags(
    getDatabase()
      .prepare(`SELECT ${songColumns} FROM song ORDER BY id`)
      .all()
      .map((row) => mapSong(row as SongRow))
  )
}

export function updateSongLyrics(
  id: number,
  payload: {
    lrc: string
    lyricFormat?: string
    translation?: string
    translationFormat?: string
    romanization?: string
    romanizationFormat?: string
  }
): boolean {
  const result = getDatabase()
    .prepare(
      `UPDATE song
       SET lrc = @lrc,
           lyric_format = @lyricFormat,
           translation = @translation,
           translation_format = @translationFormat,
           romanization = @romanization,
           romanization_format = @romanizationFormat
       WHERE id = @id`
    )
    .run({ id, ...payload })
  return result.changes > 0
}

export function setSongStatus(id: number, status: number): boolean {
  return (
    getDatabase().prepare('UPDATE song SET song_status = ? WHERE id = ?').run(status, id).changes >
    0
  )
}

export function refreshMissingSongStatus(): void {
  const db = getDatabase()
  const update = db.prepare('UPDATE song SET song_status = 1 WHERE id = ?')
  for (const row of db.prepare('SELECT id, audio FROM song WHERE song_status = 0').all() as Array<{
    id: number
    audio: string
  }>)
    if (existsSync(row.audio)) update.run(row.id)
}

/** Checks local library paths and synchronizes their availability status. */
export function checkMissingSongs(): { songIds: number[] } {
  const db = getDatabase()
  const localSongs = db
    .prepare('SELECT id, audio FROM song WHERE source_id IS NULL')
    .all() as Array<{ id: number; audio: string }>
  const checkedSongs = localSongs.map((song) => ({ ...song, available: existsSync(song.audio) }))
  const missingIds = checkedSongs.filter((song) => !song.available).map((song) => song.id)
  const availableIds = checkedSongs.filter((song) => song.available).map((song) => song.id)

  db.transaction(() => {
    const update = db.prepare('UPDATE song SET song_status = ? WHERE id = ?')
    missingIds.forEach((id) => update.run(0, id))
    availableIds.forEach((id) => update.run(1, id))
  })()
  return { songIds: missingIds }
}

export interface DeleteSongsResult {
  deleted: number
  deletedFiles: number
  failedFiles: string[]
}

/** Removes songs and their FK-cascaded metadata; local files are opt-in. */
export function deleteSongs(songIds: number[], deleteLocalFiles = false): DeleteSongsResult {
  const ids = [...new Set(songIds.filter((id) => Number.isInteger(id) && id > 0))]
  if (!ids.length) return { deleted: 0, deletedFiles: 0, failedFiles: [] }

  const db = getDatabase()
  const placeholders = ids.map(() => '?').join(',')
  const songs = db
    .prepare(
      `SELECT id, audio, cover, source_id AS sourceId FROM song WHERE id IN (${placeholders})`
    )
    .all(...ids) as Array<{
    id: number
    audio: string
    cover: string | null
    sourceId: number | null
  }>
  const affectedPlaylistIds = (
    db
      .prepare(
        `SELECT DISTINCT song_list_id FROM song_list_item WHERE song_id IN (${placeholders})`
      )
      .all(...ids) as Array<{ song_list_id: number }>
  ).map((row) => row.song_list_id)
  const covers = songs.map((song) => song.cover).filter((cover): cover is string => !!cover)

  const deleted = db.transaction(() => {
    const count = db.prepare(`DELETE FROM song WHERE id IN (${placeholders})`).run(...ids).changes
    if (count) {
      refreshNewestSongs(db)
      invalidateDailyRecommendations()
    }
    affectedPlaylistIds.forEach(refreshPlaylistCover)
    return count
  })()

  const failedFiles: string[] = []
  let deletedFiles = 0
  if (deleteLocalFiles) {
    for (const song of songs) {
      if (song.sourceId !== null || !isAbsolute(song.audio) || !existsSync(song.audio)) continue
      try {
        if (statSync(song.audio).isFile()) {
          unlinkSync(song.audio)
          deletedFiles++
        }
      } catch {
        failedFiles.push(song.audio)
      }
    }
  }

  // Embedded covers created by the local scanner are owned by player_data.
  // Remove only orphaned assets; shared/custom covers are deliberately kept.
  const coverDirectory = resolve(join(getDataPath(), 'covers'))
  for (const cover of new Set(covers)) {
    const resolvedCover = resolve(cover)
    const coverRelativePath = relative(coverDirectory, resolvedCover)
    if (
      coverRelativePath.startsWith('..') ||
      isAbsolute(coverRelativePath) ||
      !existsSync(resolvedCover) ||
      db.prepare('SELECT 1 FROM song WHERE cover = ? LIMIT 1').get(cover)
    )
      continue
    try {
      if (statSync(resolvedCover).isFile()) unlinkSync(resolvedCover)
    } catch {
      // A stale artwork file must not make the already-completed DB deletion fail.
    }
  }
  return { deleted, deletedFiles, failedFiles }
}
