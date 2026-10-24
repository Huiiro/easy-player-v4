import type { ArtworkCandidate, SourceResourceRef } from './networkSources'

export const SOURCE_METADATA_FIELDS = [
  'title',
  'artist',
  'album',
  'albumArtist',
  'genre',
  'year',
  'trackNumber',
  'discNumber'
] as const
export type SourceMetadataField = (typeof SOURCE_METADATA_FIELDS)[number]
export interface SourceTrackMetadata {
  title?: string
  artist?: string
  album?: string
  albumArtist?: string
  genre?: string
  year?: number
  trackNumber?: number
  discNumber?: number
}
export interface SourceTrackSummary {
  resource: SourceResourceRef
  title: string
  artist: string
  album?: string
  durationMs?: number
}
export interface SourceTrackDetail extends SourceTrackSummary {
  metadata: SourceTrackMetadata
  releaseDate?: string
  artwork?: ArtworkCandidate
}
export type SourceMetadataPatch = SourceTrackMetadata & { lyrics?: string; coverDataUrl?: string }
export interface SourceMetadataSnapshot {
  metadata: SourceMetadataPatch
  hasCover: boolean
  /** Compare-and-set token for the audio file. */
  revision: string
}
export interface ApplySourceMetadataRequest {
  songId: number
  expectedRevision: string
  patch: SourceMetadataPatch
}
export interface SourceApiResult<T> {
  failure?: import('./networkSources').SourceFailure
  success: boolean
  data?: T
  error?: string
}
