export interface TrackInfo {
  filePath: string
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
  backend: 'wasapi_shared' | 'wasapi_exclusive' | 'asio' | 'directsound'
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

export interface DspNodeConfig {
  id: 'compressor' | 'delay' | 'reverb' | 'chorus' | 'noise_gate' | 'phaser'
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
  | 'setPreamp'
  | 'setReplayGain'
  | 'getReplayGain'
  | 'setPlaybackSpeed'
  | 'getPlaybackSpeed'
  | 'setEqBands'
  | 'getEqBands'
  | 'setResamplerConfig'
  | 'getResamplerConfig'
  | 'setDopEnabled'
  | 'getDopEnabled'
  | 'setTransitionConfig'
  | 'getTransitionConfig'
  | 'setDspNodes'
  | 'getDspNodes'
  | 'setCompressorConfig'
  | 'getCompressorConfig'
  | 'setDelayConfig'
  | 'getDelayConfig'
  | 'setReverbConfig'
  | 'getReverbConfig'
  | 'setChorusConfig'
  | 'getChorusConfig'
  | 'setNoiseGateConfig'
  | 'getNoiseGateConfig'
  | 'setPhaserConfig'
  | 'getPhaserConfig'
  | 'setChannelMatrixConfig'
  | 'getChannelMatrixConfig'
  | 'setLimiter'
  | 'getLimiter'
  | 'enumerateDevices'
  | 'setDevice'
  | 'setBackend'
  | 'selectOutputDevice'
  | 'getOutputDeviceSettings'
  | 'getEngineInfo'
  | 'getStatus'
  | 'getAudioChain'
  | 'getAudioAnalysis'
  | 'setLoudnessAnalysisEnabled'
  | 'setSpectrumAnalysisEnabled'
  | 'getTrackInfo'

export type AudioEventType =
  | 'stateChanged'
  | 'positionChanged'
  | 'trackEnded'
  | 'deviceListChanged'
  | 'audioChainChanged'
  | 'error'
