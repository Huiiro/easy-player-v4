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

export function songListRowHeight(compact: boolean, small = false): number {
  return small ? 40 : compact ? 56 : 64
}

export function songListLayout(columns: SongListColumns, small = false): Record<string, string> {
  const tracks = small
    ? ['2.25rem', 'minmax(10rem,2fr)', 'minmax(6rem,1fr)', 'minmax(7rem,1.2fr)']
    : ['2.5rem', 'minmax(12rem,2fr)', 'minmax(7rem,1fr)', 'minmax(8rem,1.2fr)']
  let minimum = small ? 28.25 : 33
  for (const [column, width] of [
    ['genre', small ? 5 : 6],
    ['year', small ? 3 : 3.5],
    ['playTimes', small ? 4 : 4.5],
    ['disableNetworkLyrics', small ? 1.75 : 2.25],
    ['instrumental', small ? 1.75 : 2.25],
    ['preference', small ? 1.75 : 2.25],
    ['remoteSource', small ? 1.75 : 2.25]
  ] as const) {
    if (!columns[column]) continue
    tracks.push(`${width}rem`)
    minimum += width
  }
  tracks.push(small ? '3rem' : '3.5rem')
  // Include the row's horizontal padding and inter-column gaps.
  return {
    '--song-list-grid-columns': tracks.join(' '),
    '--song-list-min-width': `${minimum + (small ? 2 : 2.5) + (tracks.length - 1) * (small ? 0.5 : 0.75)}rem`,
    '--song-list-gap': small ? '0.5rem' : '0.75rem',
    '--song-list-padding-inline': small ? '1rem' : '1.25rem'
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
