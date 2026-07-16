import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { AudioChainStatus, PlaybackState, TrackInfo, DeviceInfo, ChannelMatrixConfig, ChorusConfig, CompressorConfig, DelayConfig, DspNodeConfig, EqBand, NoiseGateConfig, PhaserConfig, ResamplerConfig, TransitionConfig } from '../types/audio'
import { audioBridge } from '@/services/audioBridge'
import { useLogStore } from '@/stores/log/logStore'

export const usePlayerStore = defineStore('player', () => {
  // ── State ──
  const state = ref<PlaybackState>('idle')
  const positionMs = ref(0)
  const durationMs = ref(0)
  const volume = ref(1.0)
  const glitchCount = ref(0)
  const trackInfo = ref<TrackInfo | null>(null)
  const currentFile = ref<string | null>(null)
  const currentBackend = ref<string>('directsound')
  const devices = ref<DeviceInfo[]>([])
  const currentDeviceId = ref('default')
  const audioChain = ref<AudioChainStatus | null>(null)
  const audioAnalysis = ref({ outputTimeMs: 0, analysisTimeMs: 0, analysisLatencyMs: 0, rms: 0, lowEnergy: 0, onsetStrength: 0, droppedFrames: 0, beatSequence: 0, bpm: 0, momentaryLufs: -70, shortTermLufs: -70, integratedLufs: -70, spectrum: Array.from({ length: 64 }, () => 0) })
  const rhythmVisualConfig = ref({ enabled: true, intensity: 0.65, reducedMotion: false })
  const preampEnabled = ref(false)
  const preampDb = ref(0)
  const replayGainConfig = ref<{ mode: 'off' | 'track' | 'album'; preventClipping: boolean; active: boolean; appliedGainDb: number }>({ mode: 'off', preventClipping: true, active: false, appliedGainDb: 0 })
  const playbackSpeedConfig = ref({ enabled: false, speed: 1 })
  const eqBands = ref<EqBand[]>(createDefaultEqBands())
  const resamplerConfig = ref<ResamplerConfig>({ forceOutputRate: false, targetSampleRate: 48000, quality: 'best' })
  const dopEnabled = ref(false)
  const transitionConfig = ref<TransitionConfig>({ gaplessEnabled: true, crossfadeEnabled: false, crossfadeMs: 5000 })
  const dspNodes = ref<DspNodeConfig[]>([
    { id: 'compressor', enabled: false }, { id: 'delay', enabled: false }, { id: 'reverb', enabled: false }, { id: 'chorus', enabled: false }, { id: 'noise_gate', enabled: false }, { id: 'phaser', enabled: false }
  ])
  const compressorConfig = ref<CompressorConfig>({ thresholdDb: -18, ratio: 4, attackMs: 10, releaseMs: 100, makeupDb: 0 })
  const delayConfig = ref<DelayConfig>({ delayMs: 250, feedback: 0.25, mix: 0.2 })
  const reverbConfig = ref({ roomSize: 0.5, decay: 0.4, mix: 0.15 })
  const limiterConfig = ref({ enabled: false, ceilingDb: -1, releaseMs: 80 })
  const chorusConfig = ref<ChorusConfig>({ rateHz: 0.8, depthMs: 8, mix: 0.35 })
  const noiseGateConfig = ref<NoiseGateConfig>({ thresholdDb: -50, attackMs: 5, holdMs: 50, releaseMs: 150, rangeDb: -80 })
  const phaserConfig = ref<PhaserConfig>({ rateHz: 0.4, depth: 0.6, centerHz: 800, feedback: 0.2, mix: 0.5 })
  const channelMatrixConfig = ref<ChannelMatrixConfig>({ enabled: false, balance: 0, swapStereo: false, monoDownmix: false, outputGains: [1, 1, 1, 1, 1, 1, 1, 1] })

  // ── Computed ──
  const isPlaying = computed(() => state.value === 'playing')
  const isPaused = computed(() => state.value === 'paused')
  const progress = computed(() =>
    durationMs.value > 0 ? positionMs.value / durationMs.value : 0
  )
  const positionFormatted = computed(() => formatTime(positionMs.value))
  const durationFormatted = computed(() => formatTime(durationMs.value))

  // ── Actions ──
  async function openFile(filePath: string) {
    currentFile.value = filePath
    const ok = await audioBridge.open(filePath)
    if (ok) {
      const status = await audioBridge.getStatus()
      if (status) {
        trackInfo.value = status.trackInfo
        durationMs.value = status.durationMs
      }
      // ReplayGain is resolved from the newly opened track's metadata by the
      // native decoder, so the startup snapshot is no longer authoritative.
      await loadReplayGain()
      await refreshAudioChain()
    }
    return ok
  }

  async function play() {
    const ok = await audioBridge.play()
    return ok
  }

  async function pause() {
    return audioBridge.pause()
  }

  async function stop() {
    return audioBridge.stop()
  }

  async function seek(ms: number) {
    const targetMs = Math.max(0, durationMs.value > 0 ? Math.min(ms, durationMs.value) : ms)
    positionMs.value = targetMs
    return audioBridge.seek(targetMs)
  }

  async function setVolume(vol: number) {
    volume.value = Math.max(0, Math.min(1, vol))
    await audioBridge.setVolume(volume.value)
  }

  async function setPreamp(db: number, enabled: boolean): Promise<void> {
    preampDb.value = Math.max(-24, Math.min(24, db))
    preampEnabled.value = enabled
    await audioBridge.setPreamp(preampDb.value, preampEnabled.value)
  }
  async function loadReplayGain(): Promise<void> { const c = await audioBridge.getReplayGain(); if (c) replayGainConfig.value = c }
  async function setReplayGain(): Promise<boolean> {
    const ok = await audioBridge.setReplayGain({ mode: replayGainConfig.value.mode, preventClipping: replayGainConfig.value.preventClipping })
    if (ok) { await loadReplayGain(); await refreshAudioChain() }
    return ok
  }
  async function loadPlaybackSpeed(): Promise<void> { const c = await audioBridge.getPlaybackSpeed(); if (c) playbackSpeedConfig.value = c }
  async function setPlaybackSpeed(): Promise<boolean> {
    const ok = await audioBridge.setPlaybackSpeed({ ...playbackSpeedConfig.value })
    if (ok) await refreshAudioChain()
    return ok
  }

  async function loadEqBands(): Promise<void> {
    const bands = await audioBridge.getEqBands()
    if (bands.length === 20) eqBands.value = bands
  }

  async function commitEqBands(): Promise<void> {
    const logStore = useLogStore()
    const activeBands = eqBands.value.filter((band) => band.enabled && Math.abs(band.gainDb) >= 0.0001).length
    logStore.addEntry({
      level: 'info',
      message: `Renderer EQ submit: ${activeBands} active band(s)`,
      timestamp: Date.now()
    })
    try {
      // Pinia exposes a reactive Proxy. Electron IPC uses structured clone,
      // which rejects Proxies, so send a fresh plain-object snapshot.
      const bands = eqBands.value.map((band) => ({
        enabled: band.enabled,
        frequencyHz: band.frequencyHz,
        gainDb: band.gainDb,
        q: band.q
      }))
      const ok = await audioBridge.setEqBands(bands)
      logStore.addEntry({
        level: ok ? 'info' : 'error',
        message: `Renderer EQ submit ${ok ? 'accepted by IPC' : 'rejected by IPC'}`,
        timestamp: Date.now()
      })
    } catch (error) {
      logStore.addEntry({
        level: 'error',
        message: `Renderer EQ submit exception: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now()
      })
    }
  }

  async function loadResamplerConfig(): Promise<void> {
    const config = await audioBridge.getResamplerConfig()
    if (config) resamplerConfig.value = config
  }
  async function loadDopEnabled(): Promise<void> { dopEnabled.value = await audioBridge.getDopEnabled() }
  async function loadTransitionConfig(): Promise<void> { const config = await audioBridge.getTransitionConfig(); if (config) transitionConfig.value = config }
  async function setTransitionConfig(): Promise<boolean> {
    const next = { ...transitionConfig.value, crossfadeMs: Math.max(0, Math.min(30000, transitionConfig.value.crossfadeMs)) }
    const ok = await audioBridge.setTransitionConfig(next)
    if (ok) { transitionConfig.value = next; await refreshAudioChain() }
    return ok
  }
  async function setDopEnabled(enabled: boolean): Promise<boolean> {
    const ok = await audioBridge.setDopEnabled(enabled)
    if (ok) dopEnabled.value = enabled
    return ok
  }

  async function setResamplerConfig(config: ResamplerConfig): Promise<boolean> {
    const next = {
      forceOutputRate: config.forceOutputRate,
      targetSampleRate: config.targetSampleRate,
      quality: config.quality
    } satisfies ResamplerConfig
    const ok = await audioBridge.setResamplerConfig(next)
    if (ok) {
      resamplerConfig.value = next
      await refreshAudioChain()
    }
    return ok
  }

  async function loadDspNodes(): Promise<void> {
    const nodes = await audioBridge.getDspNodes()
    if (nodes.length === 6) dspNodes.value = nodes
  }
  async function loadCompressorConfig(): Promise<void> {
    const config = await audioBridge.getCompressorConfig()
    if (config) compressorConfig.value = config
  }
  async function setCompressorConfig(): Promise<boolean> {
    const ok = await audioBridge.setCompressorConfig({ ...compressorConfig.value })
    if (ok) await refreshAudioChain()
    return ok
  }
  async function loadDelayConfig(): Promise<void> { const config = await audioBridge.getDelayConfig(); if (config) delayConfig.value = config }
  async function setDelayConfig(): Promise<boolean> { return audioBridge.setDelayConfig({ ...delayConfig.value }) }
  async function loadReverbConfig(): Promise<void> { const c = await audioBridge.getReverbConfig(); if (c) reverbConfig.value = c }
  async function setReverbConfig(): Promise<boolean> { return audioBridge.setReverbConfig({ ...reverbConfig.value }) }
  async function loadChorusConfig(): Promise<void> { const c = await audioBridge.getChorusConfig(); if (c) chorusConfig.value = c }
  async function setChorusConfig(): Promise<boolean> { return audioBridge.setChorusConfig({ ...chorusConfig.value }) }
  async function loadNoiseGateConfig(): Promise<void> { const c = await audioBridge.getNoiseGateConfig(); if (c) noiseGateConfig.value = c }
  async function setNoiseGateConfig(): Promise<boolean> { return audioBridge.setNoiseGateConfig({ ...noiseGateConfig.value }) }
  async function loadPhaserConfig(): Promise<void> { const c = await audioBridge.getPhaserConfig(); if (c) phaserConfig.value = c }
  async function setPhaserConfig(): Promise<boolean> { return audioBridge.setPhaserConfig({ ...phaserConfig.value }) }
  async function loadChannelMatrixConfig(): Promise<void> { const c = await audioBridge.getChannelMatrixConfig(); if (c) channelMatrixConfig.value = c }
  async function setChannelMatrixConfig(): Promise<boolean> {
    const config = {
      enabled: channelMatrixConfig.value.enabled,
      balance: channelMatrixConfig.value.balance,
      swapStereo: channelMatrixConfig.value.swapStereo,
      monoDownmix: channelMatrixConfig.value.monoDownmix,
      // Pinia makes nested arrays reactive Proxies. IPC structured clone
      // requires a plain array, otherwise the entire matrix update is lost.
      outputGains: [...channelMatrixConfig.value.outputGains]
    }
    try {
      const ok = await audioBridge.setChannelMatrixConfig(config)
      if (ok) await refreshAudioChain()
      return ok
    } catch (error) {
      useLogStore().addEntry({ level: 'error', message: `Channel Matrix submit exception: ${error instanceof Error ? error.message : String(error)}`, timestamp: Date.now() })
      return false
    }
  }
  async function loadLimiter(): Promise<void> { const c = await audioBridge.getLimiter(); if (c) limiterConfig.value = c }
  async function setLimiter(): Promise<boolean> { const ok = await audioBridge.setLimiter({ ...limiterConfig.value }); if (ok) await refreshAudioChain(); return ok }

  async function commitDspNodes(): Promise<boolean> {
    const nodes = dspNodes.value.map((node) => ({ id: node.id, enabled: node.enabled }))
    const ok = await audioBridge.setDspNodes(nodes)
    if (ok) await refreshAudioChain()
    return ok
  }

  function moveDspNode(index: number, direction: -1 | 1): void {
    const destination = index + direction
    if (destination < 0 || destination >= dspNodes.value.length) return
    const [node] = dspNodes.value.splice(index, 1)
    dspNodes.value.splice(destination, 0, node)
    void commitDspNodes()
  }

  async function setBackend(backend: string): Promise<boolean> {
    if (currentBackend.value === backend) return true
    const ok = await audioBridge.setBackend(backend)
    if (!ok) {
      useLogStore().addEntry({ level: 'error', message: `Failed to switch audio backend to ${backend}`, timestamp: Date.now() })
      return false
    }
    currentBackend.value = backend
    {
      // Device identifiers belong to the previous backend and cannot be
      // reused by ASIO, WASAPI, or DirectSound.
      currentDeviceId.value = 'default'
      // Refresh device list after backend change
      await refreshDevices()
    }
    return true
  }

  async function setDevice(deviceId: string): Promise<boolean> {
    if (currentDeviceId.value === deviceId) return true
    const ok = await audioBridge.setDevice(deviceId)
    if (!ok) {
      useLogStore().addEntry({ level: 'error', message: `Failed to select audio device ${deviceId}`, timestamp: Date.now() })
      return false
    }
    currentDeviceId.value = deviceId
    return true
  }

  async function selectOutputDevice(device: DeviceInfo) {
    if (currentBackend.value === device.backend && currentDeviceId.value === device.id) return true

    const ok = await audioBridge.selectOutputDevice(device.backend, device.id)
    if (!ok) {
      useLogStore().addEntry({ level: 'error', message: `Failed to select ${device.backend} device ${device.name}`, timestamp: Date.now() })
      return false
    }

    currentBackend.value = device.backend
    currentDeviceId.value = device.id
    return true
  }

  async function loadOutputDeviceSettings(): Promise<void> {
    const output = await audioBridge.getOutputDeviceSettings()
    if (!output) return
    currentBackend.value = output.backend
    currentDeviceId.value = output.deviceId
  }

  async function logEngineInfo(): Promise<void> {
    const info = await audioBridge.getEngineInfo()
    if (!info) return
    useLogStore().addEntry({
      level: 'info',
      message: `Easy Player Audio Engine v${info.version} | ${info.outputDevice.backend} / ${info.outputDevice.deviceId}`,
      timestamp: Date.now()
    })
  }

  async function refreshDevices() {
    devices.value = await audioBridge.enumerateDevices()
  }

  async function refreshAudioChain(): Promise<void> {
    audioChain.value = await audioBridge.getAudioChain()
  }
  async function refreshAudioAnalysis(): Promise<void> {
    const snapshot = await audioBridge.getAudioAnalysis()
    if (snapshot) audioAnalysis.value = snapshot
  }

  function loadRhythmVisualConfig(): void {
    try {
      const stored = localStorage.getItem('easy-player.rhythm-visual-config')
      if (!stored) return
      const parsed = JSON.parse(stored) as Partial<typeof rhythmVisualConfig.value>
      rhythmVisualConfig.value = {
        enabled: parsed.enabled !== false,
        intensity: Math.max(0, Math.min(1, typeof parsed.intensity === 'number' ? parsed.intensity : 0.65)),
        reducedMotion: parsed.reducedMotion === true
      }
    } catch {
      // Corrupt renderer preferences must never stop playback controls loading.
    }
  }

  function saveRhythmVisualConfig(): void {
    localStorage.setItem('easy-player.rhythm-visual-config', JSON.stringify(rhythmVisualConfig.value))
  }

  // ── Event subscriptions ──
  let unsubs: (() => void)[] = []
  let analysisTimer: ReturnType<typeof setInterval> | undefined

  function subscribeToEvents() {
    if (!analysisTimer) analysisTimer = setInterval(() => { void refreshAudioAnalysis() }, 20)
    unsubs.push(
      audioBridge.onStateChanged((data) => {
        state.value = data.state as PlaybackState
        if (data.trackInfo) {
          trackInfo.value = data.trackInfo as TrackInfo
        }
      })
    )

    unsubs.push(
      audioBridge.onAudioChainChanged((data) => {
        audioChain.value = data
      })
    )

    unsubs.push(
      audioBridge.onPositionChanged((data) => {
        positionMs.value = data.positionMs
        durationMs.value = data.durationMs
      })
    )

    unsubs.push(
      audioBridge.onTrackEnded((data) => {
        state.value = 'stopped'
        useLogStore().addEntry({ level: 'info', message: `Playback reached end of track (${data.reason})`, timestamp: Date.now() })
      })
    )

    // Forward engine errors to the log store
    unsubs.push(
      audioBridge.onError((data) => {
        const logStore = useLogStore()
        logStore.addEntry({
          level: 'error',
          message: `[${data.code}] ${data.message}`,
          timestamp: Date.now()
        })
      })
    )
  }

  function unsubscribe() {
    unsubs.forEach((fn) => fn())
    unsubs = []
    if (analysisTimer) clearInterval(analysisTimer)
    analysisTimer = undefined
  }

  return {
    // State
    state,
    positionMs,
    durationMs,
    volume,
    glitchCount,
    trackInfo,
    currentFile,
    currentBackend,
    devices,
    currentDeviceId,
    audioChain,
    audioAnalysis,
    rhythmVisualConfig,
    preampEnabled,
    preampDb,
    replayGainConfig,
    playbackSpeedConfig,
    eqBands,
    resamplerConfig,
    dopEnabled,
    transitionConfig,
    dspNodes,
    compressorConfig,
    delayConfig,
    reverbConfig,
    limiterConfig,
    chorusConfig,
    noiseGateConfig,
    phaserConfig,
    channelMatrixConfig,
    // Computed
    isPlaying,
    isPaused,
    progress,
    positionFormatted,
    durationFormatted,
    // Actions
    openFile,
    play,
    pause,
    stop,
    seek,
    setVolume,
    setPreamp,
    loadReplayGain,
    setReplayGain,
    loadPlaybackSpeed,
    setPlaybackSpeed,
    loadEqBands,
    commitEqBands,
    loadResamplerConfig,
    setResamplerConfig,
    loadDopEnabled,
    setDopEnabled,
    loadTransitionConfig,
    setTransitionConfig,
    loadDspNodes,
    commitDspNodes,
    moveDspNode,
    loadCompressorConfig,
    setCompressorConfig,
    loadDelayConfig,
    setDelayConfig,
    loadReverbConfig,
    setReverbConfig,
    loadChorusConfig,
    setChorusConfig,
    loadNoiseGateConfig,
    setNoiseGateConfig,
    loadPhaserConfig,
    setPhaserConfig,
    loadChannelMatrixConfig,
    setChannelMatrixConfig,
    loadLimiter,
    setLimiter,
    setBackend,
    setDevice,
    selectOutputDevice,
    loadOutputDeviceSettings,
    logEngineInfo,
    refreshDevices,
    refreshAudioChain,
    refreshAudioAnalysis,
    loadRhythmVisualConfig,
    saveRhythmVisualConfig,
    // Events
    subscribeToEvents,
    unsubscribe
  }
})

function createDefaultEqBands(): EqBand[] {
  const frequencies = [20, 31.5, 50, 80, 125, 200, 315, 500, 800, 1250,
    2000, 3150, 5000, 8000, 10000, 12000, 14000, 16000, 18000, 20000]
  return frequencies.map((frequencyHz) => ({ enabled: false, frequencyHz, gainDb: 0, q: 1 }))
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}
