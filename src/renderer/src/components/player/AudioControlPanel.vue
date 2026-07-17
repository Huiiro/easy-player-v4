<script setup lang="ts">
import { usePlayerStore } from '@/stores/player/playerStore'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseSlider from '@/components/ui/BaseSlider.vue'

const player = usePlayerStore()
let eqCommitTimer: ReturnType<typeof setTimeout> | undefined
let draggingNodeIndex: number | null = null
function resetEqBands(): void {
  // TODO
}
function commitEqBands(): void {
  if (eqCommitTimer) clearTimeout(eqCommitTimer)
  eqCommitTimer = undefined
  void player.commitEqBands()
}
function previewEqGain(index: number, event: Event): void {
  const band = player.eqBands[index]
  band.gainDb = Number((event.target as HTMLInputElement).value)
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
  return id === 'compressor'
    ? 'Compressor'
    : id === 'delay'
      ? 'Delay'
      : id === 'reverb'
        ? 'Reverb'
        : id === 'chorus'
          ? 'Chorus'
          : id === 'noise_gate'
            ? 'Noise Gate'
            : 'Phaser'
}
function updateCompressor(): void {
  void player.setCompressorConfig()
}
function updateDelay(): void {
  void player.setDelayConfig()
}
function updateReverb(): void {
  void player.setReverbConfig()
}
function updateChorus(): void {
  void player.setChorusConfig()
}
function updateNoiseGate(): void {
  void player.setNoiseGateConfig()
}
function updatePhaser(): void {
  void player.setPhaserConfig()
}
function updateLimiter(): void {
  void player.setLimiter()
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
  { label: '最佳质量', value: 'best' },
  { label: '均衡', value: 'medium' },
  { label: '快速', value: 'fast' }
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
  { label: '关闭', value: 'off' },
  { label: '单曲', value: 'track' },
  { label: '专辑', value: 'album' }
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
  if (!chain) return 'Bit-perfect unavailable'
  if (chain.isBitPerfect) return 'Bit-perfect verified'
  if (chain.bitPerfectVerificationState === 'eligible_unverified')
    return 'Bit-perfect candidate — verify hardware'
  return 'Bit-perfect unavailable'
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
    label: `${backendLabel[dev.backend]} · ${dev.name}${dev.isDefault ? ' (default) ' : ''}`,
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
const { t } = useI18n()
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
            {{ player.audioChain.sourceFormat.channels || '—' }} ch</span
          ><span>→</span
          ><span
            >{{ t('ap.output') }} {{ player.audioChain.backendFormat.sampleRate || '—' }} Hz ·
            {{ player.audioChain.backendFormat.channels || '—' }} ch</span
          >
          <span>|</span>
          <span class="mt-0.5 truncate">
            {{ player.trackInfo.format }} · {{ player.trackInfo.sampleRate }} Hz ·
            {{ player.trackInfo.bitDepth }} bit · {{ player.trackInfo.channels }} ch
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
            >{{ node }} · bypass</span
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
          {{ t('ap.playEx') }} {{ player.glitchCount }} glitches
        </p>
      </div>
    </section>
    <!-- audio device && audio settings -->
    <section class="mt-5 rounded-xl border border-border p-3">
      <div class="mb-3 text-xs font-medium text-text">
        {{ t('ap.outputSettings') }}
      </div>
      <div class="flex flex-col">
        <!-- Device -->
        <div class="flex gap-2 rounded-lg">
          <span class="text-sm whitespace-nowrap w-36">{{ t('ap.outputDevice ') }}</span>
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
        <!-- Speed -->
        <div class="flex items-center gap-3 mt-3">
          <span class="text-sm whitespace-nowrap w-36"
            >{{ t('ap.playSpeed') }} {{ player.playbackSpeedConfig.speed.toFixed(2) }}×</span
          >
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
        </div>
        <!-- Preamp -->
        <div class="flex items-center gap-3 mt-3">
          <span class="text-sm whitespace-nowrap w-36"
            >{{ t('ap.preamp') }} {{ player.preampDb.toFixed(1) }} dB</span
          >
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
        <span class="font-medium"> Parametric EQ </span>

        <div class="flex items-center gap-2 text-sm text-text-l">
          <small>
            {{ player.eqBands.filter((b) => b.enabled && Math.abs(b.gainDb) >= 0.0001).length }}
            active · ±12 dB · Q 1.0
          </small>
          <button
            class="px-2 py-0.5 rounded text-[11px] bg-primary border border-primary cursor-pointer hover:opacity-90 transition-opacity"
            @click="commitEqBands"
          >
            Apply EQ
          </button>
          <button
            class="px-2 py-0.5 rounded text-[11px] bg-bg border border-primary cursor-pointer hover:opacity-90 transition-opacity"
            @click="resetEqBands"
          >
            Reset EQ
          </button>
        </div>
      </div>

      <div class="flex gap-4 overflow-x-auto pb-1 scrollbar-thin">
        <div
          v-for="(band, index) in player.eqBands"
          :key="band.frequencyHz"
          class="flex flex-col items-center gap-1 shrink-0 w-7 text-[11px]"
        >
          <!-- gain value -->
          <span class="tabular-nums">
            {{ band.gainDb.toFixed(1) }}
          </span>

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
      <div class="mb-3 text-xs font-medium text-text">DSP Node</div>
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
              title="拖拽排序"
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
          </div>
          <div v-if="node.enabled" class="my-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
            <template v-if="node.id === 'compressor'"
              ><label
                >阈值
                <input
                  v-model.number="player.compressorConfig.thresholdDb"
                  class="input-base h-6 mt-1"
                  type="number"
                  min="-60"
                  max="0"
                  @change="updateCompressor" /></label
              ><label
                >比例
                <input
                  v-model.number="player.compressorConfig.ratio"
                  class="input-base h-6 mt-1"
                  type="number"
                  min="1"
                  max="20"
                  step=".1"
                  @change="updateCompressor" /></label
              ><label
                >启动
                <input
                  v-model.number="player.compressorConfig.attackMs"
                  class="input-base h-6 mt-1"
                  type="number"
                  @change="updateCompressor" /></label
              ><label
                >释放
                <input
                  v-model.number="player.compressorConfig.releaseMs"
                  class="input-base h-6 mt-1"
                  type="number"
                  @change="updateCompressor" /></label
            ></template>
            <template v-else-if="node.id === 'delay'"
              ><label
                >时间
                <input
                  v-model.number="player.delayConfig.delayMs"
                  class="input-base h-6 mt-1"
                  type="number"
                  @change="updateDelay" /></label
              ><label
                >反馈
                <input
                  v-model.number="player.delayConfig.feedback"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".01"
                  @change="updateDelay" /></label
              ><label
                >混合
                <input
                  v-model.number="player.delayConfig.mix"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".01"
                  @change="updateDelay" /></label
            ></template>
            <template v-else-if="node.id === 'reverb'"
              ><label
                >空间
                <input
                  v-model.number="player.reverbConfig.roomSize"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".05"
                  @change="updateReverb" /></label
              ><label
                >衰减
                <input
                  v-model.number="player.reverbConfig.decay"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".05"
                  @change="updateReverb" /></label
              ><label
                >混合
                <input
                  v-model.number="player.reverbConfig.mix"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".05"
                  @change="updateReverb" /></label
            ></template>
            <template v-else-if="node.id === 'chorus'"
              ><label
                >速率
                <input
                  v-model.number="player.chorusConfig.rateHz"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".05"
                  @change="updateChorus" /></label
              ><label
                >深度
                <input
                  v-model.number="player.chorusConfig.depthMs"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".1"
                  @change="updateChorus" /></label
              ><label
                >混合
                <input
                  v-model.number="player.chorusConfig.mix"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".01"
                  @change="updateChorus" /></label
            ></template>
            <template v-else-if="node.id === 'noise_gate'"
              ><label
                >阈值
                <input
                  v-model.number="player.noiseGateConfig.thresholdDb"
                  class="input-base h-6 mt-1"
                  type="number"
                  @change="updateNoiseGate" /></label
              ><label
                >启动
                <input
                  v-model.number="player.noiseGateConfig.attackMs"
                  class="input-base h-6 mt-1"
                  type="number"
                  @change="updateNoiseGate" /></label
              ><label
                >保持
                <input
                  v-model.number="player.noiseGateConfig.holdMs"
                  class="input-base h-6 mt-1"
                  type="number"
                  @change="updateNoiseGate" /></label
              ><label
                >释放
                <input
                  v-model.number="player.noiseGateConfig.releaseMs"
                  class="input-base h-6 mt-1"
                  type="number"
                  @change="updateNoiseGate" /></label
            ></template>
            <template v-else
              ><label
                >速率
                <input
                  v-model.number="player.phaserConfig.rateHz"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".05"
                  @change="updatePhaser" /></label
              ><label
                >深度
                <input
                  v-model.number="player.phaserConfig.depth"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".05"
                  @change="updatePhaser" /></label
              ><label
                >中心频率
                <input
                  v-model.number="player.phaserConfig.centerHz"
                  class="input-base h-6 mt-1"
                  type="number"
                  @change="updatePhaser" /></label
              ><label
                >混合
                <input
                  v-model.number="player.phaserConfig.mix"
                  class="input-base h-6 mt-1"
                  type="number"
                  step=".05"
                  @change="updatePhaser" /></label
            ></template>
          </div>
        </div>
        <div class="rounded-lg border border-border bg-bg px-2 py-1">
          <div class="flex items-center gap-3">
            <div class="min-w-0 flex-1">
              <p class="text-sm font-medium text-text">Limiter</p>
              <p class="truncate text-[11px] text-text-l">output limiter</p>
            </div>
            <BaseSwitch
              :model-value="player.limiterConfig.enabled"
              size="sm"
              @change="(enabled) => setLimiterEnabled(enabled)"
            />
          </div>
          <div
            v-if="player.limiterConfig.enabled"
            class="my-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2"
          >
            <label
              >Ceiling<input
                v-model.number="player.limiterConfig.ceilingDb"
                class="input-base h-6 mt-1"
                type="number"
                step=".1"
                @change="updateLimiter"
            /></label>
            <label
              >Release<input
                v-model.number="player.limiterConfig.releaseMs"
                class="input-base h-6 mt-1"
                type="number"
                @change="updateLimiter"
            /></label>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>
