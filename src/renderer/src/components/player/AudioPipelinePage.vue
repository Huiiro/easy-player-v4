<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AudioChainDiagnostics from '@/components/player/AudioChainDiagnostics.vue'
import AudioSettingsPageHeader from '@/components/player/AudioSettingsPageHeader.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import { nodeLabels } from '@/components/player/dspEffectFields'

const { active = true } = defineProps<{ active?: boolean }>()
const loudness = defineModel<boolean>('loudness', { required: true })
const player = usePlayerStore()
const { t } = useI18n()
const refreshing = ref(false)
const refreshFailed = ref(false)
const lastManualRefresh = ref<Date | null>(null)
const scrollBody = ref<HTMLElement | null>(null)

defineExpose({
  scrollToTop: () => {
    if (scrollBody.value) scrollBody.value.scrollTop = 0
  }
})

const dopActive = computed(
  () =>
    player.audioChain?.outputTransport === 'dop' ||
    player.audioChain?.activeNodes.includes('DoP encoded transport') === true
)

async function refreshStatus(manual = false): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  if (manual) refreshFailed.value = false
  try {
    const [chain, analysis] = await Promise.allSettled([
      player.refreshAudioChain(),
      player.refreshAudioAnalysis()
    ])
    if (manual) {
      refreshFailed.value = [chain, analysis].some(
        (result) => result.status === 'rejected' || !result.value
      )
      if (!refreshFailed.value) lastManualRefresh.value = new Date()
    }
  } finally {
    refreshing.value = false
  }
}

watch(
  () => active,
  (shown) => player.setAudioPipelineAnalysisActive(shown),
  { immediate: true }
)
watch(
  () => active && loudness.value && !dopActive.value,
  (enabled) => player.setLoudnessAnalysisEnabled(enabled, 'pipeline'),
  { immediate: true }
)
watch(
  () => [active, player.state, player.currentFile, player.trackInfo],
  () => {
    if (active) void refreshStatus()
  },
  { immediate: true }
)
onBeforeUnmount(() => {
  player.setAudioPipelineAnalysisActive(false)
  player.setLoudnessAnalysisEnabled(false, 'pipeline')
})

function backendLabel(backend: string): string {
  if (backend === 'wasapi_shared') return t('ap.wasapiShared')
  if (backend === 'wasapi_exclusive') return t('ap.wasapiExclusive')
  if (backend === 'asio') return 'ASIO'
  if (backend === 'directsound')
    return window.electron.process.platform === 'darwin' ? 'CoreAudio' : 'DirectSound'
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
  if (node === 'libsamplerate SRC (stateful)') {
    if (player.currentBackend === 'wasapi_shared') return t('ap.resamplerAutomaticShared')
    const { forceOutputRate, targetSampleRate } = player.resamplerConfig
    if (!forceOutputRate || targetSampleRate !== player.audioChain?.backendFormat.sampleRate) {
      return t('ap.resamplerAutomatic')
    }
    return t('ap.resampler')
  }
  if (node === 'Resampler') return t('ap.resampler')
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
  if (node === 'DSD to PCM conversion') return t('ap.dsdPcmOutput')
  if (node === 'Output clip guard') return t('ap.outputClipGuard')
  return match ? t(`ap.${match[1]}`) : node
}

const signalNodes = computed(() => [
  { label: t('ap.signalSource'), icon: 'common-broadcast' },
  ...(player.audioChain?.activeNodes.map((node) => ({
    label: pipelineLabel(node),
    icon: 'common-node'
  })) ?? []),
  { label: t('ap.signalOutput'), icon: 'common-sound' }
])
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col rounded-xl">
    <AudioSettingsPageHeader :title="t('ap.audioPipeline')">
      <div class="ml-auto flex flex-wrap items-center justify-end gap-2 text-xs">
        <span class="rounded-full border border-border px-3 py-1.5">
          {{ backendLabel(player.currentBackend) }}
        </span>
        <span class="rounded-full border border-border px-3 py-1.5">{{ bitPerfectLabel }}</span>
        <BaseButton
          size="sm"
          variant="secondary"
          :loading="refreshing"
          @click="refreshStatus(true)"
        >
          <template #left><SvgIcon name="common-refresh" class-name="size-3" /></template>
          {{ t('ap.refreshPipelineStatus') }}
        </BaseButton>
      </div>
    </AudioSettingsPageHeader>

    <div
      v-if="player.audioChain"
      ref="scrollBody"
      class="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 pb-4 [scrollbar-gutter:stable] sm:px-5 sm:pb-5"
    >
      <section class="space-y-3 rounded-lg border border-border bg-bg-l/30 p-4">
        <h4 id="audio-signal-path" class="flex items-center gap-2 text-sm font-semibold">
          <SvgIcon name="common-signal" class-name="size-4 shrink-0 text-text-l" />
          <span>{{ t('ap.signalPath') }}</span>
        </h4>
        <ol aria-labelledby="audio-signal-path" class="flex flex-wrap items-center gap-2 text-sm">
          <li
            v-for="({ label, icon }, index) in signalNodes"
            :key="index"
            class="flex min-w-0 items-center gap-2"
          >
            <SvgIcon
              v-if="index > 0"
              name="arrow-arrow-right-light"
              class-name="size-4 shrink-0 text-text-l"
            />
            <span
              class="flex min-w-0 items-center gap-2 rounded-md border border-primary/35 bg-primary/10 px-3 py-1.5 font-semibold"
            >
              <SvgIcon :name="icon" class-name="size-4 shrink-0 text-text-l" />
              <span>{{ label }}</span>
            </span>
          </li>
        </ol>
      </section>
      <AudioChainDiagnostics v-model:loudness="loudness" />
    </div>
  </section>
</template>
