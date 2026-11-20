<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { PlayerCheerLights } from '@/constants'
import type { StageAudioSample } from './stageMusic'
import { StageRenderer } from './stageRenderer'

const props = defineProps<{
  active: boolean
  coverSrc: string | null
  analysis: StageAudioSample
  trackId?: number
  cheerColors: readonly string[]
  cheerLights: PlayerCheerLights
  intensity: number
}>()

const canvas = ref<HTMLCanvasElement>()
const visible = ref(!document.hidden)
let renderer: StageRenderer | undefined
let observer: ResizeObserver | undefined
let displayedCover: string | null = null

function syncActivity(): void {
  visible.value = !document.hidden
  renderer?.setActive(props.active && visible.value, props.analysis.beatSequence)
  syncAudio()
}

function syncAudio(): void {
  renderer?.setAudio(props.analysis, props.intensity)
}

watch(() => props.active, syncActivity)
watch(
  () => props.trackId,
  () => renderer?.resetMusic(props.analysis.beatSequence)
)
watch(() => {
  const { rms, lowEnergy, onsetStrength, beatSequence, bpm, spectrum } = props.analysis
  return [rms, lowEnergy, onsetStrength, beatSequence, bpm, spectrum, props.intensity]
}, syncAudio)

onMounted(() => {
  if (!canvas.value) return
  const context = canvas.value.getContext('2d')
  if (!context) return
  renderer = new StageRenderer(context, props.cheerColors, props.cheerLights)
  watch([() => props.cheerColors, () => props.cheerLights], ([colors, lights]) =>
    renderer?.setCheer(colors, lights)
  )
  renderer.resize()
  watch(
    [() => props.coverSrc, visible],
    ([source, isVisible], _, onCleanup) => {
      if (!isVisible || source === displayedCover) return
      if (displayedCover) renderer?.setArtwork()
      displayedCover = null
      if (!source) return
      const image = new Image()
      image.crossOrigin = 'anonymous'
      const releaseImage = (): void => {
        image.onload = image.onerror = null
        image.removeAttribute('src')
      }
      image.onload = () => {
        if (image.naturalWidth && image.naturalHeight) {
          renderer?.setArtwork(image)
          displayedCover = source
        }
        releaseImage()
      }
      image.onerror = releaseImage
      onCleanup(releaseImage)
      image.src = source
    },
    { immediate: true }
  )
  syncActivity()
  observer = new ResizeObserver(() => renderer?.resize())
  observer.observe(canvas.value)
  document.addEventListener('visibilitychange', syncActivity)
})

onBeforeUnmount(() => {
  observer?.disconnect()
  document.removeEventListener('visibilitychange', syncActivity)
  renderer?.dispose()
  renderer = undefined
})
</script>

<template>
  <div class="stage-background absolute inset-0" aria-hidden="true">
    <canvas ref="canvas" class="absolute inset-0 size-full" />
    <div class="stage-scrim absolute inset-0" />
  </div>
</template>

<style scoped>
.stage-background {
  pointer-events: none;
  background: radial-gradient(ellipse at 50% 48%, #23323b, transparent 58%), #080c10;
}
.stage-scrim {
  background:
    linear-gradient(90deg, rgb(5 8 11 / 11%), transparent 43%, rgb(5 8 11 / 30%) 76%),
    linear-gradient(
      rgb(5 8 11 / 23%),
      transparent 27%,
      transparent 69%,
      rgb(5 8 11 / 29%) 90%,
      rgb(5 8 11 / 73%)
    );
}
</style>
