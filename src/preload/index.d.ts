import { ElectronAPI } from '@electron-toolkit/preload'
import type { AudioChainStatus, CompressorConfig, DelayConfig, DeviceInfo, DspNodeConfig, EqBand, PlaybackStatus, ResamplerConfig, TransitionConfig } from '../renderer/src/types/audio'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      audio: {
        getFilePath(file: File): string
        open(filePath: string): Promise<{ success: boolean; data?: unknown; error?: string }>
        play(startPosition?: number): Promise<{ success: boolean }>
        pause(): Promise<{ success: boolean }>
        stop(): Promise<{ success: boolean }>
        seek(positionMs: number): Promise<{ success: boolean }>
        setVolume(volume: number): Promise<{ success: boolean }>
        setPreamp(db: number, enabled: boolean): Promise<{ success: boolean }>
        setReplayGain(config: { mode: 'off' | 'track' | 'album'; preventClipping: boolean }): Promise<{ success: boolean }>
        getReplayGain(): Promise<{ success: boolean; data?: { mode: 'off' | 'track' | 'album'; preventClipping: boolean; active: boolean; appliedGainDb: number }; error?: string }>
        setPlaybackSpeed(config: { enabled: boolean; speed: number }): Promise<{ success: boolean }>
        getPlaybackSpeed(): Promise<{ success: boolean; data?: { enabled: boolean; speed: number }; error?: string }>
        setEqBands(bands: EqBand[]): Promise<{ success: boolean }>
        getEqBands(): Promise<{ success: boolean; data?: EqBand[]; error?: string }>
        setResamplerConfig(config: ResamplerConfig): Promise<{ success: boolean }>
        getResamplerConfig(): Promise<{ success: boolean; data?: ResamplerConfig; error?: string }>
        setDopEnabled(enabled: boolean): Promise<{ success: boolean }>
        getDopEnabled(): Promise<{ success: boolean; data?: boolean; error?: string }>
        setTransitionConfig(config: TransitionConfig): Promise<{ success: boolean }>
        getTransitionConfig(): Promise<{ success: boolean; data?: TransitionConfig; error?: string }>
        setDspNodes(nodes: DspNodeConfig[]): Promise<{ success: boolean }>
        getDspNodes(): Promise<{ success: boolean; data?: DspNodeConfig[]; error?: string }>
        setCompressorConfig(config: CompressorConfig): Promise<{ success: boolean }>
        getCompressorConfig(): Promise<{ success: boolean; data?: CompressorConfig; error?: string }>
        setDelayConfig(config: DelayConfig): Promise<{ success: boolean }>
        getDelayConfig(): Promise<{ success: boolean; data?: DelayConfig; error?: string }>
        setReverbConfig(config: { roomSize: number; decay: number; mix: number }): Promise<{ success: boolean }>
        getReverbConfig(): Promise<{ success: boolean; data?: { roomSize: number; decay: number; mix: number }; error?: string }>
        setChorusConfig(config: { rateHz: number; depthMs: number; mix: number }): Promise<{ success: boolean }>
        getChorusConfig(): Promise<{ success: boolean; data?: { rateHz: number; depthMs: number; mix: number }; error?: string }>
        setNoiseGateConfig(config: { thresholdDb: number; attackMs: number; holdMs: number; releaseMs: number; rangeDb: number }): Promise<{ success: boolean }>
        getNoiseGateConfig(): Promise<{ success: boolean; data?: { thresholdDb: number; attackMs: number; holdMs: number; releaseMs: number; rangeDb: number }; error?: string }>
        setPhaserConfig(config: { rateHz: number; depth: number; centerHz: number; feedback: number; mix: number }): Promise<{ success: boolean }>
        getPhaserConfig(): Promise<{ success: boolean; data?: { rateHz: number; depth: number; centerHz: number; feedback: number; mix: number }; error?: string }>
        setChannelMatrixConfig(config: { enabled: boolean; balance: number; swapStereo: boolean; monoDownmix: boolean; outputGains: number[] }): Promise<{ success: boolean }>
        getChannelMatrixConfig(): Promise<{ success: boolean; data?: { enabled: boolean; balance: number; swapStereo: boolean; monoDownmix: boolean; outputGains: number[] }; error?: string }>
        setLimiter(config: { enabled: boolean; ceilingDb: number; releaseMs: number }): Promise<{ success: boolean }>
        getLimiter(): Promise<{ success: boolean; data?: { enabled: boolean; ceilingDb: number; releaseMs: number }; error?: string }>
        enumerateDevices(): Promise<{ success: boolean; data?: DeviceInfo[]; error?: string }>
        setDevice(deviceId: string): Promise<{ success: boolean }>
        setBackend(backend: string): Promise<{ success: boolean }>
        selectOutputDevice(backend: string, deviceId: string): Promise<{ success: boolean }>
        getOutputDeviceSettings(): Promise<{ success: boolean; data?: { backend: string; deviceId: string }; error?: string }>
        getEngineInfo(): Promise<{ success: boolean; data?: { version: string; outputDevice: { backend: string; deviceId: string } }; error?: string }>
        getStatus(): Promise<{ success: boolean; data?: PlaybackStatus; error?: string }>
        getAudioChain(): Promise<{ success: boolean; data?: AudioChainStatus; error?: string }>
        getAudioAnalysis(): Promise<{ success: boolean; data?: { outputTimeMs: number; analysisTimeMs: number; analysisLatencyMs: number; rms: number; lowEnergy: number; onsetStrength: number; droppedFrames: number; beatSequence: number; bpm: number; momentaryLufs: number; shortTermLufs: number; integratedLufs: number; spectrum: number[] }; error?: string }>

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onEvent(type: string, callback: (data: any) => void): () => void
        onStateChanged(callback: (data: { state: string; trackInfo: unknown }) => void): () => void
        onPositionChanged(callback: (data: { positionMs: number; durationMs: number }) => void): () => void
        onTrackEnded(callback: (data: { reason: string }) => void): () => void
        onAudioChainChanged(callback: (data: AudioChainStatus) => void): () => void
        onError(callback: (data: { code: number; message: string; recoverable: boolean }) => void): () => void
        onLogEntry(callback: (data: { level: string; message: string; timestamp: number }) => void): () => void
      }
    }
  }
}
