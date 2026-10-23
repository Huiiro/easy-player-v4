<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import DspKnobField from '@/components/player/DspKnobField.vue'
import EqResponseGraph from '@/components/player/EqResponseGraph.vue'
import ChannelMatrixEditor from './ChannelMatrixEditor.vue'
import ReplayGainEditor from './ReplayGainEditor.vue'
import PreampEditor from './PreampEditor.vue'
import StereoFieldEditor from './StereoFieldEditor.vue'
import CrossfeedEditor from './CrossfeedEditor.vue'
import AudioOutputSettings from './AudioOutputSettings.vue'
import PlaybackSpeedSettings from './PlaybackSpeedSettings.vue'
import ResamplerSettings from './ResamplerSettings.vue'
import PlaybackTransitionSettings from './PlaybackTransitionSettings.vue'
import ImpulseResponseEditor from './ImpulseResponseEditor.vue'
import DspEffectEditor from './DspEffectEditor.vue'
import { useEqEditor } from './useEqEditor'
import { useMessage } from '@/components/ui/useMessage'
import { BUILT_IN_EQ_PRESETS, useEqPresetStore } from '@/stores/player/eqPresetStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import type { LegacyId } from './dspEffectFields'
import type { DspNodeConfig } from '@/types/audio'

type NodeId = DspNodeConfig['id']
type ExtraId = 'output' | 'playback' | 'resampler' | 'transition'
type Selection = NodeId | ExtraId
const player = usePlayerStore()
const eqPresets = useEqPresetStore()
const { t, te } = useI18n()
const { success, warning } = useMessage()
const selected = ref<Selection>('output')
const {
  selectedEqIndex,
  eqHistory,
  eqFuture,
  eqComparison,
  previousSelectedEqBand,
  selectedEqPreset,
  selectedEqBand,
  selectedEqFrequencyLimits,
  beginEqEdit,
  recordEqEdit,
  commitEq,
  stopEqComparison,
  undoEq,
  redoEq,
  undoSelectedEqBand,
  toggleEqComparison,
  selectEqPreset,
  updateEqBand,
  resetEq,
  toggleEqBand,
  cancelPendingCommit,
  clearHistory
} = useEqEditor(player, eqPresets, selected)

const rightScrollRef = ref<HTMLElement | null>(null)
const detailSectionRef = ref<HTMLElement | null>(null)
const pipelineExpanded = ref(true)
const draggingId = ref<NodeId | null>(null)
const impulseEditor = ref<InstanceType<typeof ImpulseResponseEditor> | null>(null)
const irError = ref('')
const resetDialogOpen = ref(false)
const resetting = ref(false)
const savePresetDialogOpen = ref(false)
const presetName = ref('')
const editingPresetId = ref<string | undefined>()
const clipGuardRecentlyActive = ref(false)
let clipGuardTimer: ReturnType<typeof setTimeout> | undefined
const nodeLabels: Record<NodeId, string> = {
  channel_matrix: 'channelMatrix',
  replay_gain: 'replayGain',
  preamp: 'preamp',
  eq: 'eq',
  compressor: 'compressor',
  delay: 'delay',
  reverb: 'reverb',
  chorus: 'chorus',
  noise_gate: 'noiseGate',
  phaser: 'phaser',
  stereo_field: 'stereoField',
  crossfeed: 'crossfeed',
  impulse_response: 'irCorrection',
  limiter: 'limiter'
}
const extras: { id: ExtraId; label: string }[] = [
  { id: 'output', label: 'outputSettings' },
  { id: 'playback', label: 'playSpeed' },
  { id: 'resampler', label: 'resampler' },
  { id: 'transition', label: 'gapless' }
]
const legacyIds: LegacyId[] = ['compressor', 'delay', 'reverb', 'chorus', 'noise_gate', 'phaser']
const lastReplayGainMode = ref<'track' | 'album'>('track')
watch(
  () => player.replayGainConfig.mode,
  (mode) => {
    if (mode !== 'off') lastReplayGainMode.value = mode
  },
  { immediate: true }
)

function isNodeId(id: Selection): id is NodeId {
  return id in nodeLabels
}
function isLegacyId(id: Selection): id is LegacyId {
  return legacyIds.includes(id as LegacyId)
}
function label(id: Selection): string {
  return t(`ap.${isNodeId(id) ? nodeLabels[id] : extras.find((item) => item.id === id)?.label}`)
}
function selectSection(id: Selection): void {
  selected.value = id
  void nextTick(() => {
    const scroller = rightScrollRef.value
    const detail = detailSectionRef.value
    if (!scroller || !detail) return
    scroller.scrollTop += detail.getBoundingClientRect().top - scroller.getBoundingClientRect().top
  })
}
function isEnabled(id: NodeId): boolean {
  switch (id) {
    case 'channel_matrix':
      return player.channelMatrixConfig.enabled
    case 'replay_gain':
      return player.replayGainConfig.mode !== 'off'
    case 'preamp':
      return player.preampEnabled
    case 'eq':
      return player.eqBands.some((band) => band.enabled && Math.abs(band.gainDb) > 0.0001)
    case 'stereo_field':
      return player.stereoFieldConfig.enabled
    case 'crossfeed':
      return player.crossfeedConfig.enabled
    case 'impulse_response':
      return player.impulseResponseConfig.enabled
    case 'limiter':
      return player.limiterConfig.enabled
    default:
      return player.dspNodes.find((node) => node.id === id)?.enabled ?? false
  }
}
async function setNodeEnabled(id: NodeId, value: boolean | string | number): Promise<void> {
  const enabled = value === true
  let ok = true
  if (isLegacyId(id)) {
    const node = player.dspNodes.find((item) => item.id === id)
    if (!node) return
    node.enabled = enabled
    ok = await player.commitDspNodes()
    if (!ok) await player.loadDspNodes()
  } else if (id === 'channel_matrix') {
    player.channelMatrixConfig.enabled = enabled
    ok = await player.setChannelMatrixConfig()
    if (!ok) await player.loadChannelMatrixConfig()
  } else if (id === 'replay_gain') {
    player.replayGainConfig.mode = enabled ? lastReplayGainMode.value : 'off'
    ok = await player.setReplayGain()
    if (!ok) await player.loadReplayGain()
  } else if (id === 'preamp') {
    await player.setPreamp(player.preampDb, enabled)
    await player.refreshAudioChain()
  } else if (id === 'eq') {
    if (enabled && !player.eqBands.some((band) => Math.abs(band.gainDb) > 0.0001)) {
      selectSection('eq')
      warning(t('ap.v2EqNeedsGain'))
      return
    }
    beginEqEdit()
    player.eqBands.forEach((band) => {
      band.enabled = enabled && Math.abs(band.gainDb) > 0.0001
    })
    recordEqEdit()
    await player.commitEqBands()
    await player.refreshAudioChain()
  } else if (id === 'stereo_field') {
    player.stereoFieldConfig.enabled = enabled
    ok = await player.setStereoFieldConfig()
    if (!ok) await player.loadStereoFieldConfig()
  } else if (id === 'crossfeed') {
    player.crossfeedConfig.enabled = enabled
    ok = await player.setCrossfeedConfig()
    if (!ok) await player.loadCrossfeedConfig()
  } else if (id === 'impulse_response') {
    if (enabled && !player.impulseResponseConfig.path) {
      selectSection(id)
      await nextTick()
      impulseEditor.value?.openFilePicker()
      return
    }
    player.impulseResponseConfig.enabled = enabled
    const result = await player.setImpulseResponseConfig()
    ok = result.success
    if (!ok) {
      await player.loadImpulseResponseConfig()
      showIrError(result.error)
    }
  } else if (id === 'limiter') {
    player.limiterConfig.enabled = enabled
    ok = await player.setLimiter()
    if (!ok) await player.loadLimiter()
  }
  if (!ok && id !== 'impulse_response') warning(t('ap.v2UpdateFailed'))
}

async function moveNode(targetIndex: number): Promise<void> {
  const sourceIndex = player.dspNodes.findIndex((node) => node.id === draggingId.value)
  draggingId.value = null
  if (sourceIndex < 0 || sourceIndex === targetIndex) return
  const before = player.dspNodes.map((node) => ({ ...node }))
  const [moved] = player.dspNodes.splice(sourceIndex, 1)
  player.dspNodes.splice(targetIndex, 0, moved)
  if (!(await player.commitDspNodes())) {
    player.dspNodes = before
    warning(t('ap.v2UpdateFailed'))
  }
}
function startDrag(id: NodeId, event: DragEvent): void {
  draggingId.value = id
  event.dataTransfer?.setData('text/plain', id)
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}

watch(
  () => player.audioAnalysis.clipGuardLimitedFrames,
  (count, previous) => {
    if (count <= previous) return
    clipGuardRecentlyActive.value = true
    if (clipGuardTimer) clearTimeout(clipGuardTimer)
    clipGuardTimer = setTimeout(() => (clipGuardRecentlyActive.value = false), 1500)
  }
)
const clipGuardStatus = computed(() => {
  if (!player.audioChain?.activeNodes.includes('Output clip guard'))
    return t('ap.clipGuardBypassed')
  if (player.state !== 'playing') return t('ap.clipGuardStandingBy')
  return clipGuardRecentlyActive.value ? t('ap.clipGuardWorking') : t('ap.clipGuardStandingBy')
})
function backendLabel(backend: string): string {
  if (backend === 'wasapi_shared') return t('ap.wasapiShared')
  if (backend === 'wasapi_exclusive') return t('ap.wasapiExclusive')
  if (backend === 'asio') return 'ASIO'
  if (backend === 'directsound') return 'DirectSound'
  return backend
}
const bitPerfectLabel = computed(() => {
  if (player.audioChain?.isBitPerfect) return t('ap.bitPerfectVerified')
  if (player.audioChain?.bitPerfectVerificationState === 'eligible_unverified')
    return t('ap.bitPerfectCandidate')
  return t('ap.bitPerfectUnavailable')
})
function pipelineLabel(node: string): string {
  if (node === 'ReplayGain') return t('ap.replayGain')
  if (node === 'libsamplerate SRC (stateful)' || node === 'Resampler') return t('ap.resampler')
  if (node === 'Channel routing') return t('ap.channelRouting')
  if (node === 'SoundTouch tempo' || node === 'Playback speed') return t('ap.playSpeed')
  const match = Object.entries(nodeLabels).find(
    ([id]) => id.replaceAll('_', ' ').toLowerCase() === node.toLowerCase()
  )
  if (node === 'Parametric EQ' || node === 'EQ') return t('ap.eq')
  if (node === 'Master volume') return t('ap.volume')
  if (node === 'Crossfade') return t('ap.crossfade')
  if (node === 'Pause fade') return t('ap.pauseFade')
  if (node === 'DoP encoded transport') return t('ap.dopTransport')
  if (node === 'Output clip guard') return t('ap.outputClipGuard')
  return match ? label(match[0] as NodeId) : node
}

const bitPerfectReasonKeys: Record<string, string> = {
  'Sample-rate conversion is active': 'sampleRateConversion',
  'Channel count conversion is active': 'channelCountConversion',
  'Playback speed is not unity': 'playbackSpeed',
  'Channel matrix controls are enabled': 'channelMatrix',
  'ReplayGain is active': 'replayGain',
  'Preamp is enabled': 'preamp',
  'Parametric EQ is enabled': 'eq',
  'Compressor is enabled': 'compressor',
  'Delay is enabled': 'delay',
  'Reverb is enabled': 'reverb',
  'Chorus is enabled': 'chorus',
  'Noise Gate is enabled': 'noiseGate',
  'Phaser is enabled': 'phaser',
  'Stereo field is enabled': 'stereoField',
  'Crossfeed is enabled': 'crossfeed',
  'Impulse response is enabled': 'impulseResponse',
  'Limiter is enabled': 'limiter',
  'Master volume gain is not unity': 'masterVolume',
  'Output backend is not active': 'outputInactive',
  'Backend is not WASAPI Exclusive or ASIO': 'backendMode',
  'Backend sample rate differs from the source': 'sampleRateMismatch',
  'Backend channel count differs from the source': 'channelCountMismatch',
  'Backend precision is lower than the source': 'precisionMismatch',
  'Current f32 output path requires retained hardware verification': 'hardwareVerification',
  'DSD source was converted to PCM': 'dsdConversion',
  'Crossfade mixes consecutive tracks': 'crossfade',
  'Pause and resume use a PCM gain envelope': 'pauseFade',
  'DoP is an encoded DSD transport, not PCM bit-perfect': 'dopTransport'
}
function bitPerfectReason(reason: string): string {
  const key = bitPerfectReasonKeys[reason]
  return key ? t(`ap.bitPerfectReasons.${key}`) : reason
}

const resetStepLabels: Record<string, string> = {
  'DSP nodes': 'dspNode',
  ReplayGain: 'replayGain',
  'playback speed': 'playSpeed',
  EQ: 'eq',
  compressor: 'compressor',
  delay: 'delay',
  reverb: 'reverb',
  chorus: 'chorus',
  'noise gate': 'noiseGate',
  phaser: 'phaser',
  'channel matrix': 'channelMatrix',
  'stereo field': 'stereoField',
  crossfeed: 'crossfeed',
  'impulse response': 'irCorrection',
  limiter: 'limiter',
  resampler: 'resampler',
  DoP: 'enableDoP',
  transition: 'transitionSettings'
}
function resetFailureReason(error?: string): string {
  if (error === 'Audio engine unavailable') return t('ap.resetEngineUnavailable')
  const failedNode = error?.match(/^Failed to apply (.+) defaults$/)?.[1]
  const key = failedNode ? resetStepLabels[failedNode] : undefined
  return key ? t(`ap.${key}`) : t('ap.resetUnknownError')
}

const eqPresetOptions = computed(() => [
  ...BUILT_IN_EQ_PRESETS.map((preset) => ({
    value: preset.id,
    label: t(`ap.eqPresets.${preset.name}`)
  })),
  ...eqPresets.customPresets.map((preset) => ({ value: preset.id, label: preset.name })),
  { value: 'modified', label: t('ap.eqPresetModified'), disabled: true }
])
function savePreset(): void {
  const name = presetName.value.trim()
  if (!name) {
    warning(t('ap.eqPresetNameRequired'))
    return
  }
  if (name.length > 40) {
    warning(t('ap.eqPresetNameTooLong'))
    return
  }
  if (
    eqPresets.customPresets.some(
      (preset) =>
        preset.id !== editingPresetId.value &&
        preset.name.toLocaleLowerCase() === name.toLocaleLowerCase()
    )
  ) {
    warning(t('ap.eqPresetNameExists'))
    return
  }
  eqPresets.savePreset(name, player.eqBands, editingPresetId.value)
  savePresetDialogOpen.value = false
  success(t(editingPresetId.value ? 'ap.eqPresetUpdated' : 'ap.eqPresetSaved', { name }))
}
function openPresetDialog(): void {
  const preset = eqPresets.customPresets.find((item) => item.id === selectedEqPreset.value)
  editingPresetId.value = preset?.id
  presetName.value = preset?.name ?? ''
  savePresetDialogOpen.value = true
}

function showIrError(code?: string): void {
  const key = `ap.irErrors.${code || 'unknown'}`
  irError.value = te(key) ? t(key) : t('ap.irLoadFailed')
  warning(irError.value)
}
async function restoreDefaults(): Promise<void> {
  if (resetting.value) return
  resetting.value = true
  stopEqComparison()
  cancelPendingCommit()
  try {
    const result = await player.resetAudioProcessingSettings()
    if (!result.success) {
      warning(t('ap.resetAudioSettingsFailed', { reason: resetFailureReason(result.error) }))
      return
    }
    irError.value = ''
    clearHistory()
    resetDialogOpen.value = false
    success(t('ap.resetAudioSettingsDone'))
  } catch (error) {
    warning(t('ap.resetAudioSettingsFailed', { reason: resetFailureReason(String(error)) }))
  } finally {
    resetting.value = false
  }
}

onMounted(() => {
  player.setLoudnessAnalysisEnabled(true)
  player.setAudioControlAnalysisActive(true)
  void Promise.allSettled([
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
})
onBeforeUnmount(() => {
  stopEqComparison()
  if (clipGuardTimer) clearTimeout(clipGuardTimer)
  player.setAudioControlAnalysisActive(false)
  player.setLoudnessAnalysisEnabled(false)
})
</script>

<template>
  <div
    class="flex min-h-0 gap-3 overflow-hidden text-text"
    style="height: min(82dvh, calc(100dvh - 8rem))"
  >
    <aside
      class="flex w-52 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-bg-l/30 sm:w-60"
    >
      <div class="px-3 py-3">
        <p class="text-xs font-semibold">{{ t('footer.audioControls') }}</p>
      </div>
      <nav
        class="min-h-0 flex-1 space-y-1 overflow-y-auto custom-scrollbar p-2"
        :aria-label="t('footer.audioControls')"
      >
        <p class="px-3 py-1.5 text-[10px] font-semibold text-text-l">
          {{ t('ap.generalSettings') }}
        </p>
        <button
          v-for="extra in extras"
          :key="extra.id"
          class="w-full rounded-lg px-3 py-2 text-left text-xs transition-colors"
          :class="
            selected === extra.id
              ? 'bg-primary/10 text-primary'
              : 'text-text-l hover:bg-bg-l hover:text-text'
          "
          type="button"
          :aria-current="selected === extra.id ? 'true' : undefined"
          @click="selectSection(extra.id)"
        >
          {{ label(extra.id) }}
        </button>
        <div class="my-3 border-t border-border" />
        <p class="px-3 py-1.5 text-[10px] font-semibold text-text-l">{{ t('ap.dspNode') }}</p>
        <div
          v-for="(node, index) in player.dspNodes"
          :key="node.id"
          class="flex cursor-pointer items-center gap-1 rounded-lg border px-1.5 py-1.5 transition-colors"
          :class="
            selected === node.id
              ? 'border-primary bg-primary/10'
              : 'border-transparent hover:bg-bg-l'
          "
          @dragover.prevent
          @drop.prevent="moveNode(index)"
          @click="selectSection(node.id)"
        >
          <span
            class="cursor-grab px-1 text-text-l active:cursor-grabbing"
            draggable="true"
            :title="t('ap.dragSort')"
            @dragstart="startDrag(node.id, $event)"
            @dragend="draggingId = null"
            @click.stop
            >⠿</span
          >
          <button
            class="min-w-0 flex-1 truncate text-left text-xs"
            type="button"
            :aria-current="selected === node.id ? 'true' : undefined"
            @click.stop="selectSection(node.id)"
          >
            <span class="mr-1 text-[10px] tabular-nums text-text-l">{{ index + 1 }}</span>
            {{ label(node.id) }}
          </button>
          <span @click.stop>
            <BaseSwitch
              :model-value="isEnabled(node.id)"
              size="sm"
              :aria-label="label(node.id)"
              @change="(value) => setNodeEnabled(node.id, value)"
            />
          </span>
        </div>
      </nav>
      <div class="p-2">
        <button
          class="flex justify-center items-center gap-1 w-full rounded-lg border border-border px-2 py-2 text-xs hover:border-primary hover:text-primary"
          type="button"
          @click="resetDialogOpen = true"
        >
          <svg-icon name="common-refresh" class-name="size-3" />
          {{ t('ap.resetAudioSettings') }}
        </button>
      </div>
    </aside>

    <div
      ref="rightScrollRef"
      class="min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto overscroll-contain [scrollbar-gutter:stable] custom-scrollbar"
    >
      <section class="rounded-xl border border-border p-3">
        <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div class="flex items-center gap-1">
            <h3 class="text-xs font-semibold">{{ t('ap.audioPipeline') }}</h3>
            <button
              type="button"
              class="inline-flex size-6 items-center justify-center rounded text-text-l hover:bg-bg-l hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
              :title="t(pipelineExpanded ? 'ap.collapsePipeline' : 'ap.expandPipeline')"
              :aria-label="t(pipelineExpanded ? 'ap.collapsePipeline' : 'ap.expandPipeline')"
              :aria-expanded="pipelineExpanded"
              aria-controls="audio-pipeline-details"
              @click="pipelineExpanded = !pipelineExpanded"
            >
              <SvgIcon
                :name="pipelineExpanded ? 'arrow-arrow-up' : 'arrow-arrow-down'"
                class-name="size-4"
              />
            </button>
          </div>
          <div class="flex flex-wrap items-center justify-end gap-2 text-[11px]">
            <span class="rounded-full border border-border px-2 py-0.5 text-text-l">
              {{ backendLabel(player.currentBackend) }}
            </span>
            <span class="rounded-full border border-border px-2 py-0.5">{{ bitPerfectLabel }}</span>
          </div>
        </div>
        <div v-show="pipelineExpanded" id="audio-pipeline-details">
          <template v-if="player.audioChain">
            <p class="mt-2 text-[11px] text-text-l">
              {{ t('ap.input') }} {{ player.audioChain.sourceFormat.sampleRate || '—' }} Hz ·
              {{ player.audioChain.sourceFormat.channels || '—' }} {{ t('ap.channels') }} →
              {{ t('ap.output') }} {{ player.audioChain.backendFormat.sampleRate || '—' }} Hz ·
              {{ player.audioChain.backendFormat.channels || '—' }} {{ t('ap.channels') }}
            </p>
            <div class="mt-3">
              <div class="mb-1 text-[11px] text-text-l">{{ t('ap.signalPath') }}</div>
              <div class="flex flex-wrap items-center gap-1.5">
                <template
                  v-for="(node, index) in player.audioChain.activeNodes"
                  :key="`active-${index}`"
                >
                  <span v-if="index" class="text-[11px] text-text-l">→</span>
                  <span class="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                    {{ pipelineLabel(node) }}
                  </span>
                </template>
                <span v-if="!player.audioChain.activeNodes.length" class="text-[11px] text-text-l">
                  {{ t('ap.noActiveNodes') }}
                </span>
              </div>
            </div>
            <div v-if="player.audioChain.bypassedNodes.length" class="mt-2">
              <div class="mb-1 text-[11px] text-text-l">{{ t('ap.bypass') }}</div>
              <div class="flex flex-wrap gap-1.5">
                <span
                  v-for="(node, index) in player.audioChain.bypassedNodes"
                  :key="`bypassed-${index}`"
                  class="rounded bg-bg-l px-1.5 py-0.5 text-[11px] text-text-l"
                  >{{ pipelineLabel(node) }}</span
                >
              </div>
            </div>
            <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] tabular-nums text-text-l">
              <span>{{ t('ap.eqPeak') }} {{ player.audioChain.eqPeakDb.toFixed(1) }} dB</span>
              <span>
                {{ t('ap.eqAutoPreamp') }}
                {{ player.audioChain.eqAutoPreampDb.toFixed(1) }} dB
              </span>
              <span>{{ t('ap.outputClipGuard') }}: {{ clipGuardStatus }}</span>
              <span v-if="player.audioAnalysis.clipGuardLimitedFrames > 0">
                {{ t('ap.clipGuardRecentReduction') }} -{{
                  player.audioAnalysis.clipGuardReductionDb.toFixed(1)
                }}
                dB
              </span>
            </div>
            <p
              v-if="player.audioChain.bitPerfectBlockers.length"
              class="mt-2 text-[11px] text-text-l"
            >
              {{ player.audioChain.bitPerfectBlockers.map(bitPerfectReason).join(' · ') }}
            </p>
          </template>
          <p v-else class="mt-2 text-xs text-text-l">{{ t('ap.bitPerfectUnavailable') }}</p>
        </div>
      </section>

      <section ref="detailSectionRef" class="rounded-xl border border-border p-4">
        <div
          class="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4"
        >
          <div>
            <h3 class="text-sm font-semibold">{{ label(selected) }}</h3>
            <p v-if="isNodeId(selected)" class="mt-1 text-[11px] text-text-l">
              {{
                t('ap.v2Position', {
                  position: player.dspNodes.findIndex((node) => node.id === selected) + 1
                })
              }}
            </p>
          </div>
          <BaseSwitch
            v-if="isNodeId(selected)"
            :model-value="isEnabled(selected)"
            :aria-label="label(selected)"
            @change="(value) => setNodeEnabled(selected as NodeId, value)"
          />
        </div>

        <DspEffectEditor v-if="isLegacyId(selected) || selected === 'limiter'" :effect="selected" />
        <ChannelMatrixEditor v-else-if="selected === 'channel_matrix'" />
        <ReplayGainEditor v-else-if="selected === 'replay_gain'" />
        <PreampEditor v-else-if="selected === 'preamp'" />
        <!-- eq -->
        <div v-else-if="selected === 'eq'" class="space-y-4 text-xs">
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-text-l">{{ t('ap.eqPreset') }}</span>
            <BaseSelect
              :model-value="selectedEqPreset"
              :options="eqPresetOptions"
              class="w-44"
              @change="selectEqPreset"
            />
            <button
              class="rounded border border-border px-2.5 py-1.5 hover:border-primary"
              @click="openPresetDialog"
            >
              {{ t('ap.saveEqPreset') }}
            </button>
            <button
              v-if="eqPresets.customPresets.some((item) => item.id === selectedEqPreset)"
              class="rounded border border-danger px-2.5 py-1.5 text-danger"
              @click="eqPresets.deletePreset(selectedEqPreset)"
            >
              {{ t('ap.deleteEqPreset') }}
            </button>
            <button
              class="rounded border border-border px-2.5 py-1.5 hover:border-primary"
              @click="resetEq"
            >
              {{ t('ap.resetEq') }}
            </button>
            <button
              class="rounded border border-border px-2.5 py-1.5 hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="eqHistory.length === 0"
              @click="undoEq"
            >
              {{ t('ap.eqUndo') }}
            </button>
            <button
              class="rounded border border-border px-2.5 py-1.5 hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
              :disabled="eqFuture.length === 0"
              @click="redoEq"
            >
              {{ t('ap.eqRedo') }}
            </button>
          </div>
          <div class="flex flex-wrap gap-4 text-text-l">
            <span>
              {{ t('ap.eqPeak') }} {{ player.audioChain?.eqPeakDb?.toFixed(1) ?? '—' }} dB
            </span>
            <span>
              {{ t('ap.eqAutoPreamp') }}
              {{ player.audioChain?.eqAutoPreampDb?.toFixed(1) ?? '—' }} dB
            </span>
          </div>
          <EqResponseGraph
            v-model:selected-index="selectedEqIndex"
            :bands="player.eqBands"
            :sample-rate="
              player.audioChain?.backendFormat.sampleRate ||
              player.audioChain?.sourceFormat.sampleRate ||
              48000
            "
            @update:band="updateEqBand"
            @toggle:band="toggleEqBand"
            @commit="commitEq"
          />
          <p class="text-[11px] text-text-l">{{ t('ap.v2EqGraphDesc') }}</p>
          <div v-if="selectedEqBand" class="rounded-lg border border-border p-3">
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span class="font-medium">
                {{ t('ap.v2SelectedBand', { number: selectedEqIndex + 1 }) }}
              </span>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  class="rounded border border-border px-2 py-1 hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
                  :disabled="!previousSelectedEqBand || !!eqComparison"
                  @click="undoSelectedEqBand"
                >
                  {{ t('ap.eqBandUndo') }}
                </button>
                <button
                  class="rounded border border-border px-2 py-1 hover:border-primary disabled:cursor-not-allowed disabled:opacity-40"
                  :class="eqComparison ? 'border-primary text-primary' : ''"
                  :disabled="!previousSelectedEqBand && !eqComparison"
                  :aria-pressed="!!eqComparison"
                  @click="toggleEqComparison"
                >
                  {{ t(eqComparison ? 'ap.eqBandCompareBack' : 'ap.eqBandCompare') }}
                </button>
                <div class="flex items-center gap-2">
                  <BaseSwitch
                    class="w-fit text-left"
                    :model-value="selectedEqBand.enabled"
                    :disabled="!!eqComparison"
                    @change="
                      (value) => {
                        updateEqBand(selectedEqIndex, { enabled: value === true })
                        commitEq()
                      }
                    "
                  >
                    {{ t('ap.eqActive') }}
                  </BaseSwitch>
                </div>
              </div>
            </div>
            <fieldset class="flex min-w-0 flex-wrap gap-3" :disabled="!!eqComparison">
              <DspKnobField
                :model-value="selectedEqBand.frequencyHz"
                :label="t('ap.v2Frequency')"
                :description="t('ap.v2FrequencyHelp')"
                :min="selectedEqFrequencyLimits.min"
                :max="selectedEqFrequencyLimits.max"
                :step="0.1"
                :decimals="1"
                :live="false"
                scale="log"
                unit="Hz"
                @update:model-value="updateEqBand(selectedEqIndex, { frequencyHz: $event })"
                @change="commitEq"
              />
              <DspKnobField
                :model-value="selectedEqBand.gainDb"
                :label="t('ap.eqGain')"
                :description="t('ap.v2GainHelp')"
                :min="-12"
                :max="12"
                :step="0.1"
                :decimals="1"
                :live="false"
                unit="dB"
                @update:model-value="updateEqBand(selectedEqIndex, { gainDb: $event })"
                @change="commitEq"
              />
              <DspKnobField
                :model-value="selectedEqBand.q"
                :label="t('ap.v2Q')"
                :description="t('ap.v2QHelp')"
                :min="0.1"
                :max="24"
                :step="0.1"
                :decimals="1"
                :live="false"
                @update:model-value="updateEqBand(selectedEqIndex, { q: $event })"
                @change="commitEq"
              />
            </fieldset>
          </div>
        </div>
        <StereoFieldEditor v-else-if="selected === 'stereo_field'" />
        <CrossfeedEditor v-else-if="selected === 'crossfeed'" />
        <ImpulseResponseEditor
          v-else-if="selected === 'impulse_response'"
          ref="impulseEditor"
          :error="irError"
          @load-error="showIrError"
          @clear-error="irError = ''"
        />
        <AudioOutputSettings v-else-if="selected === 'output'" />
        <PlaybackSpeedSettings v-else-if="selected === 'playback'" />
        <ResamplerSettings v-else-if="selected === 'resampler'" />
        <PlaybackTransitionSettings v-else-if="selected === 'transition'" />
      </section>
    </div>

    <BaseDialog v-model="resetDialogOpen" :title="t('ap.resetAudioSettings')" width="max-w-sm">
      <p class="text-sm">{{ t('ap.resetAudioSettingsConfirm') }}</p>
      <template #footer>
        <button class="btn-hover px-3 py-1.5 text-sm" @click="resetDialogOpen = false">
          {{ t('common.cancel') }}
        </button>
        <button
          class="rounded-lg bg-primary px-3 py-1.5 text-sm text-white disabled:opacity-50"
          :disabled="resetting"
          @click="restoreDefaults"
        >
          {{ t('ap.resetAudioSettings') }}
        </button>
      </template>
    </BaseDialog>
    <BaseDialog
      v-model="savePresetDialogOpen"
      :title="t(editingPresetId ? 'ap.updateEqPreset' : 'ap.saveEqPreset')"
      width="max-w-sm"
    >
      <label class="block text-sm">
        {{ t('ap.eqPresetName') }}
        <input
          v-model="presetName"
          class="input-base mt-2 h-9 w-full"
          maxlength="40"
          :placeholder="t('ap.eqPresetNamePlaceholder')"
          @keyup.enter="savePreset"
        />
      </label>
      <template #footer>
        <button class="btn-hover px-3 py-1.5 text-sm" @click="savePresetDialogOpen = false">
          {{ t('common.cancel') }}
        </button>
        <button class="rounded-lg bg-primary px-3 py-1.5 text-sm text-white" @click="savePreset">
          {{ t(editingPresetId ? 'ap.updateEqPreset' : 'ap.saveEqPreset') }}
        </button>
      </template>
    </BaseDialog>
  </div>
</template>
