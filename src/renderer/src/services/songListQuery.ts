import type { DatabaseAction } from '../../../main/ipc/databaseIpcHandlers'
import type { LibrarySong, PagedLibrarySongs } from '@/types/library'
import type { RecommendationGroup } from '@/views/home/types'

export type SongListSource =
  | { type: 'songs' | 'local' | 'remote' | 'history' | 'liked' }
  | { type: 'playlist'; id: number }
  | { type: 'folder'; id: number }
  | { type: 'album'; album: string; artist?: string }
  | { type: 'artist'; artist: string }
  | { type: 'genre'; genre: string }
  | { type: 'recommendation'; group: RecommendationGroup; generatedFor: string }
export async function querySongList(options: {
  source: SongListSource
  search: string
  tags: number[]
  sourceFilter: string
  artistSeparator: string
  statistics: { enabled: boolean; generation: string }
}): Promise<LibrarySong[]> {
  const { source, search: appliedSearch, tags, sourceFilter, artistSeparator, statistics } = options
  const { type } = source
  const requiresStatistics = type === 'history' || type === 'recommendation'
  if (requiresStatistics && !statistics.enabled) return []
  const statisticsGeneration = statistics.generation

  const getCommand = (): { name: DatabaseAction; params: unknown } => {
    switch (type) {
      case 'recommendation':
        return {
          name: 'getHomeRecommendationSongs',
          params: { group: source.group, generatedFor: source.generatedFor }
        }
      case 'playlist':
        return {
          name: 'queryPlaylistSongs',
          params: {
            playlistId: source.id,
            query: { tags: [...tags], search: appliedSearch }
          }
        }
      case 'folder':
        return {
          name: 'getLocalFolderSongs',
          params: { folderId: source.id, search: appliedSearch }
        }
      case 'album':
        return {
          name: 'getSongsByAlbum',
          params: {
            album: source.album,
            artist: source.artist,
            search: appliedSearch
          }
        }
      case 'artist':
        return {
          name: 'getSongsByArtist',
          params: {
            artist: source.artist,
            separator: artistSeparator,
            search: appliedSearch
          }
        }
      case 'genre':
        return {
          name: 'getSongsByGenre',
          params: { genre: source.genre, search: appliedSearch }
        }
      case 'history':
        return {
          name: 'queryRecentPlayedSongs',
          params: { search: appliedSearch }
        }
      case 'liked':
        return {
          name: 'querySongs',
          params: { preference: 1, tags: [...tags], search: appliedSearch }
        }
      default: {
        const sourceParam =
          type === 'local'
            ? 'local'
            : type === 'remote'
              ? 'remote'
              : sourceFilter === 'local'
                ? 'local'
                : sourceFilter.startsWith('remote:') || sourceFilter === 'remote'
                  ? 'remote'
                  : 'all'

        return {
          name: 'querySongs',
          params: {
            search: appliedSearch,
            tags: [...tags],
            source: sourceParam,
            sourceId: sourceFilter.startsWith('remote:')
              ? Number(sourceFilter.slice('remote:'.length))
              : undefined
          }
        }
      }
    }
  }

  const { name, params } = getCommand()
  const response = await window.api.database.command(name, params)
  if (requiresStatistics && (!statistics.enabled || statisticsGeneration !== statistics.generation))
    return []

  if (!response.success) throw new Error(response.error)
  const data = response.data as LibrarySong[] | PagedLibrarySongs
  const result = Array.isArray(data) ? data : data.data
  if (type === 'recommendation' && appliedSearch) {
    // Use the shared search index, then restrict results to this dated collection.
    const search = await window.api.database.command('querySongs', { search: appliedSearch })
    if (!statistics.enabled || statisticsGeneration !== statistics.generation) return []
    if (!search.success) throw new Error(search.error)
    const matches = new Map(
      (search.data as PagedLibrarySongs).data.map((song) => [song.id, song.searchScore])
    )
    return result
      .filter((song) => matches.has(song.id))
      .map((song) => ({ ...song, searchScore: matches.get(song.id) }))
  }
  return result
}
