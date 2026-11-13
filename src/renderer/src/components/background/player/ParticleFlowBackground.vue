<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { ParticleFlowRenderer } from './particleFlowRenderer'

const props = defineProps<{
  active: boolean
  reducedMotion: boolean
  energy: number
  bass: number
  beat: number
  beatSequence: number
}>()
const emit = defineEmits<{ unavailable: [] }>()
const canvas = ref<HTMLCanvasElement>()
let renderer: ParticleFlowRenderer | undefined
let observer: ResizeObserver | undefined

function syncActivity(): void {
  renderer?.setActive(props.active && !props.reducedMotion && !document.hidden)
}
function syncAudio(): void {
  renderer?.setAudio(props.energy, props.bass, props.beat, props.beatSequence)
}
function lost(event: Event): void {
  event.preventDefault()
  renderer?.dispose()
  renderer = undefined
  emit('unavailable')
}
onMounted(() => {
  if (!canvas.value) return
  try {
    renderer = new ParticleFlowRenderer(canvas.value)
    syncAudio()
    syncActivity()
    observer = new ResizeObserver(() => renderer?.resize())
    observer.observe(canvas.value)
    canvas.value.addEventListener('webglcontextlost', lost)
    document.addEventListener('visibilitychange', syncActivity)
  } catch (reason) {
    renderer?.dispose()
    renderer = undefined
    console.warn('[ParticleFlowBackground] Unable to initialize', reason)
    emit('unavailable')
  }
})
watch(() => [props.active, props.reducedMotion], syncActivity)
watch(() => [props.energy, props.bass, props.beat, props.beatSequence], syncAudio)
onBeforeUnmount(() => {
  observer?.disconnect()
  document.removeEventListener('visibilitychange', syncActivity)
  canvas.value?.removeEventListener('webglcontextlost', lost)
  renderer?.dispose()
  renderer = undefined
})
</script>

<template>
  <div class="particle-flow-background absolute inset-0" aria-hidden="true">
    <canvas ref="canvas" class="absolute inset-0 size-full" />
    <div class="particle-flow-scrim absolute inset-0" />
  </div>
</template>

<style scoped>
.particle-flow-background {
  pointer-events: none;
  overflow: hidden;
  background: #06080c;
}
.particle-flow-scrim {
  background:
    linear-gradient(90deg, transparent 20%, rgb(6 8 12 / 32%) 65%, rgb(6 8 12 / 52%)),
    linear-gradient(0deg, rgb(6 8 12 / 60%), transparent 25%, transparent 80%, rgb(6 8 12 / 35%));
}
</style>
