import type { AudioChainStatus, ChannelMatrixConfig, ChorusConfig, CompressorConfig, DelayConfig, DeviceInfo, DspNodeConfig, EqBand, NoiseGateConfig, PhaserConfig, PlaybackStatus, ResamplerConfig } from '../types/audio'

// ── Typed wrapper around window.api.audio ──

function cmd<T = unknown>(result: { success: boolean; data?: T; error?: string }): T | null {
  if (!result.success) {
    console.warn('[audioBridge] Command failed:', result.error)
    return null
  }
  return (result.data as T) ?? null
}

export const audioBridge = {
  async open(filePath: string): Promise<boolean> {
    const r = await window.api.audio.open(filePath)
    return r.success
  },

  async play(startPosition?: number): Promise<boolean> {
    const r = await window.api.audio.play(startPosition)
    return r.success
  },

  async pause(): Promise<boolean> {
    const r = await window.api.audio.pause()
    return r.success
  },

  async stop(): Promise<boolean> {
    const r = await window.api.audio.stop()
    return r.success
  },

  async seek(positionMs: number): Promise<boolean> {
    const r = await window.api.audio.seek(positionMs)
    return r.success
  },

  async setVolume(volume: number): Promise<void> {
    await window.api.audio.setVolume(volume)
  },

  async setPreamp(db: number, enabled: boolean): Promise<void> {
    await window.api.audio.setPreamp(db, enabled)
  },
  async setReplayGain(config: { mode: 'off' | 'track' | 'album'; preventClipping: boolean }): Promise<boolean> { return (await window.api.audio.setReplayGain(config)).success },
  async getReplayGain(): Promise<{ mode: 'off' | 'track' | 'album'; preventClipping: boolean; active: boolean; appliedGainDb: number } | null> { return cmd(await window.api.audio.getReplayGain()) },
  async setPlaybackSpeed(config: { enabled: boolean; speed: number }): Promise<boolean> { return (await window.api.audio.setPlaybackSpeed(config)).success },
  async getPlaybackSpeed(): Promise<{ enabled: boolean; speed: number } | null> { return cmd(await window.api.audio.getPlaybackSpeed()) },

  async setEqBands(bands: EqBand[]): Promise<boolean> {
    const r = await window.api.audio.setEqBands(bands)
    return r.success
  },

  async getEqBands(): Promise<EqBand[]> {
    const r = await window.api.audio.getEqBands()
    return cmd<EqBand[]>(r) ?? []
  },

  async setResamplerConfig(config: ResamplerConfig): Promise<boolean> {
    const r = await window.api.audio.setResamplerConfig(config)
    return r.success
  },

  async getResamplerConfig(): Promise<ResamplerConfig | null> {
    const r = await window.api.audio.getResamplerConfig()
    return cmd<ResamplerConfig>(r)
  },

  async setDspNodes(nodes: DspNodeConfig[]): Promise<boolean> {
    const r = await window.api.audio.setDspNodes(nodes)
    return r.success
  },

  async getDspNodes(): Promise<DspNodeConfig[]> {
    const r = await window.api.audio.getDspNodes()
    return cmd<DspNodeConfig[]>(r) ?? []
  },
  async setCompressorConfig(config: CompressorConfig): Promise<boolean> {
    const r = await window.api.audio.setCompressorConfig(config)
    return r.success
  },
  async getCompressorConfig(): Promise<CompressorConfig | null> {
    return cmd<CompressorConfig>(await window.api.audio.getCompressorConfig())
  },
  async setDelayConfig(config: DelayConfig): Promise<boolean> { return (await window.api.audio.setDelayConfig(config)).success },
  async getDelayConfig(): Promise<DelayConfig | null> { return cmd<DelayConfig>(await window.api.audio.getDelayConfig()) },
  async setReverbConfig(config: { roomSize: number; decay: number; mix: number }): Promise<boolean> { return (await window.api.audio.setReverbConfig(config)).success },
  async getReverbConfig(): Promise<{ roomSize: number; decay: number; mix: number } | null> { return cmd(await window.api.audio.getReverbConfig()) },
  async setChorusConfig(config: ChorusConfig): Promise<boolean> { return (await window.api.audio.setChorusConfig(config)).success },
  async getChorusConfig(): Promise<ChorusConfig | null> { return cmd<ChorusConfig>(await window.api.audio.getChorusConfig()) },
  async setNoiseGateConfig(config: NoiseGateConfig): Promise<boolean> { return (await window.api.audio.setNoiseGateConfig(config)).success },
  async getNoiseGateConfig(): Promise<NoiseGateConfig | null> { return cmd<NoiseGateConfig>(await window.api.audio.getNoiseGateConfig()) },
  async setPhaserConfig(config: PhaserConfig): Promise<boolean> { return (await window.api.audio.setPhaserConfig(config)).success },
  async getPhaserConfig(): Promise<PhaserConfig | null> { return cmd<PhaserConfig>(await window.api.audio.getPhaserConfig()) },
  async setChannelMatrixConfig(config: ChannelMatrixConfig): Promise<boolean> { return (await window.api.audio.setChannelMatrixConfig(config)).success },
  async getChannelMatrixConfig(): Promise<ChannelMatrixConfig | null> { return cmd<ChannelMatrixConfig>(await window.api.audio.getChannelMatrixConfig()) },
  async setLimiter(config: { enabled: boolean; ceilingDb: number; releaseMs: number }): Promise<boolean> { return (await window.api.audio.setLimiter(config)).success },
  async getLimiter(): Promise<{ enabled: boolean; ceilingDb: number; releaseMs: number } | null> { return cmd(await window.api.audio.getLimiter()) },

  async enumerateDevices(): Promise<DeviceInfo[]> {
    const r = await window.api.audio.enumerateDevices()
    return cmd<DeviceInfo[]>(r) ?? []
  },

  async setDevice(deviceId: string): Promise<void> {
    await window.api.audio.setDevice(deviceId)
  },

  async setBackend(backend: string): Promise<boolean> {
    const r = await window.api.audio.setBackend(backend)
    return r.success
  },

  async selectOutputDevice(backend: string, deviceId: string): Promise<boolean> {
    const r = await window.api.audio.selectOutputDevice(backend, deviceId)
    return r.success
  },

  async getStatus(): Promise<PlaybackStatus | null> {
    const r = await window.api.audio.getStatus()
    return cmd<PlaybackStatus>(r)
  },

  async getAudioChain(): Promise<AudioChainStatus | null> {
    const r = await window.api.audio.getAudioChain()
    return cmd<AudioChainStatus>(r)
  },
  async getAudioAnalysis(): Promise<{ outputTimeMs: number; analysisTimeMs: number; analysisLatencyMs: number; rms: number; lowEnergy: number; onsetStrength: number; droppedFrames: number; beatSequence: number; bpm: number; momentaryLufs: number; shortTermLufs: number; integratedLufs: number; spectrum: number[] } | null> { return cmd(await window.api.audio.getAudioAnalysis()) },

  // Events
  onStateChanged(callback: (data: { state: string; trackInfo: unknown }) => void): () => void {
    return window.api.audio.onStateChanged(callback)
  },

  onPositionChanged(callback: (data: { positionMs: number; durationMs: number }) => void): () => void {
    return window.api.audio.onPositionChanged(callback)
  },

  onError(callback: (data: { code: number; message: string; recoverable: boolean }) => void): () => void {
    return window.api.audio.onError(callback)
  },

  onLogEntry(callback: (data: { level: string; message: string; timestamp: number }) => void): () => void {
    return window.api.audio.onLogEntry(callback)
  },

  onAudioChainChanged(callback: (data: AudioChainStatus) => void): () => void {
    return window.api.audio.onAudioChainChanged(callback)
  }
}
