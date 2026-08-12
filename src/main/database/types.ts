export type SortOrder = 'asc' | 'desc'
export type SongSource = 'local' | 'remote' | 'all'

/** Database row shape. `bpm` is intentionally absent from the v1 schema. */
export interface Song {
  id: number
  title: string
  artist: string | null
  album: string | null
  duration: number | null
  cover: string | null
  coverAnalysisPath: string | null
  coverPrimary: string | null
  coverSecondary: string | null
  coverLyricsDark: number | null
  coverAnalysisVersion: number | null
  audio: string
  folderId: number
  isNewest: boolean
  lrc: string | null
  translation: string | null
  lyricFormat: string | null
  translationFormat: string | null
  romanization: string | null
  romanizationFormat: string | null
  year: number | null
  genre: string | null
  bitrate: number | null
  sampleRate: number | null
  bitDepth: number | null
  channels: number | null
  format: string | null
  fileName: string | null
  fileSize: number | null
  playTimes: number
  trackNo: number | null
  diskNo: number | null
  songStatus: number
  sourceId: number | null
  remoteId: string | null
  createdAt: string
  tags?: Tag[]
}

export interface SongQuery {
  page?: number
  size?: number
  search?: string
  source?: SongSource
  sourceId?: number
  sortBy?: 'id' | 'title' | 'artist' | 'album' | 'duration' | 'created_at' | 'play_time'
  sortOrder?: SortOrder
  tags?: number[]
}
export interface PagedResult<T> {
  data: T[]
  total: number
}
export interface Playlist {
  id: number
  name: string
  cover: string | null
  customCover: string | null
  description: string | null
  position: number
  createdAt: string
}
export interface PlaylistInput {
  name: string
  cover?: string | null
  description?: string | null
  customCover?: string | null
}
export interface Tag {
  id: number
  name: string
  color: string | null
  description: string | null
  tagOrder: number | null
  isIncluded?: boolean
}
export interface TagInput {
  name: string
  color?: string | null
  description?: string | null
}
export interface MusicSource {
  id: number
  name: string
  type: string | null
  server: string | null
  baseUrl: string | null
  user: string | null
  secret: string | null
  authType: string | null
  status: string | null
  sourceOrder: number
  importedCount: number
  songCount: number
  lastConnect: string | null
}
export interface MusicSourceInput {
  name: string
  type?: string | null
  server?: string | null
  baseUrl?: string | null
  user?: string | null
  secret?: string | null
  authType?: string | null
  status?: string | null
}
export interface LibraryFolder {
  id: number
  pid: number | null
  name: string
  fullPath: string
  isRootPath: boolean
  songCount: number
}
export interface DownloadTask {
  id: number
  platform: string | null
  resourceId: string | null
  subId: string | null
  title: string | null
  filePath: string | null
  quality: string | null
  extra: Record<string, unknown> | null
  status: string | null
  progress: number
  createdAt: string
}
export interface DownloadTaskInput {
  platform: string
  resourceId: string
  subId?: string | null
  title?: string | null
  filePath?: string | null
  quality?: string | null
  extra?: Record<string, unknown> | null
  status?: string | null
  progress?: number
}
export interface OverviewStats {
  songCount: number
  albumCount: number
  artistCount: number
  librarySize: number
  totalPlaySeconds: number
  todayPlaySeconds: number
}
export interface Album {
  albumName: string | null
  artistName: string | null
  songCount: number
  albumCover: string | null
}
export interface Artist {
  artistName: string | null
  songCount: number
  artistCover: string | null
}
export interface Genre {
  name: string
  count: number
}
export interface PlaylistMembership extends Playlist {
  isIncluded: boolean
}
export interface PlayHistoryInput {
  songId: number
  playlistId?: number | null
  playlistName?: string | null
  playedSeconds?: number
  startedAt: number
}
export interface PlayHistoryDay {
  date: string
  seconds: number
}
export interface RankedSong extends Song {
  value: number
}
