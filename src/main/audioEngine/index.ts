import { join } from 'path'
import { app } from 'electron'
import { Logger } from '../service/loggerService'
import { AudioChainStatus, DeviceInfo } from './types'
import {
  DspSettings,
  PersistedOutputBackend,
  loadDspSettings,
  saveDspSettings
} from './dspSettings'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nativeAddon: any = null

function loadNativeAddon(): boolean {
  if (nativeAddon) return true

  try {
    // In development: load from out/main/native/
    // In production: load from extraResources/native/
    const isDev = !app.isPackaged

    if (isDev) {
      // Development: load from build/native-addon/
      const addonPath = join(
        __dirname,
        '..',
        '..',
        'build',
        'native-addon',
        'easy_player_native.node'
      )
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      nativeAddon = require(addonPath)
    } else {
      const addonPath = join(process.resourcesPath, 'native', 'easy_player_native.node')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      nativeAddon = require(addonPath)
    }

    Logger.info('[AudioEngineManager] Native addon loaded successfully')
    return true
  } catch (err) {
    Logger.error('[AudioEngineManager] Failed to load native addon:', err)
    return false
  }
}

export function writeNativeMetadata(filePath: string, metadata: object): boolean {
  return loadNativeAddon() && nativeAddon?.writeMetadata?.(filePath, metadata) === true
}

export class AudioEngineManager {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private engine: any = null
  private isLoaded = false
  private dspSettings: DspSettings
  private dspSettingsSaveTimer: ReturnType<typeof setTimeout> | undefined

  constructor() {
    this.dspSettings = loadDspSettings()
    this.isLoaded = loadNativeAddon()
    if (this.isLoaded) {
      this.engine = new nativeAddon.AudioEngine()
      this.engine.onLog((level: number, message: string) => {
        const levels = ['debug', 'info', 'warn', 'error'] as const
        Logger.write(levels[level] ?? 'info', 'native', message)
      })
      this.restoreDspSettings()
      Logger.info(
        `[AudioEngineManager] Easy Player Audio Engine v${this.engine.getVersion?.() ?? 'unknown'} initialized`
      )
    }
  }

  get loaded(): boolean {
    return this.isLoaded && this.engine !== null
  }

  // ── Lifecycle ──

  open(filePath: string): boolean {
    if (!this.engine) return false
    return this.engine.open(filePath)
  }

  async openAsync(filePath: string): Promise<boolean> {
    if (!this.engine) return false
    // The Windows backends already switch tracks without stalling Electron's
    // message loop. CoreAudio teardown/open can wait noticeably on macOS, so
    // only macOS uses the N-API worker path.
    return process.platform === 'darwin'
      ? this.engine.openAsync(filePath)
      : this.engine.open(filePath)
  }

  play(): boolean {
    if (!this.engine) return false
    return this.engine.play()
  }

  pause(): boolean {
    if (!this.engine) return false
    return this.engine.pause()
  }

  stop(): boolean {
    if (!this.engine) return false
    return this.engine.stop()
  }

  async stopAsync(): Promise<boolean> {
    if (!this.engine) return false
    return process.platform === 'darwin' ? this.engine.stopAsync() : this.engine.stop()
  }

  seek(positionMs: number): boolean {
    if (!this.engine) return false
    return this.engine.seek(positionMs)
  }

  // ── Control ──

  setVolume(volume: number): void {
    this.engine?.setVolume(volume)
    this.dspSettings.volume = Math.max(0, Math.min(1, volume))
    this.persistDspSettings()
  }

  setPreamp(db: number, enabled: boolean): void {
    this.engine?.setPreamp(db, enabled)
    this.dspSettings.preamp = { db: Math.max(-24, Math.min(24, db)), enabled }
    this.persistDspSettings()
  }
  setReplayGain(config: { mode: 'off' | 'track' | 'album'; preventClipping: boolean }): boolean {
    const ok = this.engine?.setReplayGain(config) ?? false
    if (ok) {
      this.dspSettings.replayGain = config
      this.persistDspSettings()
    }
    return ok
  }
  getReplayGain() {
    return this.engine?.getReplayGain() ?? null
  }
  setPlaybackSpeed(config: { enabled: boolean; speed: number }): boolean {
    const ok = this.engine?.setPlaybackSpeed(config) ?? false
    if (ok) {
      this.dspSettings.playbackSpeed = config
      this.persistDspSettings()
    }
    return ok
  }
  getPlaybackSpeed() {
    return this.engine?.getPlaybackSpeed() ?? null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setEqBands(bands: any[]): boolean {
    const ok = this.engine?.setEqBands(bands) ?? false
    if (ok) {
      this.dspSettings.eqBands = bands.map((band) => ({
        enabled: band.enabled === true,
        frequencyHz: band.frequencyHz,
        gainDb: band.gainDb,
        q: band.q
      }))
      this.persistDspSettings()
    }
    return ok
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getEqBands(): any[] {
    return this.engine?.getEqBands() ?? []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setResamplerConfig(config: any): boolean {
    const ok = this.engine?.setResamplerConfig(config) ?? false
    if (ok) {
      this.dspSettings.resampler = config
      this.persistDspSettings()
    }
    return ok
  }

  getResamplerConfig(): {
    forceOutputRate: boolean
    targetSampleRate: number
    quality: 'best' | 'medium' | 'fast'
  } | null {
    return this.engine?.getResamplerConfig() ?? null
  }
  setDopEnabled(enabled: boolean): boolean {
    const ok = this.engine?.setDopEnabled(enabled) ?? false
    if (ok) {
      this.dspSettings.dopEnabled = enabled
      this.persistDspSettings()
    }
    return ok
  }
  getDopEnabled(): boolean {
    return this.engine?.getDopEnabled() === true
  }
  setTransitionConfig(config: {
    gaplessEnabled: boolean
    crossfadeEnabled: boolean
    crossfadeMs: number
  }): boolean {
    const ok = this.engine?.setTransitionConfig(config) ?? false
    if (ok) {
      this.dspSettings.transition = config
      this.persistDspSettings()
    }
    return ok
  }
  getTransitionConfig(): {
    gaplessEnabled: boolean
    crossfadeEnabled: boolean
    crossfadeMs: number
  } | null {
    return this.engine?.getTransitionConfig() ?? null
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setDspNodes(nodes: any[]): boolean {
    const ok = this.engine?.setDspNodes(nodes) ?? false
    if (ok) {
      this.dspSettings.dspNodes = nodes
      this.persistDspSettings()
    }
    return ok
  }

  getDspNodes(): {
    id: 'compressor' | 'delay' | 'reverb' | 'chorus' | 'noise_gate' | 'phaser'
    enabled: boolean
  }[] {
    return this.engine?.getDspNodes() ?? []
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setCompressorConfig(config: any): boolean {
    const ok = this.engine?.setCompressorConfig(config) ?? false
    if (ok) {
      this.dspSettings.compressor = config
      this.persistDspSettings()
    }
    return ok
  }

  getCompressorConfig() {
    return this.engine?.getCompressorConfig() ?? null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setDelayConfig(config: any): boolean {
    const ok = this.engine?.setDelayConfig(config) ?? false
    if (ok) {
      this.dspSettings.delay = config
      this.persistDspSettings()
    }
    return ok
  }
  getDelayConfig() {
    return this.engine?.getDelayConfig() ?? null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setReverbConfig(config: any): boolean {
    const ok = this.engine?.setReverbConfig(config) ?? false
    if (ok) {
      this.dspSettings.reverb = config
      this.persistDspSettings()
    }
    return ok
  }
  getReverbConfig() {
    return this.engine?.getReverbConfig() ?? null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setChorusConfig(config: any): boolean {
    const ok = this.engine?.setChorusConfig(config) ?? false
    if (ok) {
      this.dspSettings.chorus = config
      this.persistDspSettings()
    }
    return ok
  }
  getChorusConfig() {
    return this.engine?.getChorusConfig() ?? null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setNoiseGateConfig(config: any): boolean {
    const ok = this.engine?.setNoiseGateConfig(config) ?? false
    if (ok) {
      this.dspSettings.noiseGate = config
      this.persistDspSettings()
    }
    return ok
  }
  getNoiseGateConfig() {
    return this.engine?.getNoiseGateConfig() ?? null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setPhaserConfig(config: any): boolean {
    const ok = this.engine?.setPhaserConfig(config) ?? false
    if (ok) {
      this.dspSettings.phaser = config
      this.persistDspSettings()
    }
    return ok
  }
  getPhaserConfig() {
    return this.engine?.getPhaserConfig() ?? null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setChannelMatrixConfig(config: any): boolean {
    const ok = this.engine?.setChannelMatrixConfig(config) ?? false
    if (ok) {
      this.dspSettings.channelMatrix = config
      this.persistDspSettings()
    }
    return ok
  }
  getChannelMatrixConfig() {
    return this.engine?.getChannelMatrixConfig() ?? null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setLimiter(config: any): boolean {
    const ok = this.engine?.setLimiter(config) ?? false
    if (ok) {
      this.dspSettings.limiter = config
      this.persistDspSettings()
    }
    return ok
  }
  getLimiter() {
    return this.engine?.getLimiter() ?? null
  }

  // ── Device / Backend ──

  enumerateDevices(): DeviceInfo[] {
    if (!this.engine) return []
    return this.engine.enumerateDevices()
  }

  setDevice(deviceId: string): boolean {
    const ok = this.engine?.setDevice(deviceId) ?? false
    if (ok) {
      this.dspSettings.outputDevice.deviceId = deviceId
      this.persistDspSettings()
    }
    return ok
  }

  setBackend(backend: string): boolean {
    if (!this.engine) return false
    const ok = this.engine.setBackend(backend)
    if (ok) {
      this.dspSettings.outputDevice = {
        backend: backend as PersistedOutputBackend,
        deviceId: 'default'
      }
      this.persistDspSettings()
    }
    return ok
  }

  selectOutputDevice(backend: string, deviceId: string): boolean {
    if (!this.engine) return false
    const ok = this.engine.selectOutputDevice(backend, deviceId)
    if (ok) {
      this.dspSettings.outputDevice = { backend: backend as PersistedOutputBackend, deviceId }
      this.persistDspSettings()
    }
    return ok
  }

  getOutputDeviceSettings() {
    return this.dspSettings.outputDevice
  }
  getEngineInfo() {
    return {
      version: this.engine?.getVersion?.() ?? 'unavailable',
      outputDevice: this.dspSettings.outputDevice
    }
  }

  // ── Query ──

  getStatus() {
    if (!this.engine) return null
    return this.engine.getStatus()
  }

  getGlitchCount(): number {
    if (!this.engine) return 0
    return this.engine.getGlitchCount()
  }

  getAudioChain(): AudioChainStatus | null {
    if (!this.engine) return null
    return this.engine.getAudioChain()
  }
  getAudioAnalysis(includeSpectrum = false): unknown {
    return this.engine?.getAudioAnalysis(includeSpectrum) ?? null
  }
  setLoudnessAnalysisEnabled(enabled: boolean): boolean {
    if (!this.engine) return false
    return this.engine.setLoudnessAnalysisEnabled(enabled)
  }
  setSpectrumAnalysisEnabled(enabled: boolean): boolean {
    if (!this.engine) return false
    return this.engine.setSpectrumAnalysisEnabled(enabled)
  }

  // ── Callbacks ──

  onStateChanged(callback: (state: number) => void): void {
    this.engine?.onStateChanged(callback)
  }

  onPositionChanged(callback: (posMs: number, durMs: number) => void): void {
    this.engine?.onPositionChanged(callback)
  }

  onTrackEnded(callback: (reason: string, filePath: string) => void): void {
    this.engine?.onTrackEnded(callback)
  }

  onError(callback: (code: number, msg: string) => void): void {
    this.engine?.onError(callback)
  }

  private restoreDspSettings(): void {
    this.engine.setVolume(this.dspSettings.volume)
    this.engine.setPreamp(this.dspSettings.preamp.db, this.dspSettings.preamp.enabled)
    this.engine.setReplayGain(this.dspSettings.replayGain)
    this.engine.setPlaybackSpeed(this.dspSettings.playbackSpeed)
    if (this.dspSettings.eqBands.length === 20) this.engine.setEqBands(this.dspSettings.eqBands)
    this.engine.setDspNodes(this.dspSettings.dspNodes)
    this.engine.setCompressorConfig(this.dspSettings.compressor)
    this.engine.setDelayConfig(this.dspSettings.delay)
    this.engine.setReverbConfig(this.dspSettings.reverb)
    this.engine.setChorusConfig(this.dspSettings.chorus)
    this.engine.setNoiseGateConfig(this.dspSettings.noiseGate)
    this.engine.setPhaserConfig(this.dspSettings.phaser)
    this.engine.setChannelMatrixConfig(this.dspSettings.channelMatrix)
    this.engine.setLimiter(this.dspSettings.limiter)
    this.engine.setResamplerConfig(this.dspSettings.resampler)
    this.engine.setDopEnabled(this.dspSettings.dopEnabled)
    this.engine.setTransitionConfig(this.dspSettings.transition)
    const output = this.dspSettings.outputDevice
    if (!this.engine.selectOutputDevice(output.backend, output.deviceId)) {
      Logger.warn(
        `[AudioEngineManager] Failed to restore ${output.backend} device ${output.deviceId}; using DirectSound default`
      )
      this.dspSettings.outputDevice = { backend: 'directsound', deviceId: 'default' }
      this.persistDspSettings()
    }
  }

  private persistDspSettings(): void {
    if (this.dspSettingsSaveTimer) clearTimeout(this.dspSettingsSaveTimer)
    this.dspSettingsSaveTimer = setTimeout(() => this.flushDspSettings(), 400)
  }

  flushDspSettings(): void {
    if (this.dspSettingsSaveTimer) clearTimeout(this.dspSettingsSaveTimer)
    this.dspSettingsSaveTimer = undefined
    try {
      saveDspSettings(this.dspSettings)
    } catch (error) {
      Logger.warn('[AudioEngineManager] Failed to save DSP settings:', error)
    }
  }
}
