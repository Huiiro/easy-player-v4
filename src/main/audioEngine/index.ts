import { logOperation } from '../service/operationLogger'
import { existsSync } from 'node:fs'
import { AutoMixStemService, type AutoMixStemRequest } from '../service/autoMixStemService'
import {
  getNativeAddonPath,
  getStemPythonPath,
  getStemWorkerPath,
  getStemCachePath,
  getStemFfmpegPath,
  getStemModelPath
} from '../utils/pathUtils'
import { app } from 'electron'
import { isPlaybackOnly, setPlaybackOnly } from '../service/playbackMode'
import { Logger } from '../service/loggerService'
import { AudioChainStatus, DeviceInfo, EngineState } from './types'
import {
  audioProcessingProfileNameLimit,
  type ApplyAudioProcessingProfileResult,
  type AudioSettingsResult,
  type RestartAudioEngineResult
} from '../../shared/audioProcessingProfiles'
import {
  AudioProcessingSettings,
  DspSettings,
  PersistedOutputBackend,
  defaultDspSettings,
  defaultEqBands,
  loadAudioProcessingProfiles,
  loadDspSettings,
  saveAudioProcessingProfiles,
  saveDspSettings
} from './dspSettings'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let nativeAddon: any = null

function loadNativeAddon(): boolean {
  if (nativeAddon) return true

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    nativeAddon = require(getNativeAddonPath(app.isPackaged))

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
  private stemService?: AutoMixStemService
  private stemMaintenance = false
  private stemShutdown: Promise<void> = Promise.resolve()
  private stemRequestTimer?: ReturnType<typeof setTimeout>
  private dspSettings: DspSettings
  private dspSettingsSaveTimer: ReturnType<typeof setTimeout> | undefined
  private shuttingDown = false
  private deviceEvents?: ReturnType<typeof setInterval>
  private pendingPlaybackOperations = 0

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
      this.reloadStemService()
      if (process.platform === 'win32') {
        // Process driver notifications even with the renderer closed/minimized.
        this.deviceEvents = setInterval(() => {
          try {
            this.engine?.serviceBackendEvents?.()
          } catch (error) {
            Logger.error('[AudioEngineManager] device event recovery failed', error)
          }
        }, 100)
        this.deviceEvents.unref()
      }
      Logger.info(
        `[AudioEngineManager] EasyPlayer Audio Engine v${this.engine.getVersion?.() ?? 'unknown'} initialized`
      )
    }
  }

  reloadStemService(): void {
    if (this.stemMaintenance || this.shuttingDown) return
    clearTimeout(this.stemRequestTimer)
    void this.stopStemService()
    if (!this.engine) return
    const python = getStemPythonPath()
    const worker = getStemWorkerPath(app.isPackaged)
    const ffmpeg = getStemFfmpegPath(app.isPackaged)
    const modelRepo = getStemModelPath()
    if (![python, worker, ffmpeg, modelRepo].every(existsSync)) return
    this.stemService = new AutoMixStemService({
      python,
      worker,
      ffmpeg,
      modelRepo,
      cache: getStemCachePath(),
      onReady: (request, outgoing, incoming, cue, outStart) => {
        const accepted = this.engine?.setAutoMixVocals?.(
          request.revision,
          outgoing,
          incoming,
          cue,
          outStart
        )
        Logger.debug(
          `[Auto Mix] vocal protection ${accepted ? 'enabled' : 'discarded after queue/position change'}, incoming entry=${(cue / request.sampleRate).toFixed(2)}s`
        )
      },
      onStatus: (message) => Logger.info(`[Auto Mix] ${message}`)
    })
    this.scheduleStemRequest()
  }

  private stopStemService(): Promise<void> {
    const service = this.stemService
    this.stemService = undefined
    this.stemShutdown = Promise.all([this.stemShutdown, service?.closeAndWait()]).then(() => {})
    return this.stemShutdown
  }

  async suspendStemService(): Promise<void> {
    this.stemMaintenance = true
    clearTimeout(this.stemRequestTimer)
    await this.stopStemService()
  }

  resumeStemService(): void {
    this.stemMaintenance = false
    this.reloadStemService()
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
        if (process.platform !== 'darwin') return this.engine.open(filePath)
        this.pendingPlaybackOperations++
        try {
          return await this.engine.openAsync(filePath)
        } finally {
          this.pendingPlaybackOperations--
        }
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
        clearTimeout(this.stemRequestTimer)
        this.stemService?.cancel()
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
        clearTimeout(this.stemRequestTimer)
        this.stemService?.cancel()
        if (!this.engine) return false
        if (process.platform !== 'darwin') return this.engine.stop()
        this.pendingPlaybackOperations++
        try {
          return await this.engine.stopAsync()
        } finally {
          this.pendingPlaybackOperations--
        }
      },
      { successLevel: 'debug', warnOnFalse: false }
    )
  }

  restartEngine(): RestartAudioEngineResult {
    if (this.shuttingDown || !this.engine?.restart) {
      return { success: false, error: 'restart_unavailable' }
    }
    if (this.pendingPlaybackOperations > 0) return { success: false, error: 'playback_busy' }

    const status = this.getStatus()
    const filePath = status?.trackInfo?.filePath
    const resume =
      filePath &&
      [EngineState.Ready, EngineState.Playing, EngineState.Paused].includes(status.state)
        ? {
            filePath,
            positionMs: Number.isFinite(status.positionMs) ? Math.max(0, status.positionMs) : 0
          }
        : undefined
    if (!this.engine.restart()) return { success: false, error: 'restart_failed' }

    clearTimeout(this.stemRequestTimer)
    this.stemService?.cancel()
    try {
      this.engine.setPlaybackOnly?.(isPlaybackOnly())
      this.restoreDspSettings()
      return { success: true, resume }
    } catch (error) {
      Logger.error('[AudioEngineManager] Could not restore settings after restart:', error)
      return { success: false, error: 'restart_settings_failed', restarted: true, resume }
    }
  }

  seek(positionMs: number): boolean {
    return logOperation(
      '[AudioEngine] seek',
      { positionMs, loaded: this.loaded },
      () => {
        if (!this.engine) return false
        const ok = this.engine.seek(positionMs)
        if (ok) this.scheduleStemRequest()
        return ok
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
      this.scheduleStemRequest()
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
  setNextTrack(filePath: string, sourceFile?: string): boolean {
    const ready = this.engine?.setNextTrack?.(filePath, sourceFile) ?? false
    this.scheduleStemRequest(ready)
    return ready
  }
  private scheduleStemRequest(ready = true): void {
    clearTimeout(this.stemRequestTimer)
    this.stemService?.cancel()
    if (this.shuttingDown || !ready || isPlaybackOnly() || !this.stemService) return
    const poll = (): void => {
      if (this.shuttingDown || isPlaybackOnly()) return
      if (this.engine?.isAutoMixPreparing?.()) {
        this.stemRequestTimer = setTimeout(poll, 50)
        this.stemRequestTimer.unref()
        return
      }
      const request = this.engine?.getAutoMixStemRequest?.() as AutoMixStemRequest | null
      this.stemService?.request(request ?? null)
    }
    poll()
  }
  setTransitionConfig(config: {
    gaplessEnabled: boolean
    crossfadeEnabled: boolean
    crossfadeMs: number
    crossfadeAuto: boolean
    crossfadeVocalCue: boolean
    pauseFadeEnabled: boolean
    pauseFadeMs: number
  }): boolean {
    const ok = this.engine?.setTransitionConfig(config) ?? false
    if (ok) {
      this.dspSettings.transition = config
      this.persistDspSettings()
      this.scheduleStemRequest()
    }
    return ok
  }
  getTransitionConfig(): {
    gaplessEnabled: boolean
    crossfadeEnabled: boolean
    crossfadeMs: number
    crossfadeAuto: boolean
    crossfadeVocalCue: boolean
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

  listAudioProcessingProfiles(): string[] {
    return loadAudioProcessingProfiles().map((profile) => profile.name)
  }

  saveAudioProcessingProfile(rawName: unknown): AudioSettingsResult {
    if (!this.engine) return { success: false, error: 'Audio engine unavailable' }
    const name = typeof rawName === 'string' ? rawName.trim() : ''
    if (!name || name.length > audioProcessingProfileNameLimit) {
      return { success: false, error: 'invalid_profile_name' }
    }
    const profiles = loadAudioProcessingProfiles()
    if (profiles.some((profile) => profile.name.toLowerCase() === name.toLowerCase())) {
      return { success: false, error: 'profile_name_exists' }
    }
    const { volume, outputDevice, ...settings } = this.dspSettings
    settings.eqBands = this.engine.getEqBands()
    saveAudioProcessingProfiles([...profiles, { name, settings }])
    return { success: true }
  }

  applyAudioProcessingProfile(name: unknown): ApplyAudioProcessingProfileResult {
    const profile = loadAudioProcessingProfiles().find((item) => item.name === name)
    if (!profile) return { success: false, error: 'profile_not_found' }
    return this.applyAudioProcessingSettings(profile.settings, 'profile')
  }

  deleteAudioProcessingProfile(name: unknown): AudioSettingsResult {
    const profiles = loadAudioProcessingProfiles()
    const remaining = profiles.filter((profile) => profile.name !== name)
    if (remaining.length === profiles.length) return { success: false, error: 'profile_not_found' }
    saveAudioProcessingProfiles(remaining)
    return { success: true }
  }

  resetAudioProcessingSettings(): AudioSettingsResult {
    return this.applyAudioProcessingSettings(
      { ...defaultDspSettings(), eqBands: defaultEqBands() },
      'defaults'
    )
  }

  private applyAudioProcessingSettings(
    settings: AudioProcessingSettings,
    mode: 'defaults' | 'profile'
  ): ApplyAudioProcessingProfileResult {
    if (!this.engine) return { success: false, error: 'Audio engine unavailable' }
    if (this.pendingPlaybackOperations > 0) return { success: false, error: 'playback_busy' }

    const previous = this.dspSettings
    const current = { ...previous, eqBands: this.engine.getEqBands() }
    const steps = (settings: AudioProcessingSettings): [string, () => boolean][] => [
      [
        'preamp',
        () => {
          this.engine.setPreamp(settings.preamp.db, settings.preamp.enabled)
          return true
        }
      ],
      ['DSP nodes', () => this.engine.setDspNodes(settings.dspNodes)],
      ['ReplayGain', () => this.engine.setReplayGain(settings.replayGain)],
      ['playback speed', () => this.engine.setPlaybackSpeed(settings.playbackSpeed)],
      ['EQ', () => this.engine.setEqBands(settings.eqBands)],
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
    let attempted = 0
    try {
      for (const [name, run] of steps(settings)) {
        attempted++
        if (!run()) throw new Error(`Failed to apply ${name} ${mode}`)
      }
      const next: DspSettings = {
        ...settings,
        volume: previous.volume,
        outputDevice: previous.outputDevice
      }
      saveDspSettings(next)
      this.dspSettings = next
      if (this.dspSettingsSaveTimer) clearTimeout(this.dspSettingsSaveTimer)
      this.dspSettingsSaveTimer = undefined
      return { success: true, preamp: next.preamp }
    } catch (error) {
      Logger.error('[AudioEngineManager] Failed to apply audio processing settings:', error)
      for (const [name, rollback] of steps(current).slice(0, attempted)) {
        try {
          if (!rollback()) throw new Error(`Failed to restore ${name}`)
        } catch (rollbackError) {
          Logger.error(
            '[AudioEngineManager] Failed to restore audio processing settings:',
            rollbackError
          )
        }
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
  getAudioAnalysis(includeSpectrum = false, includeEqSpectrum = false): unknown {
    return this.engine?.getAudioAnalysis(includeSpectrum, includeEqSpectrum) ?? null
  }
  setEqSpectrumAnalysisEnabled(enabled: boolean): boolean {
    return this.engine?.setEqSpectrumAnalysisEnabled?.(enabled && !isPlaybackOnly()) === true
  }
  setAnalysisEnabled(enabled: boolean): boolean {
    return this.engine?.setAnalysisEnabled?.(enabled && !isPlaybackOnly()) === true
  }
  reclaimIdleMemory(): void {
    if (!isPlaybackOnly() || process.platform !== 'win32') return
    for (const metric of app.getAppMetrics()) {
      // The browser process hosts the real-time decoder/output threads. Keep
      // its audio buffers and code resident; reclaim only UI/GPU/utility pages.
      if (metric.type !== 'Browser') nativeAddon?.reclaimProcessMemory?.(metric.pid)
    }
  }
  setExtremePlayback(enabled: boolean): boolean {
    // An older addon must be rebuilt; do not claim that analysis was stopped.
    if (!this.engine?.setPlaybackOnly || !this.engine?.setAnalysisEnabled) return false
    if (enabled) {
      clearTimeout(this.stemRequestTimer)
      this.stemService?.cancel()
    }
    this.engine.setPlaybackOnly(enabled)
    if (enabled) this.engine.setAnalysisEnabled(false)
    setPlaybackOnly(enabled)
    return true
  }
  setLoudnessAnalysisEnabled(enabled: boolean): boolean {
    if (!this.engine) return false
    return this.engine.setLoudnessAnalysisEnabled(enabled && !isPlaybackOnly())
  }
  setSpectrumAnalysisEnabled(enabled: boolean): boolean {
    if (!this.engine) return false
    return this.engine.setSpectrumAnalysisEnabled(enabled && !isPlaybackOnly())
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
    if (this.shuttingDown) return
    if (this.dspSettingsSaveTimer) clearTimeout(this.dspSettingsSaveTimer)
    this.dspSettingsSaveTimer = setTimeout(() => this.flushDspSettings(), 400)
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    clearInterval(this.deviceEvents)
    clearTimeout(this.stemRequestTimer)
    this.flushDspSettings()
    await this.stopStemService()
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
