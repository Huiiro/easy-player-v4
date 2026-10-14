import { logOperation } from '../service/operationLogger'
import { join } from 'path'
import { app } from 'electron'
import { Logger } from '../service/loggerService'
import { AudioChainStatus, DeviceInfo } from './types'
import {
  DspSettings,
  PersistedOutputBackend,
  defaultDspSettings,
  defaultEqBands,
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

    Logger.debug('[AudioEngineManager] native addon loaded', {
      packaged: app.isPackaged,
      platform: process.platform
    })
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
    return logOperation(
      '[AudioEngine] open',
      { filePath, loaded: this.loaded },
      () => {
        if (!this.engine) return false
        return this.engine.open(filePath)
      },
      { successLevel: 'debug', warnOnFalse: true }
    )
  }

  async openAsync(filePath: string): Promise<boolean> {
    return logOperation(
      '[AudioEngine] openAsync',
      { filePath, loaded: this.loaded },
      async () => {
        if (!this.engine) return false
        // The Windows backends already switch tracks without stalling Electron's
        // message loop. CoreAudio teardown/open can wait noticeably on macOS, so
        // only macOS uses the N-API worker path.
        return process.platform === 'darwin'
          ? this.engine.openAsync(filePath)
          : this.engine.open(filePath)
      },
      { successLevel: 'debug', warnOnFalse: true }
    )
  }

  play(): boolean {
    return logOperation(
      '[AudioEngine] play',
      { loaded: this.loaded },
      () => {
        if (!this.engine) return false
        return this.engine.play()
      },
      { successLevel: 'debug', warnOnFalse: true }
    )
  }

  pause(): boolean {
    return logOperation(
      '[AudioEngine] pause',
      { loaded: this.loaded },
      () => {
        if (!this.engine) return false
        return this.engine.pause()
      },
      { successLevel: 'debug', warnOnFalse: true }
    )
  }

  stop(): boolean {
    return logOperation(
      '[AudioEngine] stop',
      { loaded: this.loaded },
      () => {
        if (!this.engine) return false
        return this.engine.stop()
      },
      { successLevel: 'debug', warnOnFalse: false }
    )
  }

  async stopAsync(): Promise<boolean> {
    return logOperation(
      '[AudioEngine] stopAsync',
      { loaded: this.loaded },
      async () => {
        if (!this.engine) return false
        return process.platform === 'darwin' ? this.engine.stopAsync() : this.engine.stop()
      },
      { successLevel: 'debug', warnOnFalse: false }
    )
  }

  seek(positionMs: number): boolean {
    return logOperation(
      '[AudioEngine] seek',
      { positionMs, loaded: this.loaded },
      () => {
        if (!this.engine) return false
        return this.engine.seek(positionMs)
      },
      { successLevel: 'debug', warnOnFalse: true }
    )
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
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
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
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
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
  setNextTrack(filePath: string): boolean {
    return this.engine?.setNextTrack?.(filePath) ?? false
  }
  setTransitionConfig(config: {
    gaplessEnabled: boolean
    crossfadeEnabled: boolean
    crossfadeMs: number
    crossfadeAuto: boolean
    pauseFadeEnabled: boolean
    pauseFadeMs: number
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
    crossfadeAuto: boolean
    pauseFadeEnabled: boolean
    pauseFadeMs: number
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

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
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
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
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
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
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
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
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
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
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
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
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
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  getChannelMatrixConfig() {
    return this.engine?.getChannelMatrixConfig() ?? null
  }
  setStereoFieldConfig(config: DspSettings['stereoField']): boolean {
    const ok = this.engine?.setStereoFieldConfig?.(config) ?? false
    if (ok) {
      this.dspSettings.stereoField = config
      this.persistDspSettings()
    }
    return ok
  }
  getStereoFieldConfig(): DspSettings['stereoField'] | null {
    return this.engine?.getStereoFieldConfig?.() ?? null
  }
  setCrossfeedConfig(config: DspSettings['crossfeed']): boolean {
    const ok = this.engine?.setCrossfeedConfig?.(config) ?? false
    if (ok) {
      this.dspSettings.crossfeed = config
      this.persistDspSettings()
    }
    return ok
  }
  getCrossfeedConfig(): DspSettings['crossfeed'] | null {
    return this.engine?.getCrossfeedConfig?.() ?? null
  }
  setImpulseResponseConfig(config: DspSettings['impulseResponse']): boolean {
    const ok = this.engine?.setImpulseResponseConfig?.(config) ?? false
    if (ok) {
      this.dspSettings.impulseResponse = {
        enabled: config.enabled,
        path: config.path,
        autoGain: config.autoGain,
        gainDb: config.gainDb
      }
      this.persistDspSettings()
    }
    return ok
  }
  getImpulseResponseError(): string {
    return this.engine?.getImpulseResponseError?.() ?? 'native_unavailable'
  }
  getImpulseResponseConfig(): DspSettings['impulseResponse'] | null {
    return this.engine?.getImpulseResponseConfig?.() ?? null
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
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  getLimiter() {
    return this.engine?.getLimiter() ?? null
  }

  resetAudioProcessingSettings(): { success: boolean; error?: string } {
    if (!this.engine) return { success: false, error: 'Audio engine unavailable' }

    const previous = this.dspSettings
    const previousEqBands = this.engine.getEqBands()
    const defaults = defaultDspSettings()
    defaults.eqBands = defaultEqBands()

    const apply = (settings: DspSettings, eqBands: DspSettings['eqBands']): void => {
      const steps: [string, () => boolean][] = [
        ['DSP nodes', () => this.engine.setDspNodes(settings.dspNodes)],
        ['ReplayGain', () => this.engine.setReplayGain(settings.replayGain)],
        ['playback speed', () => this.engine.setPlaybackSpeed(settings.playbackSpeed)],
        ['EQ', () => this.engine.setEqBands(eqBands)],
        ['compressor', () => this.engine.setCompressorConfig(settings.compressor)],
        ['delay', () => this.engine.setDelayConfig(settings.delay)],
        ['reverb', () => this.engine.setReverbConfig(settings.reverb)],
        ['chorus', () => this.engine.setChorusConfig(settings.chorus)],
        ['noise gate', () => this.engine.setNoiseGateConfig(settings.noiseGate)],
        ['phaser', () => this.engine.setPhaserConfig(settings.phaser)],
        ['channel matrix', () => this.engine.setChannelMatrixConfig(settings.channelMatrix)],
        ['stereo field', () => this.engine.setStereoFieldConfig?.(settings.stereoField) ?? false],
        ['crossfeed', () => this.engine.setCrossfeedConfig?.(settings.crossfeed) ?? false],
        [
          'impulse response',
          () => this.engine.setImpulseResponseConfig?.(settings.impulseResponse) ?? false
        ],
        ['limiter', () => this.engine.setLimiter(settings.limiter)],
        ['resampler', () => this.engine.setResamplerConfig(settings.resampler)],
        ['DoP', () => this.engine.setDopEnabled(settings.dopEnabled)],
        ['transition', () => this.engine.setTransitionConfig(settings.transition)]
      ]
      this.engine.setPreamp(settings.preamp.db, settings.preamp.enabled)
      for (const [name, run] of steps) {
        if (!run()) throw new Error(`Failed to apply ${name} defaults`)
      }
    }

    try {
      apply(defaults, defaults.eqBands)
      this.dspSettings = {
        ...defaults,
        volume: previous.volume,
        outputDevice: previous.outputDevice
      }
      saveDspSettings(this.dspSettings)
      if (this.dspSettingsSaveTimer) clearTimeout(this.dspSettingsSaveTimer)
      this.dspSettingsSaveTimer = undefined
      return { success: true }
    } catch (error) {
      this.dspSettings = previous
      Logger.error('[AudioEngineManager] Failed to reset audio processing settings:', error)
      try {
        apply(previous, previousEqBands)
      } catch (rollbackError) {
        Logger.error(
          '[AudioEngineManager] Failed to restore audio processing settings:',
          rollbackError
        )
      }
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  // ── Device / Backend ──

  enumerateDevices(): DeviceInfo[] {
    return logOperation(
      '[AudioEngine] enumerateDevices',
      { loaded: this.loaded },
      () => {
        if (!this.engine) return []
        return this.engine.enumerateDevices()
      },
      { successLevel: 'debug', warnOnFalse: false }
    )
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

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  getOutputDeviceSettings() {
    return this.dspSettings.outputDevice
  }
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  getEngineInfo() {
    return {
      version: this.engine?.getVersion?.() ?? 'unavailable',
      outputDevice: this.dspSettings.outputDevice
    }
  }

  // ── Query ──

  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
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
    return logOperation(
      '[AudioEngine] restoreDspSettings',
      { output: this.dspSettings.outputDevice, eqBandCount: this.dspSettings.eqBands.length },
      () => {
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
        this.engine.setStereoFieldConfig?.(this.dspSettings.stereoField)
        this.engine.setCrossfeedConfig?.(this.dspSettings.crossfeed)
        if (
          this.engine.setImpulseResponseConfig &&
          !this.engine.setImpulseResponseConfig(this.dspSettings.impulseResponse)
        ) {
          Logger.warn(
            `[AudioEngineManager] Failed to restore impulse response (${this.getImpulseResponseError()}); disabling IR`
          )
          this.dspSettings.impulseResponse.enabled = false
          this.persistDspSettings()
        }
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
      },
      { successLevel: 'debug', warnOnFalse: false }
    )
  }

  private persistDspSettings(): void {
    if (this.dspSettingsSaveTimer) clearTimeout(this.dspSettingsSaveTimer)
    this.dspSettingsSaveTimer = setTimeout(() => this.flushDspSettings(), 400)
  }

  flushDspSettings(): void {
    return logOperation(
      '[AudioEngine] flushDspSettings',
      { output: this.dspSettings.outputDevice },
      () => {
        if (this.dspSettingsSaveTimer) clearTimeout(this.dspSettingsSaveTimer)
        this.dspSettingsSaveTimer = undefined
        try {
          saveDspSettings(this.dspSettings)
        } catch (error) {
          Logger.warn('[AudioEngineManager] Failed to save DSP settings:', error)
        }
      },
      { successLevel: 'debug', warnOnFalse: false }
    )
  }
}
