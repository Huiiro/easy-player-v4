import { t } from '../i18n'
import { ipcMain } from 'electron'
import * as library from '../database/repository'
import {
  getRecommendationScores,
  recordPlayEvent,
  setSongPreference
} from '../database/recommendations'
import { Logger } from '../service/loggerService'
import { logOperation, logParams } from '../service/operationLogger'
import {
  canRecordStatistics,
  clearStatisticsData,
  getStatisticsState,
  setStatisticsEnabled
} from '../database/statisticsControl'

export const DATABASE_IPC_CHANNEL = 'database:command'

type Handler = (params?: never) => unknown
const handlers = {
  getStatisticsState,
  setStatisticsEnabled: ({ enabled }: { enabled: boolean }) => setStatisticsEnabled(enabled),
  clearStatisticsData,
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
  getSongsByAlbum: ({
    album,
    artist,
    search
  }: {
    album: string
    artist?: string
    search?: string
  }) => library.getSongsByAlbum(album, artist, search),
  getSongsByGenre: ({ genre, search }: { genre: string; search?: string }) =>
    library.getSongsByGenre(genre, search),
  getSongsByArtist: ({
    artist,
    separator,
    search
  }: {
    artist: string
    separator?: string
    search?: string
  }) => library.getSongsByArtist(artist, separator, search),
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
  savePlayHistory: ({
    songId,
    startedAt,
    startOrigin,
    statisticsGeneration
  }: {
    songId: number
    startedAt: number
    startOrigin: Parameters<typeof library.savePlayHistory>[2]
    statisticsGeneration: string
  }) => {
    if (canRecordStatistics(statisticsGeneration))
      library.savePlayHistory(songId, startedAt, startOrigin)
  },
  queryRecentPlayedSongs: (params: Parameters<typeof library.queryRecentPlayedSongs>[0]) =>
    getStatisticsState().enabled ? library.queryRecentPlayedSongs(params) : { data: [], total: 0 },
  clearRecentPlayedSongs: () => library.clearRecentPlayedSongs(),
  getPlayHistoryDays: ({ days }: { days?: number } = {}) =>
    getStatisticsState().enabled ? library.getPlayHistoryDays(days) : [],
  getTopPlayedSongs: ({ limit }: { limit?: number } = {}) =>
    getStatisticsState().enabled ? library.getTopPlayedSongs(limit) : [],
  getTopDurationSongs: ({ limit }: { limit?: number } = {}) =>
    getStatisticsState().enabled ? library.getTopDurationSongs(limit) : [],
  getRecommendationScores: () => (getStatisticsState().enabled ? getRecommendationScores() : []),
  getRecommendations: ({ limit }: { limit?: number } = {}) =>
    getStatisticsState().enabled
      ? library.getRecommendations(limit)
      : {
          recommended: [],
          discovery: [],
          lessRecommended: [],
          totals: { recommended: 0, discovery: 0, lessRecommended: 0 },
          generatedFor: '',
          dataThrough: ''
        },
  getHomeRecommendations: () =>
    getStatisticsState().enabled ? library.getHomeRecommendations() : [],
  getHomeRecommendationSongs: ({
    group,
    generatedFor
  }: {
    group: Parameters<typeof library.getHomeRecommendationSongs>[0]
    generatedFor: string
  }) =>
    getStatisticsState().enabled ? library.getHomeRecommendationSongs(group, generatedFor) : [],
  getRecommendationPage: ({
    group,
    excludeSongIds,
    limit
  }: {
    group: Parameters<typeof library.getRecommendationPage>[0]
    excludeSongIds?: number[]
    limit?: number
  }) =>
    getStatisticsState().enabled
      ? library.getRecommendationPage(group, excludeSongIds, limit)
      : { items: [], total: 0, generatedFor: '' },
  recordPlayEvent: (
    params: Parameters<typeof recordPlayEvent>[0] & { statisticsGeneration: string }
  ) => {
    if (canRecordStatistics(params.statisticsGeneration)) recordPlayEvent(params)
  },
  setSongPreference: ({ songId, preference }: { songId: number; preference: -1 | 0 | 1 }) =>
    setSongPreference(songId, preference),

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
  setPlaylistCustomCover: ({
    id,
    path,
    dataUrl
  }: {
    id: number
    path: string | null
    dataUrl?: string
  }) => library.setPlaylistCustomCover(id, path, dataUrl),
  getLikedPlaylistCover: () => library.getLikedPlaylistCover(),
  setLikedPlaylistCustomCover: ({ path, dataUrl }: { path: string | null; dataUrl?: string }) =>
    library.setLikedPlaylistCustomCover(path, dataUrl),
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
  getLocalFolderSongs: ({ folderId, search }: { folderId: number; search?: string }) =>
    library.getLocalFolderSongs(folderId, search),
  deleteLocalFolderSongs: ({ folderId }: { folderId: number }) =>
    library.deleteLocalFolderSongs(folderId),
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
  getOverviewStats: () => (getStatisticsState().enabled ? library.getOverviewStats() : null)
}

export type DatabaseAction = keyof typeof handlers
export interface DatabaseRequest {
  action: DatabaseAction
  params?: unknown
}
export type DatabaseResponse<T = unknown> =
  { success: true; data: T } | { success: false; error: string }

export function registerDatabaseIpcHandlers(): void {
  ipcMain.on(
    'database:record-play-event-sync',
    (event, input: Parameters<typeof handlers.recordPlayEvent>[0]) => {
      try {
        handlers.recordPlayEvent(input)
        event.returnValue = { success: true }
      } catch (error) {
        event.returnValue = {
          success: false,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )
  ipcMain.handle(DATABASE_IPC_CHANNEL, (_event, request: DatabaseRequest): DatabaseResponse => {
    if (!request || typeof request.action !== 'string') {
      Logger.warn('[Database IPC] invalid request')
      return { success: false, error: t('invalidDatabaseRequest') }
    }
    const handler = handlers[request.action] as Handler | undefined
    if (!handler) {
      Logger.warn('[Database IPC] unknown action', { action: request.action })
      return { success: false, error: t('unknownDatabaseAction') }
    }
    try {
      return {
        success: true,
        data: logOperation(
          `[Database IPC] ${request.action}`,
          logParams(request.params),
          () => handler(request.params as never),
          { quiet: request.action === 'getSetting' }
        )
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
}
