<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import type { AudioFormat } from '@/types/audio'

const loudness = defineModel<boolean>('loudness', { required: true })
const player = usePlayerStore()
const { t, n } = useI18n()
const chain = computed(() => player.audioChain)
const outputOpen = computed(() => !!chain.value?.backendFormat.sampleRate)
const transport = computed(() => chain.value?.outputTransport)
const dopActive = computed(
  () =>
    transport.value === 'dop' || chain.value?.activeNodes.includes('DoP encoded transport') === true
)
const outputDevice = computed(() => {
  const id = chain.value?.outputDeviceId
  if (!id) return '—'
  return (
    player.devices.find(
      (device) =>
        device.backend === player.currentBackend && device.id.toLowerCase() === id.toLowerCase()
    )?.name ?? id
  )
})
const sourceFormatLabel = computed(() => {
  const label = chain.value?.sourceLabel?.trim().toUpperCase().split('_', 1)[0] ?? ''
  return label.startsWith('DSD') ? 'DSD' : label
})
const fallbackKeys: Record<string, string> = {
  carrierRejected: 'ap.dopFallbackCarrier',
  forcedOutputRate: 'ap.dopFallbackForcedRate',
  backendUnsupported: 'ap.dopFallbackBackend',
  unsupportedSource: 'ap.dopFallbackSource',
  decoderPreparationFailed: 'ap.dopFallbackDecoder',
  primingFailed: 'ap.dopFallbackPrime'
}
const fallbackReason = computed(() => {
  const key = fallbackKeys[chain.value?.dopFallbackReason ?? '']
  return key ? t(key, { rate: formatRate(chain.value?.dopCarrierRate ?? 0) }) : ''
})
const pcmAnalysisReady = computed(
  () => outputOpen.value && !dopActive.value && player.audioAnalysis.analysisTimeMs > 0
)
const clipGuardActive = computed(
  () => chain.value?.activeNodes.includes('Output clip guard') === true
)
const clipGuardRecentlyActive = ref(false)
let clipGuardTimer: ReturnType<typeof setTimeout> | undefined
watch(
  () => player.audioAnalysis.clipGuardLimitedFrames,
  (count, previous) => {
    clearTimeout(clipGuardTimer)
    clipGuardRecentlyActive.value = count > previous
    if (clipGuardRecentlyActive.value) {
      clipGuardTimer = setTimeout(() => (clipGuardRecentlyActive.value = false), 1500)
    }
  }
)
onBeforeUnmount(() => clearTimeout(clipGuardTimer))

const clipGuardWorking = computed(
  () => clipGuardActive.value && player.state === 'playing' && clipGuardRecentlyActive.value
)
const clipGuardStatus = computed(() => {
  if (!clipGuardActive.value) {
    return { label: t('ap.clipGuardBypassed'), style: 'border-border bg-text/5 text-text-l' }
  }
  if (clipGuardWorking.value) {
    return {
      label: t('ap.clipGuardWorking'),
      style: 'border-warning/30 bg-warning/10 text-warning'
    }
  }
  return {
    label: t('ap.clipGuardStandingBy'),
    style: 'border-success/30 bg-success/10 text-success'
  }
})

function formatRate(rate: number): string {
  if (!rate) return '—'
  return rate >= 1_000_000
    ? `${n(rate / 1_000_000, { maximumFractionDigits: 4 })} MHz`
    : `${n(rate / 1000, { maximumFractionDigits: 3 })} kHz`
}

function formatDetails(format?: AudioFormat): string {
  if (!format?.sampleRate) return ''
  const { bitDepth, channels, containerBits, floatingPoint } = format
  const parts: string[] = []
  if (bitDepth > 0) {
    if (floatingPoint) parts.push(t('ap.formatFloatBits', { bits: bitDepth }))
    else if (containerBits && containerBits !== bitDepth)
      parts.push(t('ap.formatContainerBits', { bits: bitDepth, container: containerBits }))
    else parts.push(t('ap.formatBits', { bits: bitDepth }))
  }
  if (channels > 0) parts.push(`${channels} ${t('ap.channels')}`)
  return parts.join(' · ')
}

const formats = computed(() => {
  if (!chain.value) return []
  const stages = [
    {
      label: t('ap.originalAudioFormat'),
      format: chain.value.originalFormat ?? chain.value.sourceFormat,
      codec: sourceFormatLabel.value
    }
  ]
  if (chain.value.decodedPcmFormat?.sampleRate) {
    stages.push({
      label: t('ap.decodedPcmFormat'),
      format: chain.value.decodedPcmFormat,
      codec: ''
    })
  }
  stages.push({
    label: t(dopActive.value ? 'ap.dopCarrierFormat' : 'ap.deviceOutputFormat'),
    format: chain.value.backendFormat,
    codec: ''
  })
  return stages
})

const outputStats = computed(() => {
  const frames = chain.value?.outputBufferFrames ?? 0
  const latency = chain.value?.outputLatencyMs ?? 0
  const stats = [
    { label: t('ap.outputBuffer'), value: frames ? t('ap.frameCount', { count: n(frames) }) : '—' },
    { label: t('ap.outputLatency'), value: latency ? `${latency.toFixed(1)} ms` : '—' },
    { label: t('ap.outputUnderruns'), value: n(player.glitchCount ?? 0) }
  ]
  if (!dopActive.value) {
    stats.push({
      label: t('ap.analysisDroppedFrames'),
      value: n(player.audioAnalysis.droppedFrames)
    })
  }
  return stats
})

const rms = computed(() => {
  if (!pcmAnalysisReady.value) return '—'
  const level = player.audioAnalysis.rms
  return `${level > 0 ? (20 * Math.log10(level)).toFixed(1) : '−∞'} dBFS`
})

function formatLufs(value: number): string {
  return pcmAnalysisReady.value ? `${value.toFixed(1)} LUFS` : '—'
}

const meters = computed(() => [
  { label: 'RMS', value: rms.value },
  { label: t('ap.momentaryLoudness'), value: formatLufs(player.audioAnalysis.momentaryLufs) },
  { label: t('ap.shortTermLoudness'), value: formatLufs(player.audioAnalysis.shortTermLufs) },
  { label: t('ap.integratedLoudness'), value: formatLufs(player.audioAnalysis.integratedLufs) }
])
</script>

<template>
  <div v-if="chain" class="space-y-4">
    <dl class="grid gap-3" :class="formats.length === 3 ? 'md:grid-cols-3' : 'sm:grid-cols-2'">
      <div
        v-for="{ label, format, codec } in formats"
        :key="label"
        class="min-w-0 rounded-lg border border-border bg-bg-l/30 p-3"
      >
        <dt class="text-xs font-medium text-text-l">{{ label }}</dt>
        <dd class="mt-1 text-lg font-semibold tabular-nums">{{ formatRate(format.sampleRate) }}</dd>
        <dd v-if="format.sampleRate" class="text-sm text-text-l">{{ formatDetails(format) }}</dd>
        <dd v-if="codec" class="mt-0.5 text-xs break-words text-text-l">{{ codec }}</dd>
      </div>
    </dl>
    <p v-if="dopActive" class="text-sm">{{ t('ap.dopOutputActive') }}</p>
    <p v-else-if="transport === 'pcm_conversion'" class="text-sm">
      <strong class="font-semibold">
        {{ t(fallbackReason ? 'ap.dopPcmFallback' : 'ap.dsdPcmOutput') }}
      </strong>
      <span v-if="fallbackReason" class="ml-1 text-text-l">{{ fallbackReason }}</span>
    </p>
    <div v-if="outputOpen" class="space-y-3 rounded-lg border border-border bg-bg-l/30 p-4">
      <dl class="min-w-0">
        <dt class="flex items-center gap-2 text-xs font-medium text-text-l">
          <SvgIcon name="common-sound" class-name="size-4 shrink-0" />
          <span>{{ t('ap.openedOutputDevice') }}</span>
        </dt>
        <dd
          class="mt-1 text-base font-semibold [overflow-wrap:anywhere]"
          :title="chain.outputDeviceId"
        >
          {{ outputDevice }}
        </dd>
      </dl>
      <dl
        class="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3"
        :class="dopActive ? 'lg:grid-cols-3' : 'lg:grid-cols-4'"
      >
        <div v-for="{ label, value } in outputStats" :key="label">
          <dt class="text-xs text-text-l">{{ label }}</dt>
          <dd class="mt-0.5 text-base font-semibold tabular-nums">{{ value }}</dd>
        </div>
      </dl>
    </div>
    <section
      aria-labelledby="audio-loudness-analysis"
      class="space-y-3 rounded-lg border border-border bg-bg-l/30 p-4"
    >
      <header class="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h4 id="audio-loudness-analysis" class="flex items-center gap-2 text-sm font-semibold">
          <SvgIcon name="common-audio" class-name="size-4 shrink-0 text-text-l" />
          <span>{{ t('ap.loudnessAnalysis') }}</span>
        </h4>
        <BaseSwitch
          v-model="loudness"
          size="sm"
          :disabled="dopActive"
          aria-labelledby="audio-loudness-analysis"
        />
      </header>
      <p v-if="dopActive" class="text-xs text-text-l">{{ t('ap.analysisBypassedForDop') }}</p>
      <dl class="grid grid-cols-2 gap-x-4 gap-y-3 lg:grid-cols-4">
        <template v-if="loudness && !dopActive">
          <div v-for="{ label, value } in meters" :key="label">
            <dt class="text-xs text-text-l">{{ label }}</dt>
            <dd class="mt-0.5 text-base font-semibold tabular-nums">{{ value }}</dd>
          </div>
        </template>
        <div>
          <dt class="text-xs text-text-l">{{ t('ap.eqPeak') }}</dt>
          <dd class="mt-0.5 text-base font-semibold tabular-nums">
            {{ chain.eqPeakDb.toFixed(1) }} dB
          </dd>
        </div>
        <div>
          <dt class="text-xs text-text-l">{{ t('ap.eqAutoPreamp') }}</dt>
          <dd class="mt-0.5 text-base font-semibold tabular-nums">
            {{ chain.eqAutoPreampDb.toFixed(1) }} dB
          </dd>
        </div>
      </dl>
    </section>
    <section
      aria-labelledby="audio-clip-guard"
      class="space-y-2 rounded-lg border border-border bg-bg-l/30 p-4"
    >
      <header class="flex flex-wrap items-center gap-2">
        <h4 id="audio-clip-guard" class="flex items-center gap-2 text-sm font-semibold">
          <SvgIcon name="common-node" class-name="size-4 shrink-0 text-text-l" />
          <span>{{ t('ap.outputClipGuard') }}</span>
        </h4>
        <span
          class="rounded-full border px-2 py-1 text-xs font-medium"
          :class="clipGuardStatus.style"
        >
          {{ clipGuardStatus.label }}
        </span>
      </header>
      <p
        v-if="clipGuardActive && player.audioAnalysis.clipGuardLimitedFrames > 0"
        class="ml-6 text-xs text-text-l"
      >
        {{ t('ap.clipGuardRecentReduction') }}
        <b class="ml-1 text-base tabular-nums text-text">
          -{{ player.audioAnalysis.clipGuardReductionDb.toFixed(1) }} dB
        </b>
      </p>
    </section>
  </div>
</template>
