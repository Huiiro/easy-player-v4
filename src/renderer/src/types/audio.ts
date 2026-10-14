export interface TrackInfo {
  filePath?: string
  format: string
  sampleRate: number
  bitDepth: number
  channels: number
  durationMs: number
  bitrateKbps?: number
  codecName: string
  isDsd?: boolean
  dsdSampleRate?: number
  dsdTransport?: 'pcm_conversion' | 'dop' | 'native_dsd' | ''
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
  backend: 'wasapi_shared' | 'wasapi_exclusive' | 'asio' | 'directsound'
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

export interface AudioFormat {
  sampleRate: number
  bitDepth: number
  channels: number
}

export interface AudioChainStatus {
  sourceFormat: AudioFormat
  backendFormat: AudioFormat
  activeNodes: string[]
  bypassedNodes: string[]
  bitPerfectBlockers: string[]
  eqPeakDb: number
  eqAutoPreampDb: number
  isBitPerfectEligible: boolean
  bitPerfectVerificationState: 'blocked' | 'eligible_unverified' | 'verified'
  isBitPerfect: boolean
}

export interface EqBand {
  enabled: boolean
  frequencyHz: number
  gainDb: number
  q: number
}

export interface ResamplerConfig {
  forceOutputRate: boolean
  targetSampleRate: number
  quality: 'best' | 'medium' | 'fast'
}
export interface TransitionConfig {
  gaplessEnabled: boolean
  crossfadeEnabled: boolean
  crossfadeMs: number
  crossfadeAuto: boolean
  pauseFadeEnabled: boolean
  pauseFadeMs: number
}

export interface DspNodeConfig {
  id:
    | 'channel_matrix'
    | 'replay_gain'
    | 'preamp'
    | 'eq'
    | 'compressor'
    | 'delay'
    | 'reverb'
    | 'chorus'
    | 'noise_gate'
    | 'phaser'
    | 'stereo_field'
    | 'crossfeed'
    | 'impulse_response'
    | 'limiter'
  enabled: boolean
}
export interface CompressorConfig {
  thresholdDb: number
  ratio: number
  attackMs: number
  releaseMs: number
  makeupDb: number
}
export interface DelayConfig {
  delayMs: number
  feedback: number
  mix: number
}
export interface ChorusConfig {
  rateHz: number
  depthMs: number
  mix: number
}
export interface NoiseGateConfig {
  thresholdDb: number
  attackMs: number
  holdMs: number
  releaseMs: number
  rangeDb: number
}
export interface PhaserConfig {
  rateHz: number
  depth: number
  centerHz: number
  feedback: number
  mix: number
}
export interface ChannelMatrixConfig {
  enabled: boolean
  balance: number
  swapStereo: boolean
  monoDownmix: boolean
  outputGains: number[]
}
export interface StereoFieldConfig {
  enabled: boolean
  midDb: number
  sideDb: number
  width: number
}
export interface CrossfeedConfig {
  enabled: boolean
  strength: number
  cutoffHz: number
  delayMs: number
}
export interface ImpulseResponseConfig {
  enabled: boolean
  path: string
  autoGain: boolean
  gainDb: number
  autoPreampDb?: number
}

export interface LogEntry {
  id?: number
  level: 'debug' | 'info' | 'warn' | 'error'
  source?: 'main' | 'native' | 'renderer' | 'preload'
  message: string
  timestamp: number
}
