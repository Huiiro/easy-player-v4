import type { SourceTrackMetadata } from '../../packages/plugin-sdk/src/sourceMetadata'
export * from '../../packages/plugin-sdk/src/sourceMetadata'

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
