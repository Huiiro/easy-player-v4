import type { RemoteConnection, RemoteProviderId } from '../../shared/remoteSources'
import type { MusicSource } from '../database/types'

export type ConfiguredSource = MusicSource
export interface RemoteTrack {
  id: string
  title: string
  artist?: string
  album?: string
  duration?: number
  coverId?: string
  year?: number
  genre?: string
  bitrate?: number
  sampleRate?: number
  bitDepth?: number
  channels?: number
  format?: string
  path?: string
  size?: number
  track?: number
  discNumber?: number
}

export interface RemoteProvider {
  readonly id: RemoteProviderId
  test(config: RemoteConnection): Promise<{ version: string }>
  listTracks(source: ConfiguredSource): Promise<RemoteTrack[]>
  fetchCover(source: ConfiguredSource, coverId: string): Promise<Response>
  fetchStream(source: ConfiguredSource, trackId: string): Promise<Response>
}
