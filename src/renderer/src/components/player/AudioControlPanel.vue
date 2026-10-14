<script setup lang="ts">
import { usePlayerStore } from '@/stores/player/playerStore'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSlider from '@/components/ui/BaseSlider.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import DspParameterField from '@/components/player/DspParameterField.vue'
import { BUILT_IN_EQ_PRESETS, useEqPresetStore } from '@/stores/player/eqPresetStore'
import { useMessage } from '@/components/ui/useMessage'
import type { EqBand } from '@/types/audio'

const player = usePlayerStore()
const eqPresets = useEqPresetStore()
const { t, te } = useI18n()
const { success, warning } = useMessage()
let eqCommitTimer: ReturnType<typeof setTimeout> | undefined
let draggingNodeIndex: number | null = null
const savePresetDialogOpen = ref(false)
const resetSettingsDialogOpen = ref(false)
const resettingSettings = ref(false)
const presetName = ref('')
const editingPresetId = ref<string | undefined>()
const lastSelectedEqPresetId = ref<string>()
const irFileInput = ref<HTMLInputElement | null>(null)
const irError = ref('')
const clipGuardRecentlyActive = ref(false)
let clipGuardActivityTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => player.audioAnalysis.clipGuardLimitedFrames,
  (count, previous) => {
    if (count <= previous) {
      if (count < previous) clipGuardRecentlyActive.value = false
      return
    }
    clipGuardRecentlyActive.value = true
    if (clipGuardActivityTimer) clearTimeout(clipGuardActivityTimer)
    clipGuardActivityTimer = setTimeout(() => {
      clipGuardRecentlyActive.value = false
      clipGuardActivityTimer = undefined
    }, 1500)
  }
)
const clipGuardStatus = computed(() => {
  if (!player.audioChain) return t('ap.clipGuardStandingBy')
  if (!player.audioChain.activeNodes.includes('Output clip guard')) return t('ap.clipGuardBypassed')
  if (player.state !== 'playing') return t('ap.clipGuardStandingBy')
  return clipGuardRecentlyActive.value ? t('ap.clipGuardWorking') : t('ap.clipGuardStandingBy')
})
const irAppliedGainDb = computed(
  () =>
    player.impulseResponseConfig.gainDb +
    (player.impulseResponseConfig.autoGain ? (player.impulseResponseConfig.autoPreampDb ?? 0) : 0)
)
function showIrError(code?: string): void {
  const key = `ap.irErrors.${code || 'unknown'}`
  irError.value = te(key) ? t(key) : t('ap.irLoadFailed')
  warning(irError.value)
}
const stereoPresetOptions = computed(() => [
  { value: 'neutral', label: t('ap.stereoNeutral') },
  { value: 'wide', label: t('ap.stereoWide') },
  { value: 'focused', label: t('ap.stereoFocused') },
  { value: 'custom', label: t('ap.stereoCustom') }
])
const stereoPreset = computed(() => {
  const { enabled, midDb, sideDb, width } = player.stereoFieldConfig
  if (!enabled || (midDb === 0 && sideDb === 0 && width === 1)) return 'neutral'
  if (midDb === 0 && sideDb === 0 && width === 1.5) return 'wide'
  if (midDb === 2 && sideDb === 0 && width === 0.75) return 'focused'
  return 'custom'
})

function setStereoPreset(value: string | number | (string | number)[]): void {
  if (typeof value !== 'string' || value === 'custom') return
  player.stereoFieldConfig.enabled = value !== 'neutral'
  player.stereoFieldConfig.midDb = value === 'focused' ? 2 : 0
  player.stereoFieldConfig.sideDb = 0
  player.stereoFieldConfig.width = value === 'wide' ? 1.5 : value === 'focused' ? 0.75 : 1
  void player.setStereoFieldConfig()
}
function updateStereoField(): void {
  player.stereoFieldConfig.midDb = clamp(player.stereoFieldConfig.midDb, -12, 6, 0)
  player.stereoFieldConfig.sideDb = clamp(player.stereoFieldConfig.sideDb, -12, 6, 0)
  player.stereoFieldConfig.width = clamp(player.stereoFieldConfig.width, 0, 2, 1)
  player.stereoFieldConfig.enabled = true
  void player.setStereoFieldConfig()
}
const crossfeedPresetOptions = computed(() => [
  { value: 'off', label: t('ap.crossfeedOff') },
  { value: 'light', label: t('ap.crossfeedLight') },
  { value: 'standard', label: t('ap.crossfeedStandard') },
  { value: 'custom', label: t('ap.stereoCustom') }
])
const crossfeedPreset = computed(() => {
  const { enabled, strength, cutoffHz, delayMs } = player.crossfeedConfig
  if (!enabled) return 'off'
  if (strength === 0.25 && cutoffHz === 700 && delayMs === 0.2) return 'light'
  if (strength === 0.5 && cutoffHz === 700 && delayMs === 0.25) return 'standard'
  return 'custom'
})
function setCrossfeedPreset(value: string | number | (string | number)[]): void {
  if (typeof value !== 'string' || value === 'custom') return
  player.crossfeedConfig.enabled = value !== 'off'
  if (value === 'light' || value === 'standard') {
    player.crossfeedConfig.strength = value === 'light' ? 0.25 : 0.5
    player.crossfeedConfig.cutoffHz = 700
    player.crossfeedConfig.delayMs = value === 'light' ? 0.2 : 0.25
  }
  void player.setCrossfeedConfig()
}
function setCrossfeedEnabled(value: boolean | string | number): void {
  player.crossfeedConfig.enabled = value === true
  void player.setCrossfeedConfig()
}
function updateCrossfeed(): void {
  player.crossfeedConfig.strength = clamp(player.crossfeedConfig.strength, 0, 1, 0.5)
  player.crossfeedConfig.cutoffHz = clamp(player.crossfeedConfig.cutoffHz, 300, 1500, 700)
  player.crossfeedConfig.delayMs = clamp(player.crossfeedConfig.delayMs, 0, 0.6, 0.25)
  player.crossfeedConfig.enabled = true
  void player.setCrossfeedConfig()
}
async function setIrEnabled(value: boolean | string | number): Promise<void> {
  if (value === true && !player.impulseResponseConfig.path) {
    irFileInput.value?.click()
    return
  }
  const previous = { ...player.impulseResponseConfig }
  player.impulseResponseConfig = {
    ...previous,
    enabled: value === true
  }
  const result = await player.setImpulseResponseConfig()
  if (!result.success) {
    player.impulseResponseConfig = previous
    showIrError(result.error)
  } else irError.value = ''
}
async function importIr(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const path = window.api.audio.getFilePath(file)
  if (!path) {
    showIrError('path_unavailable')
    return
  }
  const previous = { ...player.impulseResponseConfig }
  player.impulseResponseConfig = { ...previous, enabled: true, path }
  const result = await player.setImpulseResponseConfig()
  if (!result.success) {
    player.impulseResponseConfig = previous
    showIrError(result.error)
  } else irError.value = ''
}
async function updateIrGain(): Promise<void> {
  player.impulseResponseConfig.gainDb = clamp(player.impulseResponseConfig.gainDb, -24, 12, 0)
  const result = await player.setImpulseResponseConfig()
  if (!result.success) {
    await player.loadImpulseResponseConfig()
    showIrError(result.error)
  } else irError.value = ''
}
function setIrAutoGain(enabled: boolean | string | number): void {
  player.impulseResponseConfig.autoGain = enabled === true
  void updateIrGain()
}

const eqPresetOptions = computed(() => [
  ...BUILT_IN_EQ_PRESETS.map((preset) => ({
    value: preset.id,
    label: t(`ap.eqPresets.${preset.name}`)
  })),
  ...eqPresets.customPresets.map((preset) => ({ value: preset.id, label: preset.name })),
  { value: 'modified', label: t('ap.eqPresetModified'), disabled: true }
])

const selectedEqPreset = computed(() => {
  const match = eqPresets.allPresets.find((preset) => bandsMatch(player.eqBands, preset.bands))
  return match?.id ?? 'modified'
})

function bandsMatch(left: EqBand[], right: EqBand[]): boolean {
  return (
    left.length === right.length &&
    left.every((band, index) => {
      const other = right[index]
      return (
        other !== undefined &&
        band.enabled === other.enabled &&
        Math.abs(band.frequencyHz - other.frequencyHz) < 0.001 &&
        Math.abs(band.gainDb - other.gainDb) < 0.001 &&
        Math.abs(band.q - other.q) < 0.001
      )
    })
  )
}

function selectEqPreset(value: string | number | (string | number)[]): void {
  if (typeof value !== 'string' || value === 'modified') return
  const preset = eqPresets.allPresets.find((item) => item.id === value)
  if (!preset) return
  player.eqBands.splice(0, player.eqBands.length, ...preset.bands.map((band) => ({ ...band })))
  lastSelectedEqPresetId.value = preset.id
  commitEqBands()
}

function openSavePresetDialog(): void {
  const selectedCustomId = eqPresets.customPresets.some(
    (preset) => preset.id === selectedEqPreset.value
  )
    ? selectedEqPreset.value
    : lastSelectedEqPresetId.value
  const currentCustom = eqPresets.customPresets.find((preset) => preset.id === selectedCustomId)
  editingPresetId.value = currentCustom?.id
  presetName.value = currentCustom?.name ?? ''
  savePresetDialogOpen.value = true
}

function saveCustomPreset(): void {
  const name = presetName.value.trim()
  if (!name) {
    warning(t('ap.eqPresetNameRequired'))
    return
  }
  if (name.length > 40) {
    warning(t('ap.eqPresetNameTooLong'))
    return
  }
  const duplicate = eqPresets.customPresets.some(
    (preset) =>
      preset.id !== editingPresetId.value &&
      preset.name.toLocaleLowerCase() === name.toLocaleLowerCase()
  )
  if (duplicate) {
    warning(t('ap.eqPresetNameExists'))
    return
  }
  lastSelectedEqPresetId.value = eqPresets.savePreset(name, player.eqBands, editingPresetId.value)
  savePresetDialogOpen.value = false
  success(t(editingPresetId.value ? 'ap.eqPresetUpdated' : 'ap.eqPresetSaved', { name }))
}

function deleteSelectedEqPreset(): void {
  const preset = eqPresets.customPresets.find((item) => item.id === selectedEqPreset.value)
  if (!preset) return
  eqPresets.deletePreset(preset.id)
  lastSelectedEqPresetId.value = undefined
  success(t('ap.eqPresetDeleted', { name: preset.name }))
}

async function initializeAudioControls(): Promise<void> {
  const results = await Promise.allSettled([
    player.loadOutputDeviceSettings(),
    player.refreshDevices(),
    player.refreshAudioChain(),
    player.loadEqBands(),
    player.loadReplayGain(),
    player.loadPlaybackSpeed(),
    player.loadResamplerConfig(),
    player.loadDopEnabled(),
    player.loadTransitionConfig(),
    player.loadDspNodes(),
    player.loadCompressorConfig(),
    player.loadDelayConfig(),
    player.loadReverbConfig(),
    player.loadChorusConfig(),
    player.loadNoiseGateConfig(),
    player.loadPhaserConfig(),
    player.loadChannelMatrixConfig(),
    player.loadStereoFieldConfig(),
    player.loadCrossfeedConfig(),
    player.loadImpulseResponseConfig(),
    player.loadLimiter()
  ])

  const failed = results.filter((result) => result.status === 'rejected')
  if (failed.length > 0) {
    console.warn(`[AudioControlPanel] ${failed.length} control value(s) could not be initialized`)
  }
}

onMounted(() => {
  player.setLoudnessAnalysisEnabled(true)
  player.setAudioControlAnalysisActive(true)
  void initializeAudioControls()
})
onBeforeUnmount(() => {
  if (clipGuardActivityTimer) clearTimeout(clipGuardActivityTimer)
  player.setAudioControlAnalysisActive(false)
  player.setLoudnessAnalysisEnabled(false)
})

function resetEqBands(): void {
  for (const band of player.eqBands) {
    band.enabled = false
    band.gainDb = 0
    band.q = 1
  }
  lastSelectedEqPresetId.value = 'flat'
  commitEqBands()
}
async function resetAudioProcessingSettings(): Promise<void> {
  if (resettingSettings.value) return
  resettingSettings.value = true
  if (eqCommitTimer) clearTimeout(eqCommitTimer)
  eqCommitTimer = undefined
  try {
    const result = await player.resetAudioProcessingSettings()
    if (!result.success) {
      warning(t('ap.resetAudioSettingsFailed', { reason: result.error ?? 'unknown' }))
      return
    }
    lastSelectedEqPresetId.value = 'flat'
    irError.value = ''
    resetSettingsDialogOpen.value = false
    success(t('ap.resetAudioSettingsDone'))
  } catch (error) {
    warning(t('ap.resetAudioSettingsFailed', { reason: String(error) }))
  } finally {
    resettingSettings.value = false
  }
}
function commitEqBands(): void {
  if (eqCommitTimer) clearTimeout(eqCommitTimer)
  eqCommitTimer = undefined
  void player.commitEqBands()
}
function previewEqGain(index: number, event: Event): void {
  const band = player.eqBands[index]
  band.gainDb = clamp(Number((event.target as HTMLInputElement).value), -12, 12, 0)
  band.enabled = Math.abs(band.gainDb) >= 0.0001
  scheduleEqCommit()
}
function scheduleEqCommit(): void {
  if (eqCommitTimer) clearTimeout(eqCommitTimer)
  eqCommitTimer = setTimeout(commitEqBands, 80)
}
function setEqBandEnabled(index: number, event: Event): void {
  player.eqBands[index].enabled = (event.target as HTMLInputElement).checked
  commitEqBands()
}
function formatFrequency(hz: number): string {
  return hz >= 1000 ? `${(hz / 1000).toFixed(hz % 1000 === 0 ? 0 : 1)}k` : `${hz}`
}

/**
 * DSP
 */
function updateDspNodes(): void {
  void player.commitDspNodes()
}
function isLegacyDspNode(id: string): boolean {
  return ['compressor', 'delay', 'reverb', 'chorus', 'noise_gate', 'phaser'].includes(id)
}
function isNodeActive(id: string): boolean {
  switch (id) {
    case 'channel_matrix':
      return player.channelMatrixConfig.enabled
    case 'replay_gain':
      return (
        player.replayGainConfig.active && Math.abs(player.replayGainConfig.appliedGainDb) > 0.0001
      )
    case 'preamp':
      return player.preampEnabled
    case 'eq':
      return player.eqBands.some((band) => band.enabled && Math.abs(band.gainDb) > 0.0001)
    case 'stereo_field':
      return player.stereoFieldConfig.enabled
    case 'crossfeed':
      return player.crossfeedConfig.enabled && player.crossfeedConfig.strength > 0
    case 'impulse_response':
      return player.impulseResponseConfig.enabled
    case 'limiter':
      return player.limiterConfig.enabled
    default:
      return player.dspNodes.find((node) => node.id === id)?.enabled ?? false
  }
}
function setDspNodeEnabled(index: number, enabled: boolean | string | number): void {
  player.dspNodes[index].enabled = enabled === true
  updateDspNodes()
}
function nodeLabel(id: string): string {
  switch (id) {
    case 'channel_matrix':
      return t('ap.channelMatrix')
    case 'replay_gain':
      return t('ap.replayGain')
    case 'preamp':
      return t('ap.preamp')
    case 'eq':
      return t('ap.eq')
    case 'compressor':
      return t('ap.compressor')
    case 'delay':
      return t('ap.delay')
    case 'reverb':
      return t('ap.reverb')
    case 'chorus':
      return t('ap.chorus')
    case 'noise_gate':
      return t('ap.noiseGate')
    case 'phaser':
      return t('ap.phaser')
    case 'stereo_field':
      return t('ap.stereoField')
    case 'crossfeed':
      return t('ap.crossfeed')
    case 'impulse_response':
      return t('ap.irCorrection')
    case 'limiter':
      return t('ap.limiter')
    default:
      return id
  }
}
function updateCompressor(): void {
  const config = player.compressorConfig
  config.thresholdDb = clamp(config.thresholdDb, -60, 0, -18)
  config.ratio = clamp(config.ratio, 1, 20, 4)
  config.attackMs = clamp(config.attackMs, 0.1, 500, 10)
  config.releaseMs = clamp(config.releaseMs, 5, 2000, 100)
  config.makeupDb = clamp(config.makeupDb, -12, 24, 0)
  void player.setCompressorConfig()
}
function updateDelay(): void {
  const config = player.delayConfig
  config.delayMs = clamp(config.delayMs, 1, 2000, 250)
  config.feedback = clamp(config.feedback, 0, 0.95, 0.25)
  config.mix = clamp(config.mix, 0, 1, 0.2)
  void player.setDelayConfig()
}
function updateReverb(): void {
  const config = player.reverbConfig
  config.roomSize = clamp(config.roomSize, 0, 1, 0.5)
  config.decay = clamp(config.decay, 0, 1, 0.4)
  config.mix = clamp(config.mix, 0, 1, 0.15)
  void player.setReverbConfig()
}
function updateChorus(): void {
  const config = player.chorusConfig
  config.rateHz = clamp(config.rateHz, 0.05, 10, 0.8)
  config.depthMs = clamp(config.depthMs, 0.1, 15, 8)
  config.mix = clamp(config.mix, 0, 1, 0.35)
  void player.setChorusConfig()
}
function updateNoiseGate(): void {
  const config = player.noiseGateConfig
  config.thresholdDb = clamp(config.thresholdDb, -80, 0, -50)
  config.attackMs = clamp(config.attackMs, 0.1, 200, 5)
  config.holdMs = clamp(config.holdMs, 0, 2000, 50)
  config.releaseMs = clamp(config.releaseMs, 5, 2000, 150)
  config.rangeDb = clamp(config.rangeDb, -100, 0, -80)
  void player.setNoiseGateConfig()
}
function updatePhaser(): void {
  const config = player.phaserConfig
  config.rateHz = clamp(config.rateHz, 0.05, 10, 0.4)
  config.depth = clamp(config.depth, 0, 1, 0.6)
  config.centerHz = clamp(config.centerHz, 100, 5000, 800)
  config.feedback = clamp(config.feedback, -0.95, 0.95, 0.2)
  config.mix = clamp(config.mix, 0, 1, 0.5)
  void player.setPhaserConfig()
}
function updateLimiter(): void {
  player.limiterConfig.ceilingDb = clamp(player.limiterConfig.ceilingDb, -12, 0, -1)
  player.limiterConfig.releaseMs = clamp(player.limiterConfig.releaseMs, 5, 2000, 80)
  void player.setLimiter()
}
function resetLimiter(): void {
  Object.assign(player.limiterConfig, { ceilingDb: -1, releaseMs: 80 })
  updateLimiter()
}
function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}
function resetDspNode(id: string): void {
  if (id === 'compressor') {
    Object.assign(player.compressorConfig, {
      thresholdDb: -18,
      ratio: 4,
      attackMs: 10,
      releaseMs: 100,
      makeupDb: 0
    })
    updateCompressor()
  } else if (id === 'delay') {
    Object.assign(player.delayConfig, { delayMs: 250, feedback: 0.25, mix: 0.2 })
    updateDelay()
  } else if (id === 'reverb') {
    Object.assign(player.reverbConfig, { roomSize: 0.5, decay: 0.4, mix: 0.15 })
    updateReverb()
  } else if (id === 'chorus') {
    Object.assign(player.chorusConfig, { rateHz: 0.8, depthMs: 8, mix: 0.35 })
    updateChorus()
  } else if (id === 'noise_gate') {
    Object.assign(player.noiseGateConfig, {
      thresholdDb: -50,
      attackMs: 5,
      holdMs: 50,
      releaseMs: 150,
      rangeDb: -80
    })
    updateNoiseGate()
  } else if (id === 'phaser') {
    Object.assign(player.phaserConfig, {
      rateHz: 0.4,
      depth: 0.6,
      centerHz: 800,
      feedback: 0.2,
      mix: 0.5
    })
    updatePhaser()
  }
}
function setLimiterEnabled(enabled: boolean | string | number): void {
  player.limiterConfig.enabled = enabled === true
  updateLimiter()
}
function startDragNode(index: number): void {
  draggingNodeIndex = index
}
function endDragNode(): void {
  draggingNodeIndex = null
}
function dropDspNode(targetIndex: number): void {
  if (draggingNodeIndex === null || draggingNodeIndex === targetIndex) return
  const [node] = player.dspNodes.splice(draggingNodeIndex, 1)
  player.dspNodes.splice(targetIndex, 0, node)
  draggingNodeIndex = null
  updateDspNodes()
}

/**
 * Resampler
 */
function updateResampler(): void {
  void player.setResamplerConfig(player.resamplerConfig)
}
const sampleRateOptions = [
  { label: '44.1 kHz', value: 44100 },
  { label: '48 kHz', value: 48000 },
  { label: '88.2 kHz', value: 88200 },
  { label: '96 kHz', value: 96000 },
  { label: '176.4 kHz', value: 176400 },
  { label: '192 kHz', value: 192000 }
]
const qualityOptions = [
  { label: t('ap.qualityBest'), value: 'best' },
  { label: t('ap.qualityMedium'), value: 'medium' },
  { label: t('ap.qualityFast'), value: 'fast' }
]
const resamplerStatus = computed(() => {
  if (player.audioChain?.activeNodes.includes('DoP encoded transport')) return ''
  const sourceRate = player.audioChain?.sourceFormat.sampleRate ?? 0
  const outputRate = player.audioChain?.backendFormat.sampleRate ?? 0
  if (!sourceRate || !outputRate) return ''
  const targetRate = player.resamplerConfig.targetSampleRate
  if (player.resamplerConfig.forceOutputRate && outputRate !== targetRate) {
    return t(
      player.currentBackend === 'wasapi_shared'
        ? 'ap.resamplerSharedRate'
        : 'ap.resamplerTargetUnavailable',
      { target: targetRate, actual: outputRate }
    )
  }
  return sourceRate === outputRate
    ? t('ap.resamplerBypassed', { rate: outputRate })
    : t('ap.resamplerActive', { source: sourceRate, actual: outputRate })
})
function setResamplerEnabled(enabled: boolean | string | number): void {
  player.resamplerConfig.forceOutputRate = enabled === true
  updateResampler()
}
function setDopEnabled(enabled: boolean | string | number): void {
  void player.setDopEnabled(enabled === true)
}
function updateTransitionConfig(): void {
  void player.setTransitionConfig()
}
function setGaplessEnabled(enabled: boolean | string | number): void {
  player.transitionConfig.gaplessEnabled = enabled === true
  updateTransitionConfig()
}
function setCrossfadeEnabled(enabled: boolean | string | number): void {
  player.transitionConfig.crossfadeEnabled = enabled === true
  updateTransitionConfig()
}
function updateChannelMatrix(): void {
  player.channelMatrixConfig.balance = clamp(player.channelMatrixConfig.balance, -1, 1, 0)
  player.channelMatrixConfig.outputGains = player.channelMatrixConfig.outputGains.map((gain) =>
    clamp(gain, 0, 2, 1)
  )
  void player.setChannelMatrixConfig()
}
function setChannelMatrixEnabled(enabled: boolean | string | number): void {
  player.channelMatrixConfig.enabled = enabled === true
  updateChannelMatrix()
}
function setSwapStereo(enabled: boolean | string | number): void {
  player.channelMatrixConfig.swapStereo = enabled === true
  updateChannelMatrix()
}
function setMonoDownmix(enabled: boolean | string | number): void {
  player.channelMatrixConfig.monoDownmix = enabled === true
  updateChannelMatrix()
}

function setPreampEnabled(enabled: boolean | string | number): void {
  void player.setPreamp(player.preampDb, enabled === true)
}

function setPreampDb(val: number): void {
  void player.setPreamp(val, player.preampEnabled)
}

const replayGainModeOptions = [
  { label: t('ap.off'), value: 'off' },
  { label: t('ap.track'), value: 'track' },
  { label: t('ap.album'), value: 'album' }
]
function updateReplayGain(): void {
  void player.setReplayGain()
}
function setReplayGainClipping(enabled: boolean | string | number): void {
  player.replayGainConfig.preventClipping = enabled === true
  updateReplayGain()
}
function updatePlaybackSpeed(): void {
  void player.setPlaybackSpeed()
}
function setPlaybackSpeedEnabled(enabled: boolean | string | number): void {
  player.playbackSpeedConfig.enabled = enabled === true
  updatePlaybackSpeed()
}

function bitPerfectLabel(): string {
  const chain = player.audioChain
  if (!chain) return t('ap.bitPerfectUnavailable')
  if (chain.isBitPerfect) return t('ap.bitPerfectVerified')
  if (chain.bitPerfectVerificationState === 'eligible_unverified')
    return t('ap.bitPerfectCandidate')
  return t('ap.bitPerfectUnavailable')
}
function pipelineNodeLabel(node: string): string {
  if (node === 'Channel matrix') return t('ap.channelMatrix')
  if (node === 'Parametric EQ' || node === 'EQ') return t('ap.eq')
  if (node === 'Preamp') return t('ap.preamp')
  if (node === 'Limiter') return t('ap.limiter')
  if (node === 'Stereo field') return t('ap.stereoField')
  if (node === 'Crossfeed') return t('ap.crossfeed')
  if (node === 'Impulse response') return t('ap.irCorrection')
  if (node === 'Output clip guard') return t('ap.outputClipGuard')
  return node
}
const backendLabel: Record<string, string> = {
  asio: 'ASIO',
  wasapi_shared: 'WASAPI Shared',
  wasapi_exclusive: 'WASAPI Exclusive',
  directsound: 'DirectSound'
}
const currentBackendLabel = computed(
  () => backendLabel[player.currentBackend] ?? player.currentBackend
)
const deviceKey = (backend: string, id: string): string => `${backend}\u0000${id}`
const selectedOutputDeviceKey = computed(() =>
  deviceKey(player.currentBackend, player.currentDeviceId)
)
const deviceOptions = computed(() =>
  player.devices.map((dev) => ({
    label: `${backendLabel[dev.backend]} · ${dev.name}${dev.isDefault ? ` (${t('ap.defaultDevice')})` : ''}`,
    value: deviceKey(dev.backend, dev.id)
  }))
)
async function onDeviceChange(val: string | number | (string | number)[]): Promise<void> {
  if (Array.isArray(val)) return
  const device = player.devices.find((item) => deviceKey(item.backend, item.id) === val)
  if (device) await player.selectOutputDevice(device)
}
function refreshOutputDevices(): void {
  void player.refreshDevices()
}
</script>

<template>
  <div class="text-text select-none overflow-y-scroll no-scrollbar">
    <div class="mb-3 flex justify-end">
      <button
        class="rounded-lg border border-border px-3 py-1.5 text-xs text-text hover:border-primary hover:text-primary"
        @click="resetSettingsDialogOpen = true"
      >
        {{ t('ap.resetAudioSettings') }}
      </button>
    </div>
    <!-- audio pipeline -->
    <section v-if="player.audioChain" class="rounded-xl border border-border p-3">
      <div class="mb-4 flex items-center justify-between text-xs font-medium text-text">
        <!-- title -->
        <span>{{ t('ap.audioPipeline') }}</span>
        <!-- status -->
        <div class="space-x-2">
          <span
            class="rounded-full border border-border px-2 py-0.5 text-[11px] text-text-l font-normal"
          >
            {{ currentBackendLabel }}
          </span>
          <span
            class="rounded-full border border-border px-2 py-0.5 text-[11px] text-text-l font-normal"
          >
            {{ player.state }}
          </span>
          <span
            v-if="player.trackInfo?.isDsd"
            class="rounded-full border border-border px-2 py-0.5 text-[11px] text-text-l font-normal"
          >
            {{ player.trackInfo.format }}
          </span>
          <span
            class="rounded-full border px-2 py-0.5 text-[11px] font-normal"
            :class="
              player.audioChain.isBitPerfect
                ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-500'
                : player.audioChain.isBitPerfectEligible
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-500'
                  : 'border-border bg-bg text-text-l'
            "
            :title="player.audioChain.bitPerfectBlockers.join('\n')"
            >{{ bitPerfectLabel() }}</span
          >
        </div>
      </div>
      <div class="text-xs">
        <!-- io -->
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-text-l">
          <span
            >{{ t('ap.input') }} {{ player.audioChain.sourceFormat.sampleRate || '—' }} Hz ·
            {{ player.audioChain.sourceFormat.channels || '—' }} {{ t('ap.channels') }}</span
          ><span>→</span
          ><span
            >{{ t('ap.output') }} {{ player.audioChain.backendFormat.sampleRate || '—' }} Hz ·
            {{ player.audioChain.backendFormat.channels || '—' }} {{ t('ap.channels') }}</span
          >
          <span>|</span>
          <span class="mt-0.5 truncate">
            {{ player.trackInfo?.format }} · {{ player.trackInfo?.sampleRate }} Hz ·
            {{ player.trackInfo?.bitDepth }} bit · {{ player.trackInfo?.channels }}
            {{ t('ap.channels') }}
          </span>
        </div>
        <!-- active nodes follow the native PCM processing order -->
        <div class="mt-2 rounded-lg border border-border-l p-2">
          <div class="mb-1 text-[11px] text-text-l">{{ t('ap.signalPath') }}</div>
          <div class="flex flex-wrap items-center gap-1.5">
            <template
              v-for="(node, index) in player.audioChain.activeNodes"
              :key="`active-${node}`"
            >
              <span v-if="index > 0" class="text-[11px] text-text-l">→</span>
              <span class="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                {{ pipelineNodeLabel(node) }}
              </span>
            </template>
            <span v-if="!player.audioChain.activeNodes.length" class="text-[11px] text-text-l">
              {{ t('ap.noActiveNodes') }}
            </span>
          </div>
        </div>
        <div
          v-if="player.audioChain.bypassedNodes.length"
          class="mt-2 rounded-lg border border-border-l p-2"
        >
          <div class="mb-1 text-[11px] text-text-l">{{ t('ap.bypass') }}</div>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="node in player.audioChain.bypassedNodes"
              :key="`bypassed-${node}`"
              class="rounded bg-bg-l px-1.5 py-0.5 text-[11px] text-text-l"
            >
              {{ pipelineNodeLabel(node) }}
            </span>
          </div>
        </div>
        <p
          v-if="player.audioChain.bitPerfectBlockers.length"
          class="pt-1 text-[11px] leading-5 text-text-l"
        >
          {{ player.audioChain.bitPerfectBlockers.join(' · ') }}
        </p>
        <p v-if="player.trackInfo?.isDsd" class="text-[11px] leading-5 text-text-l">
          {{ player.trackInfo.format }} · {{ player.trackInfo.dsdSampleRate }} Hz →
          {{
            player.trackInfo.dsdTransport === 'pcm_conversion'
              ? `PCM ${player.trackInfo.sampleRate} Hz → ${t('ap.output')} ${player.audioChain?.backendFormat.sampleRate || '—'} Hz`
              : player.trackInfo.dsdTransport
          }}
        </p>
        <p v-if="player.glitchCount > 0" class="text-[11px] text-amber-500">
          {{ t('ap.playEx') }} {{ player.glitchCount }}
        </p>
      </div>
    </section>
    <!-- audio analyze -->
    <section class="mt-5 rounded-xl border border-border p-3">
      <div class="mb-3 text-xs font-medium text-text">
        {{ t('ap.analyze') }}
      </div>
      <div class="space-y-2">
        <!-- timing -->
        <div class="px-2">
          <p class="text-[11px] text-text-l">
            {{ t('ap.outputTime') }} {{ player.audioAnalysis.outputTimeMs.toFixed(0) }} ms
            <span class="mx-1 text-border">·</span>
            {{ t('ap.analysisTime') }} {{ player.audioAnalysis.analysisTimeMs.toFixed(0) }} ms
            <span class="mx-1 text-border">·</span>
            {{ t('ap.latency') }} {{ player.audioAnalysis.analysisLatencyMs.toFixed(0) }} ms
            <span class="mx-1 text-border">·</span>
            {{ t('ap.dropped') }} {{ player.audioAnalysis.droppedFrames }}
          </p>
        </div>

        <!-- audio metrics -->
        <div class="px-2">
          <p class="text-[11px] text-text-l">
            {{ t('ap.rms') }} {{ player.audioAnalysis.rms.toFixed(3) }}
            <span class="mx-1 text-border">·</span>
            {{ t('ap.low') }} {{ player.audioAnalysis.lowEnergy.toFixed(3) }}
            <span class="mx-1 text-border">·</span>
            {{ t('ap.onset') }} {{ player.audioAnalysis.onsetStrength.toFixed(3) }}
            <span class="mx-1 text-border">·</span>
            {{ t('ap.beat') }} {{ player.audioAnalysis.beatSequence }}
            <span class="mx-1 text-border">·</span>
            {{ t('ap.estimatedBpm') }}
            {{ player.audioAnalysis.bpm > 0 ? player.audioAnalysis.bpm.toFixed(1) : '—' }}
          </p>
        </div>

        <!-- LUFS -->
        <div class="px-2">
          <div class="flex items-center gap-4">
            <span class="text-[11px] text-text-l">
              M
              <span class="text-sm font-medium text-text">{{
                player.audioAnalysis.momentaryLufs.toFixed(1)
              }}</span>
            </span>
            <span class="text-[11px] text-text-l">
              S
              <span class="text-sm font-medium text-text">{{
                player.audioAnalysis.shortTermLufs.toFixed(1)
              }}</span>
            </span>
            <span class="text-[11px] text-text-l">
              I
              <span class="text-sm font-medium text-text">{{
                player.audioAnalysis.integratedLufs.toFixed(1)
              }}</span>
            </span>
            <span class="text-[11px] text-text-l2">LUFS</span>
          </div>
        </div>

        <!-- rhythm visual -->
        <div class="px-2">
          <div class="flex items-center gap-4 flex-wrap">
            <div class="flex items-center gap-2">
              <span class="text-xs text-text-l">{{ t('ap.rhythmVisuals') }}</span>
              <BaseSwitch
                :model-value="player.rhythmVisualConfig.enabled"
                size="sm"
                @change="
                  (val) => {
                    player.rhythmVisualConfig.enabled = val === true
                    player.saveRhythmVisualConfig()
                  }
                "
              />
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-text-l whitespace-nowrap">
                {{ t('ap.intensity') }} {{ Math.round(player.rhythmVisualConfig.intensity * 100) }}%
              </span>
              <BaseSlider
                v-model="player.rhythmVisualConfig.intensity"
                :min="0"
                :max="1"
                :step="0.05"
                class="w-48"
                @change="player.saveRhythmVisualConfig()"
              />
            </div>
            <div class="flex items-center gap-2">
              <span class="text-xs text-text-l">{{ t('ap.reduceMotion') }}</span>
              <BaseSwitch
                :model-value="player.rhythmVisualConfig.reducedMotion"
                size="sm"
                @change="
                  (val) => {
                    player.rhythmVisualConfig.reducedMotion = val === true
                    player.saveRhythmVisualConfig()
                  }
                "
              />
            </div>
          </div>
        </div>
      </div>
    </section>
    <!-- audio output settings -->
    <section class="mt-5 rounded-xl border border-border p-3">
      <div class="mb-3 text-xs font-medium text-text">
        {{ t('ap.outputSettings') }}
      </div>
      <div class="flex flex-col">
        <!-- Device -->
        <div class="flex gap-2 rounded-lg">
          <span class="text-sm whitespace-nowrap w-36">{{ t('ap.outputDevice') }}</span>
          <BaseSelect
            :model-value="selectedOutputDeviceKey"
            :options="deviceOptions"
            size="xs"
            class="w-128"
            @change="onDeviceChange"
          />
          <button
            class="h-[22px] w-[22px] rounded-md border border-border text-xs text-text-l transition-colors hover:border-primary hover:text-primary"
            :title="t('ap.refreshDevice')"
            @click="refreshOutputDevices"
          >
            ↻
          </button>
        </div>
        <!-- Volume -->
        <div class="flex items-center gap-3 mt-3">
          <span class="text-sm whitespace-nowrap w-36">{{ t('ap.volume') }}</span>
          <BaseSlider
            :model-value="Math.round(player.volume * 100)"
            :min="0"
            :max="100"
            class="w-64"
            @update:model-value="(val: number) => player.setVolume(val / 100)"
          />
          <span class="text-sm text-text-l whitespace-nowrap"
            >{{ Math.round(player.volume * 100) }} %</span
          >
        </div>
        <!-- Speed -->
        <div class="flex items-center gap-3 mt-3">
          <span class="text-sm whitespace-nowrap w-36">{{ t('ap.playSpeed') }} </span>
          <BaseSwitch
            :model-value="player.playbackSpeedConfig.enabled"
            size="sm"
            @change="(enabled) => setPlaybackSpeedEnabled(enabled)"
          />
          <BaseSlider
            v-model="player.playbackSpeedConfig.speed"
            :disabled="!player.playbackSpeedConfig.enabled"
            :min="0.5"
            :max="2"
            :step="0.05"
            class="w-64"
            @change="updatePlaybackSpeed"
          />
          <span class="text-sm text-text-l whitespace-nowrap"
            >{{ player.playbackSpeedConfig.speed.toFixed(2) }}×</span
          >
        </div>
        <!-- Preamp -->
        <div class="flex items-center gap-3 mt-3">
          <span class="text-sm whitespace-nowrap w-36">{{ t('ap.preamp') }} </span>
          <BaseSwitch
            :model-value="player.preampEnabled"
            size="sm"
            @change="(enabled) => setPreampEnabled(enabled)"
          />
          <BaseSlider
            v-model="player.preampDb"
            :disabled="!player.preampEnabled"
            :min="-24"
            :max="24"
            :step="0.1"
            class="w-64"
            @change="setPreampDb"
          />
          <span class="text-sm text-text-l whitespace-nowrap"
            >{{ player.preampDb.toFixed(1) }} dB</span
          >
        </div>
        <!-- ReplayGain -->
        <div class="flex items-center gap-3 mt-3">
          <span class="text-sm whitespace-nowrap w-36">{{ t('ap.replayGain') }}</span>
          <BaseSelect
            v-model="player.replayGainConfig.mode"
            :options="replayGainModeOptions"
            size="xs"
            class="w-48"
            @change="updateReplayGain"
          />
          <BaseSwitch
            :model-value="player.replayGainConfig.preventClipping"
            :disabled="player.replayGainConfig.mode === 'off'"
            size="sm"
            @change="(enabled) => setReplayGainClipping(enabled)"
          />
          <span class="text-xs text-text-l">{{ t('ap.preventClipping') }}</span>
          <span class="text-xs text-text-l">
            {{
              player.replayGainConfig.active
                ? `${player.replayGainConfig.appliedGainDb.toFixed(2)} dB ${t('ap.applied')}`
                : `${t('ap.noMatchingTags')}`
            }}
          </span>
        </div>
        <!-- Resampler -->
        <div class="flex flex-wrap items-center gap-3 mt-3">
          <span class="text-sm whitespace-nowrap w-36">{{ t('ap.resampler') }}</span>
          <BaseSwitch
            :model-value="player.resamplerConfig.forceOutputRate"
            size="sm"
            @change="(enabled) => setResamplerEnabled(enabled)"
          />
          <div v-if="player.resamplerConfig.forceOutputRate" class="flex gap-4">
            <BaseSelect
              v-model="player.resamplerConfig.targetSampleRate"
              :options="sampleRateOptions"
              size="xs"
              class="w-48"
              @change="updateResampler"
            />
            <BaseSelect
              v-model="player.resamplerConfig.quality"
              :options="qualityOptions"
              size="xs"
              class="w-48"
              @change="updateResampler"
            />
          </div>
          <span v-if="resamplerStatus" class="text-xs text-text-l">{{ resamplerStatus }}</span>
        </div>
        <!-- DoP -->
        <div class="flex items-center gap-3 mt-3">
          <span class="text-sm whitespace-nowrap w-36">{{ t('ap.enableDoP') }}</span>
          <BaseSwitch
            :model-value="player.dopEnabled"
            size="sm"
            @change="(enabled) => setDopEnabled(enabled)"
          />
          <span class="text-xs text-text-l">
            {{ t('ap.dopDesc') }} {{ t('ap.dopSupport') }} {{ t('ap.dopNextPlayback') }}
          </span>
        </div>
        <!-- Matrix -->
        <div class="flex items-center gap-3 mt-3">
          <span class="text-sm whitespace-nowrap w-36"
            >{{ t('ap.channelMatrix') }} {{ player.channelMatrixConfig.balance.toFixed(2) }}</span
          >
          <BaseSwitch
            :model-value="player.channelMatrixConfig.enabled"
            size="sm"
            @change="(enabled) => setChannelMatrixEnabled(enabled)"
          />
          <BaseSlider
            v-model="player.channelMatrixConfig.balance"
            :disabled="!player.channelMatrixConfig.enabled"
            :min="-1"
            :max="1"
            :step="0.05"
            class="w-64"
            @change="updateChannelMatrix"
          />
        </div>
        <div v-if="player.channelMatrixConfig.enabled" class="flex items-center gap-3 mt-3">
          <span class="text-sm whitespace-nowrap w-36" />
          <BaseSwitch
            :model-value="player.channelMatrixConfig.swapStereo"
            size="sm"
            @change="(enabled) => setSwapStereo(enabled)"
          />
          <span class="text-xs text-text-l mr-3">{{ t('ap.changeChannels') }}</span>
          <BaseSwitch
            :model-value="player.channelMatrixConfig.monoDownmix"
            size="sm"
            @change="(enabled) => setMonoDownmix(enabled)"
          />
          <span class="text-xs text-text-l">{{ t('ap.stereoToMono') }}</span>
        </div>
        <div v-if="player.channelMatrixConfig.enabled" class="flex items-center gap-3 mt-3">
          <span class="text-sm whitespace-nowrap w-36" />
          <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label
              v-for="(_gain, index) in player.channelMatrixConfig.outputGains"
              :key="index"
              class="text-xs"
              >Ch {{ index + 1 }}
              <input
                v-model.number="player.channelMatrixConfig.outputGains[index]"
                class="input-base h-6"
                type="number"
                min="0"
                max="2"
                step="0.01"
                @change="updateChannelMatrix"
              />
            </label>
          </div>
        </div>
        <div class="mt-4 border-t border-border pt-3">
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-sm w-36">{{ t('ap.stereoField') }}</span>
            <BaseSelect
              :model-value="stereoPreset"
              :options="stereoPresetOptions"
              size="xs"
              class="w-48"
              @change="setStereoPreset"
            />
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-3">
            <label class="text-xs w-36">
              {{ t('ap.stereoWidth') }} {{ Math.round(player.stereoFieldConfig.width * 100) }}%
            </label>
            <BaseSlider
              v-model="player.stereoFieldConfig.width"
              :min="0"
              :max="2"
              :step="0.05"
              class="w-48"
              @change="updateStereoField"
            />
          </div>
          <div class="mt-2 flex flex-wrap items-center gap-3">
            <label class="text-xs w-36"
              >{{ t('ap.midGain') }} {{ player.stereoFieldConfig.midDb.toFixed(1) }} dB</label
            >
            <BaseSlider
              v-model="player.stereoFieldConfig.midDb"
              :min="-12"
              :max="6"
              :step="0.5"
              class="w-48"
              @change="updateStereoField"
            />
            <label class="text-xs w-36"
              >{{ t('ap.sideGain') }} {{ player.stereoFieldConfig.sideDb.toFixed(1) }} dB</label
            >
            <BaseSlider
              v-model="player.stereoFieldConfig.sideDb"
              :min="-12"
              :max="6"
              :step="0.5"
              class="w-48"
              @change="updateStereoField"
            />
          </div>
          <p class="mt-1 text-xs text-text-l">{{ t('ap.stereoFieldDesc') }}</p>
        </div>
        <div class="mt-4 border-t border-border pt-3">
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-sm w-36">{{ t('ap.crossfeed') }}</span>
            <BaseSwitch
              :model-value="player.crossfeedConfig.enabled"
              size="sm"
              @change="setCrossfeedEnabled"
            />
            <BaseSelect
              :model-value="crossfeedPreset"
              :options="crossfeedPresetOptions"
              size="xs"
              class="w-48"
              @change="setCrossfeedPreset"
            />
          </div>
          <div v-if="player.crossfeedConfig.enabled" class="mt-2 flex flex-wrap items-center gap-3">
            <label class="text-xs w-36">
              {{ t('ap.crossfeedStrength') }}
              {{ Math.round(player.crossfeedConfig.strength * 100) }}%
            </label>
            <BaseSlider
              v-model="player.crossfeedConfig.strength"
              :min="0"
              :max="1"
              :step="0.05"
              class="w-48"
              @change="updateCrossfeed"
            />
          </div>
          <div v-if="player.crossfeedConfig.enabled" class="mt-2 flex flex-wrap items-center gap-3">
            <label class="text-xs w-36">
              {{ t('ap.crossfeedCutoff') }} {{ player.crossfeedConfig.cutoffHz.toFixed(0) }} Hz
            </label>
            <BaseSlider
              v-model="player.crossfeedConfig.cutoffHz"
              :min="300"
              :max="1500"
              :step="50"
              class="w-48"
              @change="updateCrossfeed"
            />
            <label class="text-xs w-36">
              {{ t('ap.crossfeedDelay') }} {{ player.crossfeedConfig.delayMs.toFixed(2) }} ms
            </label>
            <BaseSlider
              v-model="player.crossfeedConfig.delayMs"
              :min="0"
              :max="0.6"
              :step="0.05"
              class="w-48"
              @change="updateCrossfeed"
            />
          </div>
          <p class="mt-1 text-xs text-text-l">{{ t('ap.crossfeedDesc') }}</p>
        </div>
        <div class="mt-4 border-t border-border pt-3">
          <div class="flex flex-wrap items-center gap-3">
            <span class="text-sm w-36">{{ t('ap.irCorrection') }}</span>
            <BaseSwitch
              :model-value="player.impulseResponseConfig.enabled"
              size="sm"
              @change="setIrEnabled"
            />
            <button class="btn-hover px-2 py-1 text-xs" @click="irFileInput?.click()">
              {{ t('ap.irImport') }}
            </button>
            <input
              ref="irFileInput"
              class="hidden"
              type="file"
              accept=".wav,audio/wav"
              @change="importIr"
            />
          </div>
          <p
            v-if="player.impulseResponseConfig.path"
            class="mt-1 truncate text-xs text-text-l"
            :title="player.impulseResponseConfig.path"
          >
            {{ player.impulseResponseConfig.path }}
          </p>
          <p class="mt-1 text-xs text-text-l">{{ t('ap.irDesc') }}</p>
          <div
            v-if="player.impulseResponseConfig.enabled"
            class="mt-2 flex flex-wrap items-center gap-3"
          >
            <span class="text-xs w-36">{{ t('ap.irAutoGain') }}</span>
            <BaseSwitch
              :model-value="player.impulseResponseConfig.autoGain"
              size="sm"
              @change="setIrAutoGain"
            />
            <span class="text-xs text-text-l">
              {{
                player.impulseResponseConfig.autoGain
                  ? (player.impulseResponseConfig.autoPreampDb ?? 0).toFixed(1)
                  : '0.0'
              }}
              dB
            </span>
          </div>
          <div
            v-if="player.impulseResponseConfig.enabled"
            class="mt-2 flex flex-wrap items-center gap-3"
          >
            <label class="text-xs w-36"
              >{{ t('ap.irManualGain') }}
              {{ player.impulseResponseConfig.gainDb.toFixed(1) }} dB</label
            >
            <BaseSlider
              v-model="player.impulseResponseConfig.gainDb"
              :min="-24"
              :max="12"
              :step="0.5"
              class="w-48"
              @change="updateIrGain"
            />
            <span class="text-xs text-text-l"
              >{{ t('ap.irTotalGain') }} {{ irAppliedGainDb.toFixed(1) }} dB</span
            >
          </div>
          <p v-if="irError" class="mt-1 text-xs text-red-500">{{ irError }}</p>
        </div>
        <!-- Gapless -->
        <div class="flex items-center gap-3 mt-3">
          <span class="text-sm whitespace-nowrap w-36">{{ t('ap.gapless') }}</span>
          <BaseSwitch
            :model-value="player.transitionConfig.gaplessEnabled"
            size="sm"
            @change="(enabled) => setGaplessEnabled(enabled)"
          />
          <span class="text-xs text-text-l">{{ t('ap.gaplessDesc') }}</span>
        </div>
        <!-- Crossfade -->
        <div class="flex items-center gap-3 mt-3">
          <span class="text-sm whitespace-nowrap w-36">{{ t('ap.crossfade') }}</span>
          <BaseSwitch
            :model-value="player.transitionConfig.crossfadeEnabled"
            :disabled="!player.transitionConfig.gaplessEnabled"
            size="sm"
            @change="(enabled) => setCrossfadeEnabled(enabled)"
          />
          <div v-if="player.transitionConfig.crossfadeEnabled" class="w-20">
            <input
              v-model.number="player.transitionConfig.crossfadeMs"
              class="input-base h-6"
              type="number"
              min="0"
              max="30000"
              step="100"
              @change="updateTransitionConfig"
            />
          </div>
          <span v-if="player.transitionConfig.crossfadeEnabled" class="text-xs text-text-l">{{
            player.transitionConfig.crossfadeAuto ? t('ap.crossfadeMax') : 'ms'
          }}</span>
        </div>
        <div v-if="player.transitionConfig.crossfadeEnabled" class="flex items-center gap-3 mt-2">
          <span class="text-sm whitespace-nowrap w-36">{{ t('ap.crossfadeAuto') }}</span>
          <BaseSwitch
            :model-value="player.transitionConfig.crossfadeAuto"
            size="sm"
            @change="
              (enabled) => {
                player.transitionConfig.crossfadeAuto = enabled === true
                updateTransitionConfig()
              }
            "
          />
          <span class="text-xs text-text-l">{{ t('ap.crossfadeAutoDesc') }}</span>
        </div>
      </div>
    </section>
    <!-- EQ -->
    <section class="rounded-xl border border-border p-3 mt-5">
      <div class="flex items-center justify-between mb-2 text-xs">
        <span class="font-medium">{{ t('ap.eq') }}</span>

        <div class="flex items-center gap-2 text-sm text-text-l">
          <small>
            {{ player.eqBands.filter((b) => b.enabled && Math.abs(b.gainDb) >= 0.0001).length }}
            {{ t('ap.eqActive') }} · ±12 dB · Q 1.0 · {{ t('ap.eqAutoPreamp') }}
          </small>
          <button
            class="px-2 py-0.5 rounded text-[11px] bg-bg border border-primary cursor-pointer hover:opacity-90 transition-opacity"
            @click="commitEqBands"
          >
            {{ t('ap.applyEq') }}
          </button>
          <button
            class="px-2 py-0.5 rounded text-[11px] bg-bg border border-primary cursor-pointer hover:opacity-90 transition-opacity"
            @click="resetEqBands"
          >
            {{ t('ap.resetEq') }}
          </button>
        </div>
      </div>

      <div class="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-l tabular-nums">
        <span>{{ t('ap.eqPeak') }}: {{ player.audioChain?.eqPeakDb?.toFixed(1) ?? '—' }} dB</span>
        <span
          >{{ t('ap.eqAutoPreamp') }}:
          {{ player.audioChain?.eqAutoPreampDb?.toFixed(1) ?? '—' }} dB</span
        >
      </div>

      <div class="mb-3 flex flex-wrap items-center gap-2">
        <span class="text-xs text-text-l">{{ t('ap.eqPreset') }}</span>
        <BaseSelect
          :model-value="selectedEqPreset"
          :options="eqPresetOptions"
          size="sm"
          class="w-44"
          @change="selectEqPreset"
        />
        <button
          class="rounded border border-border px-2 py-1 text-xs transition-colors hover:border-primary hover:text-primary"
          type="button"
          @click="openSavePresetDialog"
        >
          {{ t('ap.saveEqPreset') }}
        </button>
        <button
          v-if="eqPresets.customPresets.some((preset) => preset.id === selectedEqPreset)"
          class="rounded border border-danger/60 px-2 py-1 text-xs text-danger transition-opacity hover:opacity-80"
          type="button"
          @click="deleteSelectedEqPreset"
        >
          {{ t('ap.deleteEqPreset') }}
        </button>
      </div>

      <div class="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
        <div
          v-for="(band, index) in player.eqBands"
          :key="band.frequencyHz"
          class="flex w-10 shrink-0 flex-col items-center gap-1 text-[10px]"
        >
          <input
            :value="band.gainDb.toFixed(1)"
            class="input-base h-5 w-full min-w-0 px-0.5 text-center text-[9px] tracking-tighter tabular-nums"
            type="text"
            inputmode="decimal"
            pattern="-?[0-9]*[.,]?[0-9]*"
            :aria-label="t('ap.eqGain')"
            @change="previewEqGain(index, $event)"
          />

          <!-- slider -->
          <div class="h-32 flex items-center justify-center">
            <input
              class="w-28 h-3 rotate-[-90deg] accent-primary cursor-pointer"
              type="range"
              min="-12"
              max="12"
              step="0.1"
              :value="band.gainDb"
              @input="previewEqGain(index, $event)"
            />
          </div>

          <!-- frequency -->
          <label class="flex items-center gap-1 whitespace-nowrap text-text-l">
            <input
              class="w-3 h-3 accent-primary cursor-pointer"
              type="checkbox"
              :checked="band.enabled"
              @change="setEqBandEnabled(index, $event)"
            />
            <span>
              {{ formatFrequency(band.frequencyHz) }}
            </span>
          </label>
        </div>
      </div>
    </section>
    <!-- DSP -->
    <section class="mt-5 rounded-xl border border-border p-3">
      <div class="mb-3 text-xs font-medium text-text">{{ t('ap.dspNode') }}</div>
      <div class="space-y-6">
        <div
          v-for="(node, index) in player.dspNodes"
          :key="node.id"
          class="rounded-lg border border-border bg-bg px-2 py-1"
          @dragover.prevent
          @drop.prevent="dropDspNode(index)"
        >
          <div class="flex items-center gap-3">
            <span
              draggable="true"
              class="cursor-grab text-text-l active:cursor-grabbing"
              :title="t('ap.dragSort')"
              @dragstart="startDragNode(index)"
              @dragend="endDragNode"
              >⠿</span
            >
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-text">{{ nodeLabel(node.id) }}</p>
              <p class="truncate text-[11px] text-text-l">
                {{ isLegacyDspNode(node.id) ? node.id : t('ap.nodeSettingsElsewhere') }}
              </p>
            </div>
            <BaseSwitch
              v-if="isLegacyDspNode(node.id)"
              :model-value="node.enabled"
              size="sm"
              @change="(enabled) => setDspNodeEnabled(index, enabled)"
            />
            <span v-else class="text-[11px] text-text-l">
              {{ isNodeActive(node.id) ? t('ap.nodeActive') : t('ap.nodeBypassed') }}
            </span>
            <button
              v-if="isLegacyDspNode(node.id)"
              class="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-l transition-colors hover:border-primary hover:text-primary"
              type="button"
              :title="t('ap.resetDspNode')"
              @click="resetDspNode(node.id)"
            >
              {{ t('ap.reset') }}
            </button>
          </div>
          <div
            v-if="isLegacyDspNode(node.id) && node.enabled"
            class="my-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2"
          >
            <template v-if="node.id === 'compressor'">
              <DspParameterField
                v-model="player.compressorConfig.thresholdDb"
                :label="t('ap.threshold')"
                :description="t('ap.dspHelp.compressorThreshold')"
                :min="-60"
                :max="0"
                :step="0.1"
                :decimals="1"
                unit="dB"
                @change="updateCompressor"
              />
              <DspParameterField
                v-model="player.compressorConfig.ratio"
                :label="t('ap.ratio')"
                :description="t('ap.dspHelp.compressorRatio')"
                :min="1"
                :max="20"
                :step="0.1"
                :decimals="1"
                unit=":1"
                @change="updateCompressor"
              />
              <DspParameterField
                v-model="player.compressorConfig.attackMs"
                :label="t('ap.attack')"
                :description="t('ap.dspHelp.compressorAttack')"
                :min="0.1"
                :max="500"
                :step="0.1"
                :decimals="1"
                unit="ms"
                @change="updateCompressor"
              />
              <DspParameterField
                v-model="player.compressorConfig.releaseMs"
                :label="t('ap.release')"
                :description="t('ap.dspHelp.compressorRelease')"
                :min="5"
                :max="2000"
                unit="ms"
                @change="updateCompressor"
              />
              <DspParameterField
                v-model="player.compressorConfig.makeupDb"
                :label="t('ap.makeupGain')"
                :description="t('ap.dspHelp.compressorMakeup')"
                :min="-12"
                :max="24"
                :step="0.1"
                :decimals="1"
                unit="dB"
                @change="updateCompressor"
              />
            </template>
            <template v-else-if="node.id === 'delay'">
              <DspParameterField
                v-model="player.delayConfig.delayMs"
                :label="t('ap.time')"
                :description="t('ap.dspHelp.delayTime')"
                :min="1"
                :max="2000"
                unit="ms"
                @change="updateDelay"
              />
              <DspParameterField
                v-model="player.delayConfig.feedback"
                :label="t('ap.feedback')"
                :description="t('ap.dspHelp.delayFeedback')"
                :min="0"
                :max="0.95"
                :step="0.01"
                :decimals="2"
                @change="updateDelay"
              />
              <DspParameterField
                v-model="player.delayConfig.mix"
                :label="t('ap.mix')"
                :description="t('ap.dspHelp.wetDryMix')"
                :min="0"
                :max="1"
                :step="0.01"
                :decimals="2"
                @change="updateDelay"
              />
            </template>
            <template v-else-if="node.id === 'reverb'">
              <DspParameterField
                v-model="player.reverbConfig.roomSize"
                :label="t('ap.roomSize')"
                :description="t('ap.dspHelp.reverbRoomSize')"
                :min="0"
                :max="1"
                :step="0.05"
                :decimals="2"
                @change="updateReverb"
              />
              <DspParameterField
                v-model="player.reverbConfig.decay"
                :label="t('ap.decay')"
                :description="t('ap.dspHelp.reverbDecay')"
                :min="0"
                :max="1"
                :step="0.05"
                :decimals="2"
                @change="updateReverb"
              />
              <DspParameterField
                v-model="player.reverbConfig.mix"
                :label="t('ap.mix')"
                :description="t('ap.dspHelp.wetDryMix')"
                :min="0"
                :max="1"
                :step="0.05"
                :decimals="2"
                @change="updateReverb"
              />
            </template>
            <template v-else-if="node.id === 'chorus'">
              <DspParameterField
                v-model="player.chorusConfig.rateHz"
                :label="t('ap.rate')"
                :description="t('ap.dspHelp.chorusRate')"
                :min="0.05"
                :max="10"
                :step="0.05"
                :decimals="2"
                unit="Hz"
                @change="updateChorus"
              />
              <DspParameterField
                v-model="player.chorusConfig.depthMs"
                :label="t('ap.depth')"
                :description="t('ap.dspHelp.chorusDepth')"
                :min="0.1"
                :max="15"
                :step="0.1"
                :decimals="1"
                unit="ms"
                @change="updateChorus"
              />
              <DspParameterField
                v-model="player.chorusConfig.mix"
                :label="t('ap.mix')"
                :description="t('ap.dspHelp.wetDryMix')"
                :min="0"
                :max="1"
                :step="0.01"
                :decimals="2"
                @change="updateChorus"
              />
            </template>
            <template v-else-if="node.id === 'noise_gate'">
              <DspParameterField
                v-model="player.noiseGateConfig.thresholdDb"
                :label="t('ap.threshold')"
                :description="t('ap.dspHelp.gateThreshold')"
                :min="-80"
                :max="0"
                :step="0.1"
                :decimals="1"
                unit="dB"
                @change="updateNoiseGate"
              />
              <DspParameterField
                v-model="player.noiseGateConfig.attackMs"
                :label="t('ap.attack')"
                :description="t('ap.dspHelp.gateAttack')"
                :min="0.1"
                :max="200"
                :step="0.1"
                :decimals="1"
                unit="ms"
                @change="updateNoiseGate"
              />
              <DspParameterField
                v-model="player.noiseGateConfig.holdMs"
                :label="t('ap.hold')"
                :description="t('ap.dspHelp.gateHold')"
                :min="0"
                :max="2000"
                unit="ms"
                @change="updateNoiseGate"
              />
              <DspParameterField
                v-model="player.noiseGateConfig.releaseMs"
                :label="t('ap.release')"
                :description="t('ap.dspHelp.gateRelease')"
                :min="5"
                :max="2000"
                unit="ms"
                @change="updateNoiseGate"
              />
              <DspParameterField
                v-model="player.noiseGateConfig.rangeDb"
                :label="t('ap.attenuationRange')"
                :description="t('ap.dspHelp.gateRange')"
                :min="-100"
                :max="0"
                :step="0.1"
                :decimals="1"
                unit="dB"
                @change="updateNoiseGate"
              />
            </template>
            <template v-else-if="node.id === 'phaser'">
              <DspParameterField
                v-model="player.phaserConfig.rateHz"
                :label="t('ap.rate')"
                :description="t('ap.dspHelp.phaserRate')"
                :min="0.05"
                :max="10"
                :step="0.05"
                :decimals="2"
                unit="Hz"
                @change="updatePhaser"
              />
              <DspParameterField
                v-model="player.phaserConfig.depth"
                :label="t('ap.depth')"
                :description="t('ap.dspHelp.phaserDepth')"
                :min="0"
                :max="1"
                :step="0.05"
                :decimals="2"
                @change="updatePhaser"
              />
              <DspParameterField
                v-model="player.phaserConfig.centerHz"
                :label="t('ap.centerFrequency')"
                :description="t('ap.dspHelp.phaserCenter')"
                :min="100"
                :max="5000"
                unit="Hz"
                @change="updatePhaser"
              />
              <DspParameterField
                v-model="player.phaserConfig.feedback"
                :label="t('ap.feedback')"
                :description="t('ap.dspHelp.phaserFeedback')"
                :min="-0.95"
                :max="0.95"
                :step="0.05"
                :decimals="2"
                @change="updatePhaser"
              />
              <DspParameterField
                v-model="player.phaserConfig.mix"
                :label="t('ap.mix')"
                :description="t('ap.dspHelp.wetDryMix')"
                :min="0"
                :max="1"
                :step="0.05"
                :decimals="2"
                @change="updatePhaser"
              />
            </template>
          </div>
        </div>
        <div class="rounded-lg border border-border bg-bg px-2 py-1">
          <div class="flex items-center gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-text">{{ t('ap.limiter') }}</p>
              <p class="truncate text-[11px] text-text-l">{{ t('ap.limiterDescription') }}</p>
            </div>
            <BaseSwitch
              :model-value="player.limiterConfig.enabled"
              size="sm"
              @change="(enabled) => setLimiterEnabled(enabled)"
            />
            <button
              class="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-l transition-colors hover:border-primary hover:text-primary"
              type="button"
              :title="t('ap.resetLimiter')"
              @click="resetLimiter"
            >
              {{ t('ap.reset') }}
            </button>
          </div>
          <div
            v-if="player.limiterConfig.enabled"
            class="my-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2"
          >
            <DspParameterField
              v-model="player.limiterConfig.ceilingDb"
              :label="t('ap.ceiling')"
              :description="t('ap.dspHelp.limiterCeiling')"
              :min="-12"
              :max="0"
              :step="0.1"
              :decimals="1"
              unit="dB"
              @change="updateLimiter"
            />
            <DspParameterField
              v-model="player.limiterConfig.releaseMs"
              :label="t('ap.release')"
              :description="t('ap.dspHelp.limiterRelease')"
              :min="5"
              :max="2000"
              unit="ms"
              @change="updateLimiter"
            />
          </div>
          <p class="mt-2 text-[11px] text-text-l">{{ t('ap.outputClipGuardDesc') }}</p>
          <div class="mt-2 rounded border border-border px-2 py-1.5 text-[11px]">
            <div class="flex items-center justify-between gap-2">
              <span class="font-medium text-text">{{ t('ap.outputClipGuard') }}</span>
              <span
                :class="
                  clipGuardRecentlyActive &&
                  player.state === 'playing' &&
                  player.audioChain?.activeNodes.includes('Output clip guard')
                    ? 'text-amber-500'
                    : 'text-text-l'
                "
                >{{ clipGuardStatus }}</span
              >
            </div>
            <p class="mt-1 text-text-l">
              {{ t('ap.clipGuardRecentReduction') }}:
              {{
                player.audioAnalysis.clipGuardLimitedFrames > 0
                  ? `-${player.audioAnalysis.clipGuardReductionDb.toFixed(1)} dB`
                  : '—'
              }}
              <span class="mx-1 text-border">·</span>
              {{ t('ap.clipGuardLimitedFrames') }}:
              {{ player.audioAnalysis.clipGuardLimitedFrames.toLocaleString() }}
            </p>
          </div>
        </div>
      </div>
    </section>

    <BaseDialog
      v-model="resetSettingsDialogOpen"
      :title="t('ap.resetAudioSettings')"
      width="max-w-sm"
    >
      <p class="text-sm text-text">{{ t('ap.resetAudioSettingsConfirm') }}</p>
      <template #footer>
        <button class="btn-hover px-3 py-1.5 text-sm" @click="resetSettingsDialogOpen = false">
          {{ t('common.cancel') }}
        </button>
        <button
          class="btn-hover-base rounded-lg bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-50"
          :disabled="resettingSettings"
          @click="resetAudioProcessingSettings"
        >
          {{ t('ap.resetAudioSettings') }}
        </button>
      </template>
    </BaseDialog>
    <BaseDialog
      v-model="savePresetDialogOpen"
      :title="editingPresetId ? t('ap.updateEqPreset') : t('ap.saveEqPreset')"
      width="max-w-sm"
    >
      <label class="block text-sm">
        {{ t('ap.eqPresetName') }}
        <input
          v-model="presetName"
          autofocus
          maxlength="40"
          class="input-base mt-2 h-9 w-full"
          :placeholder="t('ap.eqPresetNamePlaceholder')"
          @keyup.enter="saveCustomPreset"
        />
      </label>
      <template #footer>
        <button class="btn-hover px-3 py-1.5 text-sm" @click="savePresetDialogOpen = false">
          {{ t('common.cancel') }}
        </button>
        <button
          class="btn-hover-base rounded-lg bg-primary px-3 py-1.5 text-sm text-white"
          @click="saveCustomPreset"
        >
          {{ editingPresetId ? t('ap.updateEqPreset') : t('ap.saveEqPreset') }}
        </button>
      </template>
    </BaseDialog>
  </div>
</template>
