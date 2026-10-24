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
