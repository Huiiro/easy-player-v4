// Public repository API. Implementations are grouped by feature in ./repository/.
export { getAppSetting, setAppSetting } from './repository/settings'
export {
  querySongs,
  getSong,
  updateSongCoverAnalysis,
  queryAllSongs,
  updateSongLyrics,
  setSongStatus,
  refreshMissingSongStatus,
  checkMissingSongs,
  deleteSongs
} from './repository/songs'
export type { DeleteSongsResult } from './repository/songs'
export {
  getSongsByAlbum,
  getSongsByGenre,
  getSongsByArtist,
  queryAlbums,
  queryArtists,
  queryGenres,
  countSongsByAlbum,
  countSongsByArtist
} from './repository/catalog'
export {
  listLocalFolders,
  rebuildLocalFolders,
  getLocalFolderSongs,
  deleteLocalFolderSongs
} from './repository/folders'
export {
  savePlayHistory,
  queryRecentPlayedSongs,
  clearRecentPlayedSongs,
  getPlayHistoryDays,
  getTopPlayedSongs,
  getTopDurationSongs
} from './repository/playHistory'
export {
  listPlaylists,
  getPlaylist,
  createPlaylist,
  updatePlaylist,
  setPlaylistCustomCover,
  getLikedPlaylistCover,
  setLikedPlaylistCustomCover,
  deletePlaylists,
  reorderPlaylists,
  addSongsToPlaylist,
  removeSongsFromPlaylist,
  queryPlaylistSongs,
  listPlaylistMemberships
} from './repository/playlists'
export {
  listTags,
  createTag,
  updateTag,
  deleteTag,
  setSongTag,
  reorderTags,
  toggleSongTag
} from './repository/tags'
export {
  listSources,
  migrateSourceSecrets,
  createSource,
  updateSource,
  deleteSource,
  getSource,
  reorderSources,
  touchSource,
  updateSourceStats
} from './repository/sources'
export {
  listDownloadTasks,
  saveDownloadTask,
  deleteDownloadTask,
  hasCompletedDownload
} from './repository/downloads'
export {
  getHomeRecommendations,
  getHomeRecommendationSongs,
  getRecommendations,
  getRecommendationPage
} from './repository/recommendations'
export { getOverviewStats } from './repository/statistics'
