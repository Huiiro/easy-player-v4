export type LibraryKind = 'album' | 'artist' | 'genre'
type SortOrder = 'asc' | 'desc'

interface AlbumRow {
  albumName: string | null
  artistName: string | null
  songCount: number
  albumCover: string | null
}
interface ArtistRow {
  artistName: string | null
  songCount: number
  artistCover: string | null
}
interface GenreRow {
  name: string
  count: number
}
export interface GridItem {
  name: string
  value: string
  subtitle?: string
  subtitleValue?: string
  count: number
  cover: string | null
}

function valueOrUnknown(value: string | null, kind: LibraryKind): string {
  if (value?.trim()) return value
  return `__easy_player_unknown_${kind}__`
}
function displayName(value: string | null, unknownLabel: string): string {
  return value?.trim() || unknownLabel
}
export async function queryLibraryItems(
  kind: LibraryKind,
  order: SortOrder,
  search: string,
  separator: string,
  unknownLabel: string
): Promise<GridItem[]> {
  const action =
    kind === 'album' ? 'queryAlbums' : kind === 'artist' ? 'queryArtists' : 'queryGenres'
  const response = await window.api.database.command(action, {
    sort: order,
    search: search,
    separator: kind === 'artist' ? separator : undefined
  })
  if (!response.success) {
    return []
  }
  if (kind === 'album') {
    return (response.data as AlbumRow[]).map((item) => ({
      name: displayName(item.albumName, unknownLabel),
      value: valueOrUnknown(item.albumName, 'album'),
      subtitle: displayName(item.artistName, unknownLabel),
      subtitleValue: valueOrUnknown(item.artistName, 'artist'),
      count: item.songCount,
      cover: item.albumCover
    }))
  } else if (kind === 'artist') {
    return (response.data as ArtistRow[]).map((item) => ({
      name: displayName(item.artistName, unknownLabel),
      value: valueOrUnknown(item.artistName, 'artist'),
      count: item.songCount,
      cover: item.artistCover
    }))
  } else {
    return (response.data as GenreRow[]).map((item) => ({
      name: item.name === 'unknown_genre' ? unknownLabel : item.name,
      value: item.name === 'unknown_genre' ? '__easy_player_unknown_genre__' : item.name,
      count: item.count,
      cover: null
    }))
  }
}
