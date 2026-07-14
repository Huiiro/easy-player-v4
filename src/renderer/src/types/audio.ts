export interface TrackInfo {
  filePath?: string
  format: string
  sampleRate: number
  bitDepth: number
  channels: number
  durationMs: number
  bitrateKbps?: number
  codecName: string
  metadata?: {
    title?: string
    artist?: string
    album?: string
    trackNumber?: number
    genre?: string
  }
}

export interface DeviceInfo {
  id: string
  name: string
  backend: string
  isDefault: boolean
  maxChannels: number
}

export type PlaybackState = 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'stopped'

export interface PlaybackStatus {
  state: PlaybackState
  positionMs: number
  durationMs: number
  volume: number
  glitchCount: number
  trackInfo: TrackInfo | null
}

export interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
  timestamp: number
}
