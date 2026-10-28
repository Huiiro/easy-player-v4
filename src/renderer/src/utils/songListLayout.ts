import type { LibrarySong } from '@/types/library'

export type SongSortField =
  | 'id'
  | 'title'
  | 'artist'
  | 'album'
  | 'duration'
  | 'year'
  | 'playTimes'
  | 'playTime'
  | 'diskNo'
  | 'trackNo'
  | 'relevance'
export type OptionalSongColumn =
  | 'genre'
  | 'year'
  | 'playTimes'
  | 'disableNetworkLyrics'
  | 'instrumental'
  | 'preference'
  | 'remoteSource'
export type SongListColumns = Record<OptionalSongColumn, boolean>

export function normalizeSongListColumns(value: unknown): SongListColumns {
  const columns = value && typeof value === 'object' ? (value as Partial<SongListColumns>) : {}
  return {
    genre: columns.genre === true,
    year: columns.year === true,
    playTimes: columns.playTimes === true,
    disableNetworkLyrics: columns.disableNetworkLyrics === true,
    instrumental: columns.instrumental === true,
    preference: columns.preference === true,
    remoteSource: columns.remoteSource === true
  }
}

export function songListLayout(columns: SongListColumns): Record<string, string> {
  const tracks = ['2.5rem', 'minmax(12rem,2fr)', 'minmax(7rem,1fr)', 'minmax(8rem,1.2fr)']
  let minimum = 33
  for (const [column, width] of [
    ['genre', 6],
    ['year', 3.5],
    ['playTimes', 4.5],
    ['disableNetworkLyrics', 2.25],
    ['instrumental', 2.25],
    ['preference', 2.25],
    ['remoteSource', 2.25]
  ] as const) {
    if (!columns[column]) continue
    tracks.push(`${width}rem`)
    minimum += width
  }
  tracks.push('3.5rem')
  // Include the row's horizontal padding and inter-column gaps.
  return {
    '--song-list-grid-columns': tracks.join(' '),
    '--song-list-min-width': `${minimum + 2.5 + (tracks.length - 1) * 0.75}rem`
  }
}

export function songYear(song: Pick<LibrarySong, 'year'>): number | null {
  return typeof song.year === 'number' && Number.isFinite(song.year) && song.year > 0
    ? Math.trunc(song.year)
    : null
}

export function songPlayCount(song: Pick<LibrarySong, 'playTimes'>): number | null {
  return typeof song.playTimes === 'number' &&
    Number.isFinite(song.playTimes) &&
    song.playTimes >= 0
    ? Math.trunc(song.playTimes)
    : null
}
