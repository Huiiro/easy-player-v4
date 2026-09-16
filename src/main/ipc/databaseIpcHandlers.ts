import { ipcMain } from 'electron'
import * as library from '../database/repository'

export const DATABASE_IPC_CHANNEL = 'database:command'

type Handler = (params?: never) => unknown
const handlers = {
  getSetting: ({ key }: { key: string }) => library.getAppSetting(key),
  setSetting: ({ key, value }: { key: string; value: unknown }) =>
    library.setAppSetting(key, value),
  querySongs: (params: Parameters<typeof library.querySongs>[0]) => library.querySongs(params),
  queryAllSongs: () => library.queryAllSongs(),
  getSong: ({ id }: { id: number }) => library.getSong(id),
  updateSongCoverAnalysis: ({
    id,
    analysis
  }: {
    id: number
    analysis: Parameters<typeof library.updateSongCoverAnalysis>[1]
  }) => library.updateSongCoverAnalysis(id, analysis),
  getSongsByAlbum: ({ album, artist }: { album: string; artist?: string }) =>
    library.getSongsByAlbum(album, artist),
  getSongsByGenre: ({ genre }: { genre: string }) => library.getSongsByGenre(genre),
  getSongsByArtist: ({ artist, separator }: { artist: string; separator?: string }) =>
    library.getSongsByArtist(artist, separator),
  queryAlbums: ({ sort, search }: { sort?: 'asc' | 'desc'; search?: string } = {}) =>
    library.queryAlbums(sort, search),
  queryArtists: ({
    sort,
    search,
    separator
  }: { sort?: 'asc' | 'desc'; search?: string; separator?: string } = {}) =>
    library.queryArtists(sort, search, separator),
  queryGenres: ({ sort, search }: { sort?: 'asc' | 'desc'; search?: string } = {}) =>
    library.queryGenres(sort, search),
  countSongsByAlbum: ({ album, artist }: { album: string; artist: string | null }) =>
    library.countSongsByAlbum(album, artist),
  countSongsByArtist: ({ artist }: { artist: string | null }) => library.countSongsByArtist(artist),
  updateSongLyrics: ({
    id,
    ...payload
  }: Parameters<typeof library.updateSongLyrics>[1] & { id: number }) =>
    library.updateSongLyrics(id, payload),
  setSongStatus: ({ id, status }: { id: number; status: number }) =>
    library.setSongStatus(id, status),
  refreshMissingSongStatus: () => library.refreshMissingSongStatus(),
  checkMissingSongs: () => library.checkMissingSongs(),
  savePlayHistory: ({ songId }: { songId: number }) => library.savePlayHistory(songId),
  queryRecentPlayedSongs: (params: Parameters<typeof library.queryRecentPlayedSongs>[0]) =>
    library.queryRecentPlayedSongs(params),
  clearRecentPlayedSongs: () => library.clearRecentPlayedSongs(),
  savePlayHistoryDetail: (params: Parameters<typeof library.savePlayHistoryDetail>[0]) =>
    library.savePlayHistoryDetail(params),
  getPlayHistoryDays: ({ days }: { days?: number } = {}) => library.getPlayHistoryDays(days),
  getTopPlayedSongs: ({ limit }: { limit?: number } = {}) => library.getTopPlayedSongs(limit),
  getTopDurationSongs: ({ limit }: { limit?: number } = {}) => library.getTopDurationSongs(limit),

  listPlaylists: () => library.listPlaylists(),
  getPlaylist: ({ id }: { id: number }) => library.getPlaylist(id),
  createPlaylist: (params: Parameters<typeof library.createPlaylist>[0]) =>
    library.createPlaylist(params),
  updatePlaylist: ({
    id,
    input
  }: {
    id: number
    input: Parameters<typeof library.updatePlaylist>[1]
  }) => library.updatePlaylist(id, input),
  setPlaylistCustomCover: ({ id, path }: { id: number; path: string | null }) =>
    library.setPlaylistCustomCover(id, path),
  deletePlaylists: ({ ids }: { ids: number[] }) => library.deletePlaylists(ids),
  reorderPlaylists: ({ items }: { items: Array<{ id: number; position: number }> }) =>
    library.reorderPlaylists(items),
  addSongsToPlaylist: ({ playlistId, songIds }: { playlistId: number; songIds: number[] }) =>
    library.addSongsToPlaylist(playlistId, songIds),
  removeSongsFromPlaylist: ({ playlistId, songIds }: { playlistId: number; songIds: number[] }) =>
    library.removeSongsFromPlaylist(playlistId, songIds),
  deleteSongs: ({ songIds, deleteLocalFiles }: { songIds: number[]; deleteLocalFiles?: boolean }) =>
    library.deleteSongs(songIds, deleteLocalFiles === true),
  queryPlaylistSongs: ({
    playlistId,
    query
  }: {
    playlistId: number
    query?: Parameters<typeof library.queryPlaylistSongs>[1]
  }) => library.queryPlaylistSongs(playlistId, query),
  listPlaylistMemberships: ({ songId }: { songId: number }) =>
    library.listPlaylistMemberships(songId),

  listTags: (params?: { songId?: number }) => library.listTags(params?.songId),
  createTag: (params: Parameters<typeof library.createTag>[0]) => library.createTag(params),
  updateTag: ({ id, input }: { id: number; input: Parameters<typeof library.updateTag>[1] }) =>
    library.updateTag(id, input),
  deleteTag: ({ id }: { id: number }) => library.deleteTag(id),
  setSongTag: ({
    tagId,
    songIds,
    included
  }: {
    tagId: number
    songIds: number[]
    included: boolean
  }) => library.setSongTag(tagId, songIds, included),
  reorderTags: ({ ids }: { ids: number[] }) => library.reorderTags(ids),
  toggleSongTag: ({ tagId, songId }: { tagId: number; songId: number }) =>
    library.toggleSongTag(tagId, songId),

  listSources: () => library.listSources(),
  listLocalFolders: () => library.listLocalFolders(),
  rebuildLocalFolders: () => library.rebuildLocalFolders(),
  getLocalFolderSongs: ({ folderId }: { folderId: number }) =>
    library.getLocalFolderSongs(folderId),
  getSource: ({ id }: { id: number }) => library.getSource(id),
  createSource: (params: Parameters<typeof library.createSource>[0]) =>
    library.createSource(params),
  updateSource: (params: Parameters<typeof library.updateSource>[0]) =>
    library.updateSource(params),
  deleteSource: ({ id }: { id: number }) => library.deleteSource(id),
  reorderSources: ({ items }: { items: Array<{ id: number; sourceOrder: number }> }) =>
    library.reorderSources(items),
  touchSource: ({ id }: { id: number }) => library.touchSource(id),
  updateSourceStats: ({
    id,
    importedCount,
    songCount
  }: {
    id: number
    importedCount: number
    songCount: number
  }) => library.updateSourceStats(id, importedCount, songCount),

  listDownloadTasks: () => library.listDownloadTasks(),
  saveDownloadTask: (params: Parameters<typeof library.saveDownloadTask>[0]) =>
    library.saveDownloadTask(params),
  deleteDownloadTask: (params?: { id?: number }) => library.deleteDownloadTask(params?.id),
  hasCompletedDownload: ({
    platform,
    resourceId,
    subId
  }: {
    platform: string
    resourceId: string
    subId?: string
  }) => library.hasCompletedDownload(platform, resourceId, subId),
  getOverviewStats: () => library.getOverviewStats()
}

export type DatabaseAction = keyof typeof handlers
export interface DatabaseRequest {
  action: DatabaseAction
  params?: unknown
}
export type DatabaseResponse<T = unknown> =
  { success: true; data: T } | { success: false; error: string }

export function registerDatabaseIpcHandlers(): void {
  ipcMain.handle(DATABASE_IPC_CHANNEL, (_event, request: DatabaseRequest): DatabaseResponse => {
    if (!request || typeof request.action !== 'string')
      return { success: false, error: 'Invalid database request' }
    const handler = handlers[request.action] as Handler | undefined
    if (!handler) return { success: false, error: 'Unknown database action' }
    try {
      return { success: true, data: handler(request.params as never) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
