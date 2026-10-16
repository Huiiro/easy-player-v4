import { getDatabase } from '../index'
import { buildSongSearchFilter } from '../../search/searchQuery'
import type { Album, Artist, Genre, Song } from '../types'
import { songColumns, relevanceOrder, attachTags, mapSong, type SongRow } from './songHelpers'

function queryScopedSongs(
  scope: string,
  params: Record<string, string | number>,
  search = '',
  predicate: (song: Song) => boolean = () => true
): Song[] {
  const filter = buildSongSearchFilter(getDatabase(), search)
  const rows = getDatabase()
    .prepare(
      `SELECT ${songColumns}, ${filter.score} AS searchScore FROM song WHERE (${scope}) ${filter.sql ? `AND ${filter.sql}` : ''} ORDER BY ${relevanceOrder(filter.sql)}id DESC`
    )
    .all({ ...params, ...filter.params })
  return attachTags(rows.map((row) => mapSong(row as SongRow)).filter(predicate))
}

export function getSongsByAlbum(album: string, artist?: string, search = ''): Song[] {
  const where = [
    album === '__easy_player_unknown_album__'
      ? "(album IS NULL OR TRIM(album) = '')"
      : 'album = @album'
  ]
  const params: Record<string, string> = {}
  if (album !== '__easy_player_unknown_album__') params.album = album
  if (artist === '__easy_player_unknown_artist__')
    where.push("(artist IS NULL OR TRIM(artist) = '')")
  else if (artist) {
    where.push('artist = @artist')
    params.artist = artist
  }
  return queryScopedSongs(where.join(' AND '), params, search)
}

export function getSongsByGenre(genre: string, search = ''): Song[] {
  return genre === '__easy_player_unknown_genre__'
    ? queryScopedSongs("genre IS NULL OR TRIM(genre) = ''", {}, search)
    : queryScopedSongs('genre = @genre', { genre }, search)
}

function splitArtistNames(value: string | null, separators = ''): string[] {
  const artist = value?.trim()
  if (!artist) return []
  if (!separators) return [artist]
  const parts = [...new Set(separators)].reduce(
    (values, separator) => values.flatMap((part) => part.split(separator)),
    [artist]
  )
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))]
}

export function getSongsByArtist(artist: string, separator = '', search = ''): Song[] {
  if (artist === '__easy_player_unknown_artist__') {
    return queryScopedSongs("artist IS NULL OR TRIM(artist) = ''", {}, search)
  }
  if (separator) {
    return queryScopedSongs('1=1', {}, search, (song) =>
      splitArtistNames(song.artist, separator).includes(artist)
    )
  }
  return queryScopedSongs('artist = @artist', { artist }, search)
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

export function queryArtists(sort: 'asc' | 'desc' = 'asc', search = '', separator = ''): Artist[] {
  if (separator) {
    const rows = getDatabase()
      .prepare('SELECT artist, cover FROM song ORDER BY id DESC')
      .all() as Array<{ artist: string | null; cover: string | null }>
    const artists = new Map<string, Artist>()
    let unknownCount = 0
    let unknownCover: string | null = null
    for (const row of rows) {
      const names = splitArtistNames(row.artist, separator)
      if (!names.length) {
        unknownCount += 1
        unknownCover ||= row.cover
        continue
      }
      for (const name of names) {
        const current = artists.get(name)
        if (current) current.songCount += 1
        else artists.set(name, { artistName: name, songCount: 1, artistCover: row.cover })
      }
    }
    if (unknownCount) {
      artists.set('__easy_player_unknown_artist__', {
        artistName: null,
        songCount: unknownCount,
        artistCover: unknownCover
      })
    }
    const keyword = search.trim().toLocaleLowerCase()
    const direction = sort === 'desc' ? -1 : 1
    return [...artists.values()]
      .filter((item) => !keyword || item.artistName?.toLocaleLowerCase().includes(keyword))
      .sort(
        (left, right) =>
          String(left.artistName ?? '').localeCompare(String(right.artistName ?? ''), undefined, {
            sensitivity: 'base',
            numeric: true
          }) * direction
      )
  }
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
