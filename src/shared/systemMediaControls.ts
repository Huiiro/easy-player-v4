export type SystemMediaAction = 'play' | 'pause' | 'previous' | 'next'
export type SystemMediaPlaybackState =
  'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'stopped'

export interface SystemMediaTrack {
  filePath: string
  title: string
  artist: string
  album: string
  cover?: string
  canPrevious?: boolean
  canNext?: boolean
}

export interface SystemMediaSnapshot {
  revision: number
  hasTrack: boolean
  title: string
  artist: string
  album: string
  status: SystemMediaPlaybackState
  enabled: boolean
  canPrevious: boolean
  canNext: boolean
}

export interface SystemMediaControlsState {
  available: boolean
  enabled: boolean
}
