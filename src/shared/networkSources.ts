/** Serializable contracts for optional sources; no Electron or renderer dependencies. */
export interface SourceResourceRef {
  sourceId: string
  resourceType: 'track' | 'album' | 'artist' | 'video'
  resourceId: string
  subId?: string
}
export interface MetadataQuery {
  title: string
  artist?: string | null
  album?: string | null
}
export type LyricFormat = 'lrc' | 'elrc' | 'yrc' | 'krc' | 'ttml' | 'plain'
export interface LyricSearchRequest extends MetadataQuery {
  preferWordTimed?: boolean
}
/** Compatibility payload used by the existing lyric adapters. */
export interface ProviderLyricCandidate {
  id: string
  resourceId: string
  title: string
  artist: string
  album?: string
  lrc: string
  format?: LyricFormat
  supportsWordTiming: boolean
  translation?: string
  translationFormat?: LyricFormat
  romanization?: string
  romanizationFormat?: LyricFormat
}
export interface NetworkLyricCandidate extends ProviderLyricCandidate {
  provider: string
  providerName: string
  resource: SourceResourceRef
}
export interface ArtworkCandidate {
  id: string
  title: string
  artist: string
  album: string
  imageUrl: string
  resource: SourceResourceRef
}
export type DownloadType = 'audio' | 'video'
export type DownloadQuality = 'best' | 'high' | 'standard' | 'compact'
export interface MediaSearchItem {
  platform: string
  selected?: boolean
  id: string
  title: string
  url: string
  thumbnail: string | null
  thumbnailUrl?: string | null
  duration: number | null
  uploader: string | null
  resource: SourceResourceRef
}
/** Provider input deliberately excludes the destination directory and task/window identity. */
export interface MediaDownloadQuery {
  url: string
  resourceId: string
  downloadType: DownloadType
  quality: DownloadQuality
}
export interface HttpMediaDownloadPlan {
  transport: 'http'
  resource: SourceResourceRef
  url: string
  headers: Record<string, string>
  extension: 'm4a' | 'mp4'
  artwork?: { url: string; headers: Record<string, string> }
  finalizeAudio: boolean
}
export interface YtDlpDownloadPlan {
  transport: 'yt-dlp'
  resource: SourceResourceRef
  url: string
  downloadType: DownloadType
  quality: DownloadQuality
}
export type MediaDownloadPlan = HttpMediaDownloadPlan | YtDlpDownloadPlan

export const NETWORK_SOURCE_CAPABILITIES = ['lyrics', 'artwork', 'metadata', 'download'] as const
export type NetworkSourceCapability = (typeof NETWORK_SOURCE_CAPABILITIES)[number]
/** Read-only source descriptors; provider functions and credentials never cross IPC. */
export interface NetworkSourceInfo {
  pluginId?: string
  pluginState?: import('./plugins').PluginState
  id: string
  displayName: string
  version?: string
  apiVersion: number
  origin: 'official'
  enabled: boolean
  capabilities: NetworkSourceCapability[]
}
export interface NetworkSourceResult<T> {
  failure?: SourceFailure
  success: boolean
  data?: T
  error?: string
}

export type SourceErrorCode =
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'SOURCE_DISABLED'
  | 'SOURCE_NOT_FOUND'
  | 'UNSUPPORTED_CAPABILITY'
  | 'NETWORK'
  | 'AUTH_REQUIRED'
  | 'RATE_LIMITED'
  | 'RESOURCE_NOT_FOUND'
  | 'INVALID_RESPONSE'
  | 'INVALID_REQUEST'
  | 'BACKGROUND_PAUSED'
  | 'PROVIDER_ERROR'
export interface SourceFailure {
  code: SourceErrorCode
  message: string
  retryable: boolean
  sourceId?: string
  operation?: string
}
export interface SourceRequestOptions {
  requestId?: string
}
export type SourceRequest = SourceRequestOptions &
  (
    | { operation: 'metadata.search'; sourceId: string; query: string }
    | { operation: 'metadata.get' | 'lyrics.get'; resource: SourceResourceRef }
    | { operation: 'lyrics.search'; query: LyricSearchRequest }
    | { operation: 'artwork.search'; query: MetadataQuery; previews?: boolean }
    | { operation: 'artwork.fetch'; imageUrl: string }
    | { operation: 'download.search'; sourceId: string; query: string }
    | { operation: 'download.parse'; url: string }
  )
