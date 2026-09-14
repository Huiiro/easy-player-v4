import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'node:fs'
import { safeStorage } from 'electron'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { getDatabase } from './index'

export function getAppSetting(key: string): unknown | null {
  const row = getDatabase().prepare('SELECT value_json FROM app_setting WHERE key = ?').get(key) as
    { value_json?: string } | undefined
  if (!row?.value_json) return null
  try {
    return JSON.parse(row.value_json)
  } catch {
    return null
  }
}

export function setAppSetting(key: string, value: unknown): void {
  getDatabase()
    .prepare(
      `INSERT INTO app_setting (key, value_json, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = CURRENT_TIMESTAMP`
    )
    .run(key, JSON.stringify(value))
}
import { getDataPath } from '../utils/pathUtils'
import type {
  Album,
  Artist,
  DownloadTask,
  DownloadTaskInput,
  Genre,
  LibraryFolder,
  MusicSource,
  MusicSourceInput,
  OverviewStats,
  PagedResult,
  PlayHistoryDay,
  PlayHistoryInput,
  Playlist,
  PlaylistInput,
  PlaylistMembership,
  RankedSong,
  Song,
  SongQuery,
  Tag,
  TagInput
} from './types'

const songColumns = `id, title, artist, album, duration, cover, cover_analysis_path AS coverAnalysisPath, cover_primary AS coverPrimary, cover_secondary AS coverSecondary, cover_lyrics_dark AS coverLyricsDark, cover_analysis_version AS coverAnalysisVersion, audio, folder_id AS folderId, is_newest AS isNewest, lrc, translation, lyric_format AS lyricFormat, translation_format AS translationFormat, romanization, romanization_format AS romanizationFormat, year, genre, bitrate, sample_rate AS sampleRate, bit_depth AS bitDepth, channels, format, file_name AS fileName, file_size AS fileSize, play_times AS playTimes, track_no AS trackNo, disk_no AS diskNo, song_status AS songStatus, source_id AS sourceId, remote_id AS remoteId, created_at AS createdAt`
const songColumnsFor = (alias: string): string =>
  songColumns
    .split(', ')
    .map((column) => `${alias}${column}`)
    .join(', ')
type SongRow = Omit<Song, 'isNewest'> & { isNewest: number }

const mapSong = (row: SongRow): Song => ({
  ...row,
  isNewest: row.isNewest === 1
})

function attachTags(songs: Song[]): Song[] {
  if (!songs.length) return songs
  const placeholders = songs.map(() => '?').join(',')
  const rows = getDatabase()
    .prepare(
      `SELECT st.song_id AS songId, t.id, t.name, t.color, t.description, t.tag_order AS tagOrder
       FROM song_tag st JOIN tag t ON t.id = st.tag_id
       WHERE st.song_id IN (${placeholders}) ORDER BY t.tag_order, t.id`
    )
    .all(...songs.map((song) => song.id)) as Array<Tag & { songId: number }>
  const tagsBySong = new Map<number, Tag[]>()
  for (const { songId, ...tag } of rows) {
    const tags = tagsBySong.get(songId) ?? []
    tags.push(tag)
    tagsBySong.set(songId, tags)
  }
  return songs.map((song) => ({ ...song, tags: tagsBySong.get(song.id) ?? [] }))
}

export function querySongs(query: SongQuery = {}): PagedResult<Song> {
  const db = getDatabase()
  const where: string[] = []
  const params: Record<string, string | number> = {}
  if (query.search?.trim()) {
    where.push(
      '(title LIKE @search OR artist LIKE @search OR album LIKE @search OR file_name LIKE @search)'
    )
    params.search = `%${query.search.trim()}%`
  }
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
  const order = query.sortOrder === 'desc' ? 'DESC' : 'ASC'
  const size =
    query.size && Number.isFinite(query.size) && query.size > 0 ? Math.floor(query.size) : undefined
  if (size) {
    params.size = size
    params.offset = Math.max(0, (query.page ?? 1) - 1) * size
  }
  const pagination = size ? 'LIMIT @size OFFSET @offset' : ''
  const data = attachTags(
    db
      .prepare(`SELECT ${songColumns} FROM song ${clause} ORDER BY ${sort} ${order} ${pagination}`)
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
export function getSongsByAlbum(album: string, artist?: string): Song[] {
  const db = getDatabase()
  const unknownAlbum = album === '__easy_player_unknown_album__'
  const unknownArtist = artist === '__easy_player_unknown_artist__'
  if (unknownAlbum) {
    const rows = unknownArtist
      ? db
          .prepare(
            `SELECT ${songColumns} FROM song WHERE (album IS NULL OR TRIM(album) = '') AND (artist IS NULL OR TRIM(artist) = '') ORDER BY title COLLATE NOCASE`
          )
          .all()
      : artist
        ? db
            .prepare(
              `SELECT ${songColumns} FROM song WHERE (album IS NULL OR TRIM(album) = '') AND artist = ? ORDER BY title COLLATE NOCASE`
            )
            .all(artist)
        : db
            .prepare(
              `SELECT ${songColumns} FROM song WHERE album IS NULL OR TRIM(album) = '' ORDER BY title COLLATE NOCASE`
            )
            .all()
    return attachTags(rows.map((row) => mapSong(row as SongRow)))
  }
  if (unknownArtist) {
    return attachTags(
      db
        .prepare(
          `SELECT ${songColumns} FROM song WHERE album = ? AND (artist IS NULL OR TRIM(artist) = '') ORDER BY title COLLATE NOCASE`
        )
        .all(album)
        .map((row) => mapSong(row as SongRow))
    )
  }
  const rows = artist
    ? db
        .prepare(
          `SELECT ${songColumns} FROM song WHERE album = ? AND artist = ? ORDER BY title COLLATE NOCASE`
        )
        .all(album, artist)
    : db
        .prepare(`SELECT ${songColumns} FROM song WHERE album = ? ORDER BY title COLLATE NOCASE`)
        .all(album)
  return attachTags(rows.map((row) => mapSong(row as SongRow)))
}
export function getSongsByGenre(genre: string): Song[] {
  if (genre === '__easy_player_unknown_genre__') {
    return attachTags(
      getDatabase()
        .prepare(
          `SELECT ${songColumns} FROM song WHERE genre IS NULL OR TRIM(genre) = '' ORDER BY title COLLATE NOCASE`
        )
        .all()
        .map((row) => mapSong(row as SongRow))
    )
  }
  return attachTags(
    getDatabase()
      .prepare(`SELECT ${songColumns} FROM song WHERE genre = ? ORDER BY title COLLATE NOCASE`)
      .all(genre)
      .map((row) => mapSong(row as SongRow))
  )
}
export function getSongsByArtist(artist: string): Song[] {
  if (artist === '__easy_player_unknown_artist__') {
    return attachTags(
      getDatabase()
        .prepare(
          `SELECT ${songColumns} FROM song WHERE artist IS NULL OR TRIM(artist) = '' ORDER BY title COLLATE NOCASE`
        )
        .all()
        .map((row) => mapSong(row as SongRow))
    )
  }
  return attachTags(
    getDatabase()
      .prepare(`SELECT ${songColumns} FROM song WHERE artist = ? ORDER BY title COLLATE NOCASE`)
      .all(artist)
      .map((row) => mapSong(row as SongRow))
  )
}
export function listLocalFolders(): LibraryFolder[] {
  return getDatabase()
    .prepare(
      `WITH RECURSIVE folder_descendants(folder_id, descendant_id) AS (
        SELECT id, id
        FROM folder
        WHERE full_path NOT LIKE 'remote://%'
        UNION ALL
        SELECT fd.folder_id, child.id
        FROM folder_descendants fd
        JOIN folder child ON child.pid = fd.descendant_id
        WHERE child.full_path NOT LIKE 'remote://%'
       )
       SELECT f.id, f.pid, f.name, f.full_path AS fullPath, f.is_root_path AS isRootPath,
        COUNT(s.id) AS songCount
       FROM folder f
       LEFT JOIN folder_descendants fd ON fd.folder_id = f.id
       LEFT JOIN song s ON s.folder_id = fd.descendant_id AND s.source_id IS NULL
       WHERE f.full_path NOT LIKE 'remote://%'
       GROUP BY f.id
       ORDER BY f.is_root_path DESC, f.name COLLATE NOCASE`
    )
    .all()
    .map((row) => ({
      ...(row as Omit<LibraryFolder, 'isRootPath'>),
      isRootPath: (row as { isRootPath: number }).isRootPath === 1
    }))
}

export function rebuildLocalFolders(): number {
  const db = getDatabase()
  const songs = db.prepare('SELECT id, audio FROM song WHERE source_id IS NULL').all() as Array<{
    id: number
    audio: string
  }>
  const findFolder = db.prepare('SELECT id FROM folder WHERE full_path = ?')
  const insertFolder = db.prepare(
    'INSERT INTO folder (pid, name, full_path, is_root_path, import_time) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)'
  )
  const updateSong = db.prepare('UPDATE song SET folder_id = ? WHERE id = ?')
  const getFolder = (fullPath: string): number => {
    const existing = findFolder.get(fullPath) as { id: number } | undefined
    if (existing) return existing.id
    const parentPath = dirname(fullPath)
    const parentId = parentPath === fullPath ? null : getFolder(parentPath)
    return Number(
      insertFolder.run(
        parentId,
        basename(fullPath) || fullPath,
        fullPath,
        parentId === null ? 1 : 0
      ).lastInsertRowid
    )
  }
  db.transaction(() => {
    for (const song of songs) updateSong.run(getFolder(dirname(song.audio)), song.id)
  })()
  return songs.length
}
export function getLocalFolderSongs(folderId: number): Song[] {
  const rows = getDatabase()
    .prepare(
      `WITH RECURSIVE descendants(id) AS (
        SELECT id FROM folder WHERE id = ?
        UNION ALL
        SELECT f.id FROM folder f JOIN descendants d ON f.pid = d.id
      )
      SELECT ${songColumns} FROM song
      WHERE source_id IS NULL AND folder_id IN (SELECT id FROM descendants)
      ORDER BY title COLLATE NOCASE`
    )
    .all(folderId)
  return attachTags(rows.map((row) => mapSong(row as SongRow)))
}
export function queryAlbums(sort: 'asc' | 'desc' = 'asc', search = ''): Album[] {
  const direction = sort === 'desc' ? 'DESC' : 'ASC'
  const keyword = search.trim()
  return getDatabase()
    .prepare(
      `SELECT album AS albumName, artist AS artistName, COUNT(*) AS songCount, MAX(cover) AS albumCover FROM song ${keyword ? 'WHERE album LIKE @search' : ''} GROUP BY album, artist ORDER BY album COLLATE NOCASE ${direction}`
    )
    .all(keyword ? { search: `%${keyword}%` } : {}) as Album[]
}
export function queryArtists(sort: 'asc' | 'desc' = 'asc', search = ''): Artist[] {
  const direction = sort === 'desc' ? 'DESC' : 'ASC'
  const keyword = search.trim()
  return getDatabase()
    .prepare(
      `SELECT artist AS artistName, COUNT(*) AS songCount, MAX(cover) AS artistCover FROM song ${keyword ? 'WHERE artist LIKE @search' : ''} GROUP BY artist ORDER BY artist COLLATE NOCASE ${direction}`
    )
    .all(keyword ? { search: `%${keyword}%` } : {}) as Artist[]
}
export function queryGenres(sort: 'asc' | 'desc' = 'asc', search = ''): Genre[] {
  const direction = sort === 'desc' ? 'DESC' : 'ASC'
  const keyword = search.trim()
  return getDatabase()
    .prepare(
      `SELECT CASE WHEN genre IS NULL OR TRIM(genre) = '' THEN 'unknown_genre' ELSE genre END AS name, COUNT(*) AS count FROM song ${keyword ? 'WHERE genre LIKE @search' : ''} GROUP BY genre ORDER BY name COLLATE NOCASE ${direction}`
    )
    .all(keyword ? { search: `%${keyword}%` } : {}) as Genre[]
}
export function countSongsByAlbum(album: string, artist: string | null): number {
  const row = (
    artist === null
      ? getDatabase().prepare('SELECT COUNT(*) AS count FROM song WHERE album = ?').get(album)
      : getDatabase()
          .prepare('SELECT COUNT(*) AS count FROM song WHERE album = ? AND artist = ?')
          .get(album, artist)
  ) as { count: number }
  return row.count
}
export function countSongsByArtist(artist: string | null): number {
  const row = (
    artist === null
      ? getDatabase().prepare('SELECT COUNT(*) AS count FROM song WHERE artist IS NULL').get()
      : getDatabase().prepare('SELECT COUNT(*) AS count FROM song WHERE artist = ?').get(artist)
  ) as { count: number }
  return row.count
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
export function savePlayHistory(songId: number): void {
  const db = getDatabase()
  db.transaction(() => {
    db.prepare(
      `INSERT INTO history (song_id, play_time) VALUES (?, CURRENT_TIMESTAMP) ON CONFLICT(song_id) DO UPDATE SET play_time = CURRENT_TIMESTAMP`
    ).run(songId)
    db.prepare('UPDATE song SET play_times = play_times + 1 WHERE id = ?').run(songId)
  })()
}
export function queryRecentPlayedSongs(
  query: SongQuery = {}
): PagedResult<Song & { playTime: string }> {
  const db = getDatabase()
  const size =
    query.size && Number.isFinite(query.size) && query.size > 0 ? Math.floor(query.size) : undefined
  const offset = size ? Math.max(0, (query.page ?? 1) - 1) * size : 0
  const search = query.search?.trim()
  const where = ['1 = 1']
  const params: Record<string, string | number> = {}
  if (size) {
    params.size = size
    params.offset = offset
  }
  if (search) {
    where.push(
      '(s.title LIKE @search OR s.artist LIKE @search OR s.album LIKE @search OR s.file_name LIKE @search)'
    )
    params.search = `%${search}%`
  }
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
      `SELECT ${songColumnsFor('s.')}, strftime('%Y-%m-%dT%H:%M:%fZ', h.play_time) AS playTime FROM history h JOIN song s ON s.id = h.song_id ${clause} ORDER BY ${column} ${order} ${pagination}`
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
export function savePlayHistoryDetail(input: PlayHistoryInput): void {
  getDatabase()
    .prepare(
      'INSERT INTO play_history (song_id, playlist_id, playlist_name, played_seconds, started_at) VALUES (?, ?, ?, ?, ?)'
    )
    .run(
      input.songId,
      input.playlistId ?? null,
      input.playlistName ?? null,
      input.playedSeconds ?? 0,
      input.startedAt
    )
}
export function getPlayHistoryDays(days = 365): PlayHistoryDay[] {
  return getDatabase()
    .prepare(
      "SELECT DATE(started_at / 1000, 'unixepoch', 'localtime') AS date, SUM(played_seconds) AS seconds FROM play_history WHERE started_at >= (strftime('%s', DATE('now', 'localtime', '-' || ? || ' days')) * 1000) GROUP BY DATE(started_at / 1000, 'unixepoch', 'localtime') ORDER BY date"
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
      `SELECT ${songColumnsFor('song.')}, COALESCE(SUM(ph.played_seconds), 0) AS value FROM play_history ph JOIN song ON song.id = ph.song_id GROUP BY song.id ORDER BY value DESC LIMIT ?`
    )
    .all(Math.max(1, limit))
    .map((row) => ({
      ...mapSong(row as SongRow),
      value: (row as { value: number }).value
    }))
}

export function listPlaylists(): Playlist[] {
  return getDatabase()
    .prepare(
      'SELECT id, name, COALESCE(custom_cover, cover) AS cover, custom_cover AS customCover, description, position, created_at AS createdAt FROM song_list ORDER BY position, id'
    )
    .all() as Playlist[]
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
  if (!name) throw new Error('Playlist name is required')
  if (name.length > 64) throw new Error('Playlist name must be 64 characters or fewer')
  if (db.prepare('SELECT 1 FROM song_list WHERE name = ? COLLATE NOCASE').get(name)) {
    throw new Error('Playlist name already exists')
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
  if (!name || name.length > 64)
    throw new Error('Playlist name must be between 1 and 64 characters')
  if (
    getDatabase()
      .prepare('SELECT 1 FROM song_list WHERE name = ? COLLATE NOCASE AND id != ?')
      .get(name, id)
  ) {
    throw new Error('Playlist name already exists')
  }
  const result = getDatabase()
    .prepare(
      'UPDATE song_list SET name = ?, cover = COALESCE(?, cover), description = ? WHERE id = ?'
    )
    .run(name, input.cover ?? null, input.description ?? null, id)
  return result.changes > 0
}
export function setPlaylistCustomCover(id: number, path: string | null): boolean {
  const db = getDatabase()
  return db.transaction(() => {
    const customCover = path ? copyPlaylistCover(path) : null
    const changed =
      db.prepare('UPDATE song_list SET custom_cover = ? WHERE id = ?').run(customCover, id)
        .changes > 0
    if (changed && !path) refreshPlaylistCover(id)
    return changed
  })()
}

function copyPlaylistCover(sourcePath: string): string {
  if (!existsSync(sourcePath)) throw new Error('The selected cover file no longer exists')
  const extension = extname(sourcePath).toLowerCase()
  if (!['.jpg', '.jpeg', '.png', '.webp', '.gif'].includes(extension)) {
    throw new Error('Unsupported cover image format')
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

function refreshPlaylistCover(playlistId: number): void {
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
  if (query.search?.trim()) {
    where.push(
      '(s.title LIKE @search OR s.artist LIKE @search OR s.album LIKE @search OR s.file_name LIKE @search)'
    )
    params.search = `%${query.search.trim()}%`
  }
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
  const order = query.sortOrder === 'desc' ? 'DESC' : 'ASC'
  const column = sort === 'id' ? 'sli.id' : `s.${sort}`
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
        `SELECT ${songColumnsFor('s.')} FROM song_list_item sli JOIN song s ON s.id = sli.song_id ${clause} ORDER BY ${column} ${order} ${pagination}`
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

export function listTags(songId?: number): Tag[] {
  const db = getDatabase()
  if (songId === undefined)
    return db
      .prepare(
        'SELECT id, name, color, description, tag_order AS tagOrder FROM tag ORDER BY tag_order, id'
      )
      .all() as Tag[]
  return db
    .prepare(
      `SELECT t.id, t.name, t.color, t.description, t.tag_order AS tagOrder, st.song_id IS NOT NULL AS isIncluded FROM tag t LEFT JOIN song_tag st ON st.tag_id = t.id AND st.song_id = ? ORDER BY t.tag_order, t.id`
    )
    .all(songId)
    .map((row) => ({
      ...(row as Tag),
      isIncluded: Boolean((row as { isIncluded: number }).isIncluded)
    }))
}
export function createTag(input: TagInput): Tag {
  const db = getDatabase()
  const result = db
    .prepare(
      `INSERT INTO tag (name, color, description, tag_order) VALUES (?, ?, ?, (SELECT COALESCE(MAX(tag_order), 0) + 1 FROM tag))`
    )
    .run(input.name.trim(), input.color ?? '#888888', input.description ?? null)
  return db
    .prepare('SELECT id, name, color, description, tag_order AS tagOrder FROM tag WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as Tag
}
export function updateTag(id: number, input: TagInput): boolean {
  return (
    getDatabase()
      .prepare('UPDATE tag SET name = ?, color = ?, description = ? WHERE id = ?')
      .run(input.name.trim(), input.color ?? '#888888', input.description ?? null, id).changes > 0
  )
}
export function deleteTag(id: number): boolean {
  return getDatabase().prepare('DELETE FROM tag WHERE id = ?').run(id).changes > 0
}
export function setSongTag(tagId: number, songIds: number[], included: boolean): void {
  const stmt = getDatabase().prepare(
    included
      ? 'INSERT OR IGNORE INTO song_tag (song_id, tag_id) VALUES (?, ?)'
      : 'DELETE FROM song_tag WHERE song_id = ? AND tag_id = ?'
  )
  getDatabase().transaction(() => songIds.forEach((songId) => stmt.run(songId, tagId)))()
}
export function reorderTags(ids: number[]): void {
  const stmt = getDatabase().prepare('UPDATE tag SET tag_order = ? WHERE id = ?')
  getDatabase().transaction(() => ids.forEach((id, index) => stmt.run(index + 1, id)))()
}
export function toggleSongTag(tagId: number, songId: number): boolean {
  const db = getDatabase()
  const exists = db
    .prepare('SELECT 1 FROM song_tag WHERE tag_id = ? AND song_id = ?')
    .get(tagId, songId)
  if (exists) {
    db.prepare('DELETE FROM song_tag WHERE tag_id = ? AND song_id = ?').run(tagId, songId)
    return false
  }
  db.prepare('INSERT INTO song_tag (tag_id, song_id) VALUES (?, ?)').run(tagId, songId)
  return true
}

export function listSources(): MusicSource[] {
  const sources = getDatabase()
    .prepare(
      'SELECT id, name, type, server, base_url AS baseUrl, user, secret, auth_type AS authType, status, source_order AS sourceOrder, imported_count AS importedCount, song_count AS songCount, last_connect AS lastConnect FROM music_source ORDER BY source_order, id'
    )
    .all() as MusicSource[]
  return sources.map((source) => ({ ...source, secret: decryptSourceSecret(source.secret) }))
}

const SOURCE_SECRET_PREFIX = 'safe:v1:'

function encryptSourceSecret(secret: string | null | undefined): string | null {
  if (!secret) return null
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('系统凭据加密不可用，无法保存远程音源密码。')
  return `${SOURCE_SECRET_PREFIX}${safeStorage.encryptString(secret).toString('base64')}`
}

function decryptSourceSecret(secret: string | null): string | null {
  if (!secret) return null
  if (!secret.startsWith(SOURCE_SECRET_PREFIX)) return secret
  if (!safeStorage.isEncryptionAvailable())
    throw new Error('系统凭据加密不可用，无法读取远程音源密码。')
  return safeStorage.decryptString(Buffer.from(secret.slice(SOURCE_SECRET_PREFIX.length), 'base64'))
}

/** Encrypt legacy plaintext credentials after the app's key store is available. */
export function migrateSourceSecrets(): void {
  if (!safeStorage.isEncryptionAvailable()) return
  const db = getDatabase()
  const rows = db
    .prepare('SELECT id, secret FROM music_source WHERE secret IS NOT NULL')
    .all() as Array<{
    id: number
    secret: string
  }>
  const update = db.prepare('UPDATE music_source SET secret = ? WHERE id = ?')
  db.transaction(() => {
    for (const row of rows) {
      if (!row.secret.startsWith(SOURCE_SECRET_PREFIX))
        update.run(encryptSourceSecret(row.secret), row.id)
    }
  })()
}
export function createSource(input: MusicSourceInput): MusicSource {
  const db = getDatabase()
  const result = db
    .prepare(
      `INSERT INTO music_source (name, type, server, base_url, user, secret, auth_type, status, source_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?, (SELECT COALESCE(MAX(source_order), 0) + 1 FROM music_source))`
    )
    .run(
      input.name,
      input.type ?? null,
      input.server ?? null,
      input.baseUrl ?? null,
      input.user ?? null,
      encryptSourceSecret(input.secret),
      input.authType ?? null,
      input.status ?? null
    )
  return listSources().find((source) => source.id === Number(result.lastInsertRowid))!
}
export function updateSource(source: MusicSource): boolean {
  return (
    getDatabase()
      .prepare(
        'UPDATE music_source SET name = ?, type = ?, server = ?, base_url = ?, user = ?, secret = ?, auth_type = ?, status = ?, source_order = ?, imported_count = ?, song_count = ?, last_connect = ? WHERE id = ?'
      )
      .run(
        source.name,
        source.type,
        source.server,
        source.baseUrl,
        source.user,
        encryptSourceSecret(source.secret),
        source.authType,
        source.status,
        source.sourceOrder,
        source.importedCount,
        source.songCount,
        source.lastConnect,
        source.id
      ).changes > 0
  )
}
export function deleteSource(id: number): boolean {
  return getDatabase().prepare('DELETE FROM music_source WHERE id = ?').run(id).changes > 0
}
export function getSource(id: number): MusicSource | null {
  return listSources().find((source) => source.id === id) ?? null
}
export function reorderSources(items: Array<{ id: number; sourceOrder: number }>): void {
  const stmt = getDatabase().prepare('UPDATE music_source SET source_order = ? WHERE id = ?')
  getDatabase().transaction(() => items.forEach((item) => stmt.run(item.sourceOrder, item.id)))()
}
export function touchSource(id: number): boolean {
  return (
    getDatabase()
      .prepare("UPDATE music_source SET last_connect = datetime('now', 'localtime') WHERE id = ?")
      .run(id).changes > 0
  )
}
export function updateSourceStats(id: number, importedCount: number, songCount: number): boolean {
  return (
    getDatabase()
      .prepare('UPDATE music_source SET imported_count = ?, song_count = ? WHERE id = ?')
      .run(importedCount, songCount, id).changes > 0
  )
}

export function listDownloadTasks(): DownloadTask[] {
  return getDatabase()
    .prepare(
      'SELECT id, platform, resource_id AS resourceId, sub_id AS subId, title, file_path AS filePath, quality, extra_json, status, progress, created_at AS createdAt FROM download_task ORDER BY id DESC'
    )
    .all()
    .map((row) => ({
      ...(row as Omit<DownloadTask, 'extra'> & { extra_json: string | null }),
      extra: (row as { extra_json: string | null }).extra_json
        ? JSON.parse((row as { extra_json: string }).extra_json)
        : null
    }))
}
export function saveDownloadTask(input: DownloadTaskInput): boolean {
  const result = getDatabase()
    .prepare(
      `INSERT INTO download_task (platform, resource_id, sub_id, title, file_path, quality, extra_json, status, progress) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(platform, resource_id, sub_id, quality) DO UPDATE SET title = excluded.title, file_path = excluded.file_path, extra_json = excluded.extra_json, status = excluded.status, progress = excluded.progress`
    )
    .run(
      input.platform,
      input.resourceId,
      input.subId ?? '',
      input.title ?? null,
      input.filePath ?? null,
      input.quality ?? '',
      input.extra ? JSON.stringify(input.extra) : null,
      input.status ?? 'pending',
      input.progress ?? 0
    )
  return result.changes > 0
}
export function deleteDownloadTask(id?: number): number {
  return id === undefined
    ? getDatabase().prepare('DELETE FROM download_task').run().changes
    : getDatabase().prepare('DELETE FROM download_task WHERE id = ?').run(id).changes
}
export function hasCompletedDownload(platform: string, resourceId: string, subId = ''): boolean {
  return Boolean(
    getDatabase()
      .prepare(
        "SELECT 1 FROM download_task WHERE platform = ? AND resource_id = ? AND sub_id = ? AND status = 'done'"
      )
      .get(platform, resourceId, subId)
  )
}
export function getOverviewStats(): OverviewStats {
  return getDatabase()
    .prepare(
      `SELECT COUNT(*) AS songCount, COUNT(DISTINCT NULLIF(album, '')) AS albumCount, COUNT(DISTINCT NULLIF(artist, '')) AS artistCount, COALESCE(SUM(file_size), 0) AS librarySize, (SELECT COALESCE(SUM(played_seconds), 0) FROM play_history) AS totalPlaySeconds, (SELECT COALESCE(SUM(played_seconds), 0) FROM play_history WHERE date(started_at / 1000, 'unixepoch', 'localtime') = date('now', 'localtime')) AS todayPlaySeconds FROM song`
    )
    .get() as OverviewStats
}
