import { getDatabase } from '../index'
import { buildSongSearchFilter } from '../../search/searchQuery'
import type { Album, Artist, Genre, Song } from '../types'
import { songColumns, relevanceOrder, attachTags, mapSong, type SongRow } from './songHelpers'
import { genreMatchKey, splitGenres, splitMetadataValues } from '../../../shared/metadataValues'
import type { LibrarySortBy } from '../../../shared/librarySort'

function collectionOrder(
  sortBy: LibrarySortBy,
  direction: string,
  name: string,
  album = false
): string {
  const expression =
    sortBy === 'addedAt'
      ? 'MAX(created_at)'
      : sortBy === 'playCount'
        ? 'SUM(COALESCE(play_times, 0))'
        : sortBy === 'songCount'
          ? 'COUNT(*)'
          : sortBy === 'year' && album
            ? 'MAX(CASE WHEN year > 0 THEN year END)'
            : null
  return expression
    ? `${expression} IS NULL, ${expression} ${direction}, ${name} COLLATE NOCASE ASC`
    : `${name} COLLATE NOCASE ${direction}`
}

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

export function getSongsByAlbum(
  album: string,
  artist?: string,
  search = '',
  groupByName = false
): Song[] {
  const where = [
    album === '__easy_player_unknown_album__'
      ? "(album IS NULL OR TRIM(album) = '')"
      : 'album = @album'
  ]
  const params: Record<string, string> = {}
  if (album !== '__easy_player_unknown_album__') params.album = album
  if (!groupByName && artist === '__easy_player_unknown_artist__')
    where.push("(artist IS NULL OR TRIM(artist) = '')")
  else if (!groupByName && artist) {
    where.push('artist = @artist')
    params.artist = artist
  }
  return queryScopedSongs(where.join(' AND '), params, search)
}

export function getSongsByGenre(genre: string, search = '', separator = ''): Song[] {
  const key = genreMatchKey(genre)
  const unknown = key === '__easy_player_unknown_genre__'
  return queryScopedSongs('1=1', {}, search, (song) => {
    const names = splitGenres(song.genre, separator)
    return unknown ? !names.length : names.some((name) => genreMatchKey(name) === key)
  })
}

const splitArtistNames = splitMetadataValues

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

export function queryAlbums(
  sort: 'asc' | 'desc' = 'asc',
  search = '',
  groupByName = false,
  sortBy: LibrarySortBy = 'name'
): Album[] {
  const direction = sort === 'desc' ? 'DESC' : 'ASC'
  const order = collectionOrder(sortBy, direction, 'albumName', true)
  const keyword = search.trim()
  if (groupByName) {
    return getDatabase()
      .prepare(
        `SELECT CASE WHEN album IS NULL OR TRIM(album) = '' THEN NULL ELSE album END AS albumName,
        MAX(artist) AS artistName, COUNT(DISTINCT COALESCE(NULLIF(TRIM(artist), ''), '')) AS artistCount,
        COUNT(*) AS songCount, MAX(cover) AS albumCover
       FROM song
       GROUP BY CASE WHEN album IS NULL OR TRIM(album) = '' THEN NULL ELSE album END
       ${keyword ? 'HAVING MAX(CASE WHEN album LIKE @search OR artist LIKE @search THEN 1 ELSE 0 END) = 1' : ''}
       ORDER BY ${order}`
      )
      .all(keyword ? { search: `%${keyword}%` } : {}) as Album[]
  }
  return getDatabase()
    .prepare(
      `SELECT album AS albumName, artist AS artistName, COUNT(*) AS songCount, MAX(cover) AS albumCover FROM song ${keyword ? 'WHERE album LIKE @search OR artist LIKE @search' : ''} GROUP BY album, artist ORDER BY ${order}, artist COLLATE NOCASE ASC`
    )
    .all(keyword ? { search: `%${keyword}%` } : {}) as Album[]
}

export function queryArtists(
  sort: 'asc' | 'desc' = 'asc',
  search = '',
  separator = '',
  sortBy: LibrarySortBy = 'name'
): Artist[] {
  if (separator) {
    const rows = getDatabase()
      .prepare('SELECT artist, cover, created_at, play_times FROM song ORDER BY id DESC')
      .all() as Array<{
      artist: string | null
      cover: string | null
      created_at: string | null
      play_times: number | null
    }>
    const artists = new Map<string, Artist & { addedAt: string; playCount: number }>()
    for (const row of rows) {
      const names = splitArtistNames(row.artist, separator)
      for (const name of names.length ? names : [null]) {
        const key = name ?? '__easy_player_unknown_artist__'
        const current = artists.get(key)
        if (current) {
          current.songCount += 1
          current.playCount += row.play_times ?? 0
          if ((row.created_at ?? '') > current.addedAt) current.addedAt = row.created_at!
          if (name === null) current.artistCover ||= row.cover
        } else
          artists.set(key, {
            artistName: name,
            songCount: 1,
            artistCover: row.cover,
            addedAt: row.created_at ?? '',
            playCount: row.play_times ?? 0
          })
      }
    }
    const keyword = search.trim().toLocaleLowerCase()
    const direction = sort === 'desc' ? -1 : 1
    return [...artists.values()]
      .filter((item) => !keyword || item.artistName?.toLocaleLowerCase().includes(keyword))
      .sort((left, right) => {
        const nameOrder = String(left.artistName ?? '').localeCompare(
          String(right.artistName ?? ''),
          undefined,
          {
            sensitivity: 'base',
            numeric: true
          }
        )
        if (sortBy === 'addedAt') {
          if (!left.addedAt !== !right.addedAt) return left.addedAt ? -1 : 1
          return left.addedAt.localeCompare(right.addedAt) * direction || nameOrder
        }
        if (sortBy === 'playCount' || sortBy === 'songCount')
          return (left[sortBy] - right[sortBy]) * direction || nameOrder
        return nameOrder * direction
      })
      .map(({ artistName, songCount, artistCover }) => ({ artistName, songCount, artistCover }))
  }
  const direction = sort === 'desc' ? 'DESC' : 'ASC'
  const keyword = search.trim()
  return getDatabase()
    .prepare(
      `SELECT artist AS artistName, COUNT(*) AS songCount, MAX(cover) AS artistCover FROM song ${keyword ? 'WHERE artist LIKE @search' : ''} GROUP BY artist ORDER BY ${collectionOrder(sortBy, direction, 'artistName')}`
    )
    .all(keyword ? { search: `%${keyword}%` } : {}) as Artist[]
}

export function queryGenres(
  sort: 'asc' | 'desc' = 'asc',
  search = '',
  separator = '',
  sortBy: LibrarySortBy = 'name'
): Genre[] {
  const rows = getDatabase().prepare('SELECT genre FROM song ORDER BY id').all() as Array<{
    genre: string | null
  }>
  const genres = new Map<string, Genre>()
  for (const row of rows) {
    const names = splitGenres(row.genre, separator)
    for (const name of names.length ? names : ['__easy_player_unknown_genre__']) {
      const key = genreMatchKey(name)
      const current = genres.get(key)
      if (current) current.count += 1
      else genres.set(key, { name, count: 1 })
    }
  }
  const keyword = genreMatchKey(search)
  const direction = sort === 'desc' ? -1 : 1
  return [...genres.values()]
    .filter(
      (item) =>
        !keyword ||
        (item.name !== '__easy_player_unknown_genre__' &&
          genreMatchKey(item.name).includes(keyword))
    )
    .sort(
      (left, right) =>
        (sortBy === 'songCount' ? (left.count - right.count) * direction : 0) ||
        left.name.localeCompare(right.name, undefined, {
          sensitivity: 'base',
          numeric: true
        }) * direction
    )
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
