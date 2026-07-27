<script setup lang="ts">
import { usePlayerStore } from '@/stores/player/playerStore'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSlider from '@/components/ui/BaseSlider.vue'

const player = usePlayerStore()
const { t } = useI18n()
let eqCommitTimer: ReturnType<typeof setTimeout> | undefined
let draggingNodeIndex: number | null = null

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
    player.loadLimiter()
  ])

  const failed = results.filter((result) => result.status === 'rejected')
  if (failed.length > 0) {
    console.warn(`[AudioControlPanel] ${failed.length} control value(s) could not be initialized`)
  }
}

onMounted(() => {
  void initializeAudioControls()
})

function resetEqBands(): void {
  for (const band of player.eqBands) {
    band.enabled = false
    band.gainDb = 0
    band.q = 1
  }
  commitEqBands()
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
function setDspNodeEnabled(index: number, enabled: boolean | string | number): void {
  player.dspNodes[index].enabled = enabled === true
  updateDspNodes()
}
function nodeLabel(id: string): string {
  switch (id) {
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
    default:
      return t('ap.phaser')
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
const backendLabel: Record<string, string> = {
  asio: 'ASIO',
  wasapi_shared: 'WASAPI Shared',
  wasapi_exclusive: 'WASAPI Exclusive',
  directsound: 'DirectSound'
}
const currentBackendLabel = computed(
  () => backendLabel[player.currentBackend] ?? player.currentBackend
)
const deviceKey = (backend: string, id: string) => `${backend}\u0000${id}`
const selectedOutputDeviceKey = computed(() =>
  deviceKey(player.currentBackend, player.currentDeviceId)
)
const deviceOptions = computed(() =>
  player.devices.map((dev) => ({
    label: `${backendLabel[dev.backend]} · ${dev.name}${dev.isDefault ? ` (${t('ap.defaultDevice')})` : ''}`,
    value: deviceKey(dev.backend, dev.id)
  }))
)
async function onDeviceChange(val: string | number): Promise<void> {
  const device = player.devices.find((item) => deviceKey(item.backend, item.id) === val)
  if (device) await player.selectOutputDevice(device)
}
function refreshOutputDevices(): void {
  void player.refreshDevices()
}
</script>

<template>
  <div class="text-text select-none overflow-y-scroll no-scrollbar">
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
            {{ player.trackInfo.format }} · {{ player.trackInfo.sampleRate }} Hz ·
            {{ player.trackInfo.bitDepth }} bit · {{ player.trackInfo.channels }}
            {{ t('ap.channels') }}
          </span>
        </div>
        <!-- node -->
        <div class="mt-2 flex flex-wrap gap-1.5 rounded-lg border border-border-l p-2">
          <span
            v-for="node in player.audioChain.activeNodes"
            :key="`active-${node}`"
            class="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary"
            >{{ node }}</span
          >
          <span
            v-for="node in player.audioChain.bypassedNodes"
            :key="`bypassed-${node}`"
            class="rounded bg-bg-l px-1.5 py-0.5 text-[11px] text-text-l"
            >{{ node }} · {{ t('ap.bypass') }}</span
          >
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
        <div class="flex items-center gap-3 mt-3">
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
        </div>
        <!-- DoP -->
        <div class="flex items-center gap-3 mt-3">
          <span class="text-sm whitespace-nowrap w-36">{{ t('ap.enableDoP') }}</span>
          <BaseSwitch
            :model-value="player.dopEnabled"
            size="sm"
            @change="(enabled) => setDopEnabled(enabled)"
          />
          <span class="text-xs text-text-l"> {{ t('ap.dopDesc') }} {{ t('ap.dopSupport') }} </span>
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
          <span v-if="player.transitionConfig.crossfadeEnabled" class="text-xs text-text-l"
            >ms</span
          >
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
            {{ t('ap.eqActive') }} · ±12 dB · Q 1.0
          </small>
          <button
            class="px-2 py-0.5 rounded text-[11px] bg-primary border border-primary cursor-pointer hover:opacity-90 transition-opacity"
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
      <div class="space-y-2">
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
              @dragstart="draggingNodeIndex = index"
              @dragend="draggingNodeIndex = null"
              >⠿</span
            >
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-text">{{ nodeLabel(node.id) }}</p>
              <p class="truncate text-[11px] text-text-l">{{ node.id }}</p>
            </div>
            <BaseSwitch
              :model-value="node.enabled"
              size="sm"
              @change="(enabled) => setDspNodeEnabled(index, enabled)"
            />
            <button
              class="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-l transition-colors hover:border-primary hover:text-primary"
              type="button"
              :title="t('ap.resetDspNode')"
              @click="resetDspNode(node.id)"
            >
              {{ t('ap.reset') }}
            </button>
          </div>
          <div v-if="node.enabled" class="my-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <template v-if="node.id === 'compressor'">
              <label>
                {{ t('ap.threshold') }}
                <input
                  v-model.number="player.compressorConfig.thresholdDb"
                  class="input-base h-6 mt-1"
                  type="number"
                  min="-60"
                  max="0"
                  @change="updateCompressor"
                />
              </label>
              <label>
                {{ t('ap.ratio') }}
                <input
                  v-model.number="player.compressorConfig.ratio"
                  class="input-base h-6 mt-1"
                  type="number"
                  min="1"
                  max="20"
                  step=".1"
                  @change="updateCompressor"
                />
              </label>
              <label>
                {{ t('ap.attack') }}
                <input
                  v-model.number="player.compressorConfig.attackMs"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".1"
                  min=".1"
                  max="500"
                  @change="updateCompressor"
                />
              </label>
              <label>
                {{ t('ap.release') }}
                <input
                  v-model.number="player.compressorConfig.releaseMs"
                  class="input-base h-6 mt-1"
                  type="number"
                  min="5"
                  max="2000"
                  @change="updateCompressor"
                />
              </label>
              <label>
                {{ t('ap.makeupGain') }}
                <input
                  v-model.number="player.compressorConfig.makeupDb"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".1"
                  min="-12"
                  max="24"
                  @change="updateCompressor"
                />
              </label>
            </template>
            <template v-else-if="node.id === 'delay'">
              <label>
                {{ t('ap.time') }}
                <input
                  v-model.number="player.delayConfig.delayMs"
                  class="input-base h-6 mt-1"
                  type="number"
                  min="1"
                  max="2000"
                  @change="updateDelay"
                />
              </label>
              <label>
                {{ t('ap.feedback') }}
                <input
                  v-model.number="player.delayConfig.feedback"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".01"
                  min="0"
                  max=".95"
                  @change="updateDelay"
                />
              </label>
              <label>
                {{ t('ap.mix') }}
                <input
                  v-model.number="player.delayConfig.mix"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".01"
                  min="0"
                  max="1"
                  @change="updateDelay"
                />
              </label>
            </template>
            <template v-else-if="node.id === 'reverb'">
              <label>
                {{ t('ap.roomSize') }}
                <input
                  v-model.number="player.reverbConfig.roomSize"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".05"
                  min="0"
                  max="1"
                  @change="updateReverb"
                />
              </label>
              <label>
                {{ t('ap.decay') }}
                <input
                  v-model.number="player.reverbConfig.decay"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".05"
                  min="0"
                  max="1"
                  @change="updateReverb"
                />
              </label>
              <label>
                {{ t('ap.mix') }}
                <input
                  v-model.number="player.reverbConfig.mix"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".05"
                  min="0"
                  max="1"
                  @change="updateReverb"
                />
              </label>
            </template>
            <template v-else-if="node.id === 'chorus'">
              <label>
                {{ t('ap.rate') }}
                <input
                  v-model.number="player.chorusConfig.rateHz"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".05"
                  min=".05"
                  max="10"
                  @change="updateChorus"
                />
              </label>
              <label>
                {{ t('ap.depth') }}
                <input
                  v-model.number="player.chorusConfig.depthMs"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".1"
                  min=".1"
                  max="15"
                  @change="updateChorus"
                />
              </label>
              <label>
                {{ t('ap.mix') }}
                <input
                  v-model.number="player.chorusConfig.mix"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".01"
                  min="0"
                  max="1"
                  @change="updateChorus"
                />
              </label>
            </template>
            <template v-else-if="node.id === 'noise_gate'">
              <label>
                {{ t('ap.threshold') }}
                <input
                  v-model.number="player.noiseGateConfig.thresholdDb"
                  class="input-base h-6 mt-1"
                  type="number"
                  min="-80"
                  max="0"
                  @change="updateNoiseGate"
                />
              </label>
              <label>
                {{ t('ap.attack') }}
                <input
                  v-model.number="player.noiseGateConfig.attackMs"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".1"
                  min=".1"
                  max="200"
                  @change="updateNoiseGate"
                />
              </label>
              <label>
                {{ t('ap.hold') }}
                <input
                  v-model.number="player.noiseGateConfig.holdMs"
                  class="input-base h-6 mt-1"
                  type="number"
                  min="0"
                  max="2000"
                  @change="updateNoiseGate"
                />
              </label>
              <label>
                {{ t('ap.release') }}
                <input
                  v-model.number="player.noiseGateConfig.releaseMs"
                  class="input-base h-6 mt-1"
                  type="number"
                  min="5"
                  max="2000"
                  @change="updateNoiseGate"
                />
              </label>
              <label>
                {{ t('ap.attenuationRange') }}
                <input
                  v-model.number="player.noiseGateConfig.rangeDb"
                  class="input-base h-6 mt-1"
                  type="number"
                  min="-100"
                  max="0"
                  @change="updateNoiseGate"
                />
              </label>
            </template>
            <template v-else>
              <label>
                {{ t('ap.rate') }}
                <input
                  v-model.number="player.phaserConfig.rateHz"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".05"
                  min=".05"
                  max="10"
                  @change="updatePhaser"
                />
              </label>
              <label>
                {{ t('ap.depth') }}
                <input
                  v-model.number="player.phaserConfig.depth"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".05"
                  min="0"
                  max="1"
                  @change="updatePhaser"
                />
              </label>
              <label>
                {{ t('ap.centerFrequency') }}
                <input
                  v-model.number="player.phaserConfig.centerHz"
                  class="input-base h-6 mt-1"
                  type="number"
                  min="100"
                  max="5000"
                  @change="updatePhaser"
                />
              </label>
              <label>
                {{ t('ap.feedback') }}
                <input
                  v-model.number="player.phaserConfig.feedback"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".05"
                  min="-.95"
                  max=".95"
                  @change="updatePhaser"
                />
              </label>
              <label>
                {{ t('ap.mix') }}
                <input
                  v-model.number="player.phaserConfig.mix"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".05"
                  min="0"
                  max="1"
                  @change="updatePhaser"
                />
              </label>
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
            <label>
              {{ t('ap.ceiling') }}
              <input
                v-model.number="player.limiterConfig.ceilingDb"
                class="input-base h-6 mt-1"
                type="number"
                step=".1"
                min="-12"
                max="0"
                @change="updateLimiter"
              />
            </label>
            <label>
              {{ t('ap.release') }}
              <input
                v-model.number="player.limiterConfig.releaseMs"
                class="input-base h-6 mt-1"
                type="number"
                min="5"
                max="2000"
                @change="updateLimiter"
              />
            </label>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
