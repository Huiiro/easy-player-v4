import { getDatabase } from '../index'
import type { Song, SongQuery, Tag } from '../types'

export const songColumns = `id, title, artist, album, duration, cover, cover_analysis_path AS coverAnalysisPath, cover_primary AS coverPrimary, cover_secondary AS coverSecondary, cover_lyrics_dark AS coverLyricsDark, cover_analysis_version AS coverAnalysisVersion, audio, folder_id AS folderId, is_newest AS isNewest, lrc, translation, lyric_format AS lyricFormat, translation_format AS translationFormat, romanization, romanization_format AS romanizationFormat, year, genre, bitrate, sample_rate AS sampleRate, bit_depth AS bitDepth, channels, format, file_name AS fileName, file_size AS fileSize, play_times AS playTimes, track_no AS trackNo, disk_no AS diskNo, song_status AS songStatus, source_id AS sourceId, remote_id AS remoteId, preference, created_at AS createdAt`

export const songColumnsFor = (alias: string): string =>
  songColumns
    .split(', ')
    .map((column) => `${alias}${column}`)
    .join(', ')

export type SongRow = Omit<Song, 'isNewest'> & { isNewest: number }

export const mapSong = (row: SongRow): Song => ({
  ...row,
  isNewest: row.isNewest === 1
})

export function attachTags(songs: Song[]): Song[] {
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
  const readings = getDatabase()
    .prepare(
      `SELECT song_id AS songId, title, artist, album, file_name AS fileName FROM song_sort_reading WHERE song_id IN (${placeholders})`
    )
    .all(...songs.map((song) => song.id)) as Array<
    NonNullable<Song['sortReadings']> & { songId: number }
  >
  const readingsBySong = new Map(readings.map(({ songId, ...reading }) => [songId, reading]))
  return songs.map((song) => ({
    ...song,
    tags: tagsBySong.get(song.id) ?? [],
    sortReadings: readingsBySong.get(song.id)
  }))
}

export function relevanceOrder(search: string, query: SongQuery = {}): string {
  if (!search || (query.sortBy && query.sortBy !== 'relevance')) return ''
  return `searchScore ${query.sortBy === 'relevance' && query.sortOrder === 'asc' ? 'ASC' : 'DESC'}, `
}
