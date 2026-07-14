export interface TrackInfo {
  filePath: string
  format: string
  sampleRate: number
  bitDepth: number
  channels: number
  durationMs: number
  bitrateKbps?: number
  codecName: string
  metadata: {
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

export interface PlaybackState {
  state: 'idle' | 'loading' | 'ready' | 'playing' | 'paused' | 'stopped'
  positionMs: number
  durationMs: number
  volume: number
  glitchCount: number
  trackInfo: TrackInfo | null
}

// Engine state enum matching C++ EngineState
export enum EngineState {
  Idle = 0,
  Loading = 1,
  Ready = 2,
  Playing = 3,
  Paused = 4,
  Stopped = 5
}

// IPC channel constants
export const IPC = {
  COMMAND: 'audio:command',
  EVENT: 'audio:event'
} as const

export type AudioCommandAction =
  | 'open'
  | 'play'
  | 'pause'
  | 'stop'
  | 'seek'
  | 'setVolume'
  | 'enumerateDevices'
  | 'setDevice'
  | 'setBackend'
  | 'getStatus'
  | 'getTrackInfo'

export type AudioEventType =
  | 'stateChanged'
  | 'positionChanged'
  | 'trackEnded'
  | 'deviceListChanged'
  | 'audioChainChanged'
  | 'logEntry'
  | 'error'
