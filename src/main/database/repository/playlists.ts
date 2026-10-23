import { t } from '../../i18n'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getDatabase } from '../index'
import { buildSongSearchFilter } from '../../search/searchQuery'
import { getDataPath } from '../../utils/pathUtils'
import type {
  PagedResult,
  Playlist,
  PlaylistSummary,
  PlaylistInput,
  PlaylistMembership,
  Song,
  SongQuery
} from '../types'
import { getAppSetting, setAppSetting } from './settings'
import { attachTags, songColumnsFor, relevanceOrder, mapSong, type SongRow } from './songHelpers'

export function listPlaylists(): PlaylistSummary[] {
  return getDatabase()
    .prepare(
      `SELECT sl.id, sl.name, COALESCE(sl.custom_cover, sl.cover) AS cover,
        sl.custom_cover AS customCover, sl.description, sl.position, sl.created_at AS createdAt,
        (SELECT COUNT(*) FROM song_list_item sli WHERE sli.song_list_id = sl.id) AS songCount
       FROM song_list sl ORDER BY sl.position, sl.id`
    )
    .all() as PlaylistSummary[]
}

export function getPlaylist(id: number): Playlist | null {
  return (
    (getDatabase()
      .prepare(
        'SELECT id, name, COALESCE(custom_cover, cover) AS cover, custom_cover AS customCover, description, position, created_at AS createdAt FROM song_list WHERE id = ?'
      )
      .get(id) as Playlist | undefined) ?? null
  )
}

export function createPlaylist(input: PlaylistInput): Playlist {
  const db = getDatabase()
  const name = input.name.trim()
  if (!name) throw new Error(t('playlistNameRequired'))
  if (name.length > 64) throw new Error(t('playlistNameTooLong'))
  if (db.prepare('SELECT 1 FROM song_list WHERE name = ? COLLATE NOCASE').get(name)) {
    throw new Error(t('playlistNameExists'))
  }
  const result = db
    .prepare(
      `INSERT INTO song_list (name, cover, custom_cover, description, position) VALUES (?, ?, ?, ?, (SELECT COALESCE(MAX(position), 0) + 1 FROM song_list))`
    )
    .run(name, input.cover ?? null, input.customCover ?? null, input.description ?? null)
  return getPlaylist(Number(result.lastInsertRowid))!
}

export function updatePlaylist(id: number, input: PlaylistInput): boolean {
  const name = input.name.trim()
  if (!name || name.length > 64) throw new Error(t('playlistNameLength'))
  if (
    getDatabase()
      .prepare('SELECT 1 FROM song_list WHERE name = ? COLLATE NOCASE AND id != ?')
      .get(name, id)
  ) {
    throw new Error(t('playlistNameExists'))
  }
  const result = getDatabase()
    .prepare(
      'UPDATE song_list SET name = ?, cover = COALESCE(?, cover), description = ? WHERE id = ?'
    )
    .run(name, input.cover ?? null, input.description ?? null, id)
  return result.changes > 0
}

export function setPlaylistCustomCover(id: number, path: string | null, dataUrl?: string): boolean {
  const db = getDatabase()
  return db.transaction(() => {
    const customCover = savePlaylistCover(path, dataUrl)
    const changed =
      db.prepare('UPDATE song_list SET custom_cover = ? WHERE id = ?').run(customCover, id)
        .changes > 0
    if (changed && !customCover) refreshPlaylistCover(id)
    return changed
  })()
}

const likedPlaylistCoverSetting = 'playlist.liked.customCover'

export function getLikedPlaylistCover(): {
  cover: string | null
  customCover: string | null
  songCount: number
} {
  const saved = getAppSetting(likedPlaylistCoverSetting)
  const customCover = typeof saved === 'string' ? saved : null
  const liked = getDatabase()
    .prepare(
      `SELECT (SELECT cover FROM song WHERE preference = 1 ORDER BY id DESC LIMIT 1) AS cover,
        COUNT(*) AS songCount FROM song WHERE preference = 1`
    )
    .get() as { cover: string | null; songCount: number }
  return { cover: customCover || liked.cover || null, customCover, songCount: liked.songCount }
}

export function setLikedPlaylistCustomCover(path: string | null, dataUrl?: string): void {
  setAppSetting(likedPlaylistCoverSetting, savePlaylistCover(path, dataUrl))
}

function savePlaylistCover(sourcePath: string | null, dataUrl?: string): string | null {
  if (dataUrl === undefined) return sourcePath ? copyPlaylistCover(sourcePath) : null
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl)
  if (!match) throw new Error(t('coverFormatUnsupported'))
  const coverDirectory = join(getDataPath(), 'covers')
  mkdirSync(coverDirectory, { recursive: true })
  const destination = join(coverDirectory, `playlist-${randomUUID()}.jpg`)
  writeFileSync(destination, Buffer.from(match[1], 'base64'))
  return destination
}

function copyPlaylistCover(sourcePath: string): string {
  if (!existsSync(sourcePath)) throw new Error(t('coverFileRemoved'))
  const extension = extname(sourcePath).toLowerCase()
  if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension)) {
    throw new Error(t('coverFormatUnsupported'))
  }
  const coverDirectory = join(getDataPath(), 'covers')
  mkdirSync(coverDirectory, { recursive: true })
  const destination = join(coverDirectory, `playlist-${randomUUID()}${extension}`)
  copyFileSync(sourcePath, destination)
  return destination
}

export function deletePlaylists(ids: number[]): number {
  if (!ids.length) return 0
  return getDatabase()
    .prepare(`DELETE FROM song_list WHERE id IN (${ids.map(() => '?').join(',')})`)
    .run(...ids).changes
}

export function reorderPlaylists(items: Array<{ id: number; position: number }>): void {
  const stmt = getDatabase().prepare('UPDATE song_list SET position = @position WHERE id = @id')
  getDatabase().transaction(() => items.forEach((item) => stmt.run(item)))()
}

export function addSongsToPlaylist(
  playlistId: number,
  songIds: number[]
): { added: number; duplicates: number } {
  const db = getDatabase()
  const ids = [...new Set(songIds.filter((id) => Number.isInteger(id) && id > 0))]
  if (!ids.length) return { added: 0, duplicates: 0 }
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO song_list_item (song_list_id, song_id, position) VALUES (@playlistId, @songId, @position)'
  )
  return db.transaction(() => {
    const existing = new Set(
      (
        db
          .prepare(
            `SELECT song_id FROM song_list_item WHERE song_list_id = ? AND song_id IN (${ids.map(() => '?').join(',')})`
          )
          .all(playlistId, ...ids) as Array<{ song_id: number }>
      ).map((row) => row.song_id)
    )
    const additions = ids.filter((id) => !existing.has(id))
    const start =
      (
        db
          .prepare(
            'SELECT COALESCE(MAX(position), -1) AS position FROM song_list_item WHERE song_list_id = ?'
          )
          .get(playlistId) as { position: number }
      ).position + 1
    let added = 0
    additions.forEach((songId, index) => {
      added += stmt.run({ playlistId, songId, position: start + index }).changes
    })
    refreshPlaylistCover(playlistId)
    return { added, duplicates: ids.length - added }
  })()
}

export function removeSongsFromPlaylist(playlistId: number, songIds: number[]): number {
  if (!songIds.length) return 0
  const db = getDatabase()
  return db.transaction(() => {
    const removed = db
      .prepare(
        `DELETE FROM song_list_item WHERE song_list_id = ? AND song_id IN (${songIds.map(() => '?').join(',')})`
      )
      .run(playlistId, ...songIds).changes
    refreshPlaylistCover(playlistId)
    return removed
  })()
}

export function refreshPlaylistCover(playlistId: number): void {
  const db = getDatabase()
  const playlist = db.prepare('SELECT custom_cover FROM song_list WHERE id = ?').get(playlistId) as
    { custom_cover: string | null } | undefined
  if (!playlist || playlist.custom_cover) return
  const song = db
    .prepare(
      `SELECT s.cover FROM song_list_item sli JOIN song s ON s.id = sli.song_id WHERE sli.song_list_id = ? ORDER BY sli.position DESC, sli.id DESC LIMIT 1`
    )
    .get(playlistId) as { cover: string | null } | undefined
  db.prepare('UPDATE song_list SET cover = ? WHERE id = ?').run(song?.cover ?? null, playlistId)
}

export function queryPlaylistSongs(playlistId: number, query: SongQuery = {}): PagedResult<Song> {
  const db = getDatabase()
  const where = ['sli.song_list_id = @playlistId']
  const params: Record<string, string | number> = { playlistId }
  const searchFilter = buildSongSearchFilter(db, query.search, 's.')
  if (searchFilter.sql) where.push(searchFilter.sql)
  Object.assign(params, searchFilter.params)
  if (query.source === 'local') where.push('s.source_id IS NULL')
  if (query.source === 'remote') {
    where.push(query.sourceId ? 's.source_id = @sourceId' : 's.source_id IS NOT NULL')
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
      `s.id IN (SELECT song_id FROM song_tag WHERE tag_id IN (${keys.join(',')}) GROUP BY song_id HAVING COUNT(DISTINCT tag_id) = @tagCount)`
    )
  }
  const allowed = new Set(['id', 'title', 'artist', 'album', 'duration', 'created_at'])
  const sort = allowed.has(query.sortBy ?? '') ? query.sortBy! : 'id'
  const order = query.sortOrder ? (query.sortOrder === 'desc' ? 'DESC' : 'ASC') : 'DESC'
  const column = `s.${sort}`
  const size =
    query.size && Number.isFinite(query.size) && query.size > 0 ? Math.floor(query.size) : undefined
  if (size) {
    params.size = size
    params.offset = Math.max(0, (query.page ?? 1) - 1) * size
  }
  const pagination = size ? 'LIMIT @size OFFSET @offset' : ''
  const clause = `WHERE ${where.join(' AND ')}`
  const data = attachTags(
    db
      .prepare(
        `SELECT ${songColumnsFor('s.')}, ${searchFilter.score} AS searchScore FROM song_list_item sli JOIN song s ON s.id = sli.song_id ${clause} ORDER BY ${relevanceOrder(searchFilter.sql, query)}${column} ${order} ${pagination}`
      )
      .all(params)
      .map((row) => mapSong(row as SongRow))
  )
  const total = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM song_list_item sli JOIN song s ON s.id = sli.song_id ${clause}`
      )
      .get(params) as { count: number }
  ).count
  return { data, total }
}

export function listPlaylistMemberships(songId: number): PlaylistMembership[] {
  return getDatabase()
    .prepare(
      `SELECT sl.id, sl.name, COALESCE(sl.custom_cover, sl.cover) AS cover, sl.custom_cover AS customCover, sl.description, sl.position, sl.created_at AS createdAt, EXISTS(SELECT 1 FROM song_list_item sli WHERE sli.song_list_id = sl.id AND sli.song_id = ?) AS isIncluded FROM song_list sl ORDER BY sl.position, sl.id`
    )
    .all(songId)
    .map((row) => ({
      ...(row as PlaylistMembership),
      isIncluded: Boolean((row as { isIncluded: number }).isIncluded)
    }))
}
