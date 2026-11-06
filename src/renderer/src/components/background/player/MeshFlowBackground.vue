<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { MeshFlowRenderer } from '@/components/background/player/meshFlowRenderer'

const props = defineProps<{
  coverSrc: string | null
  primary: string
  secondary: string
  tertiary: string
  active: boolean
  reducedMotion: boolean
  energy: number
}>()
const emit = defineEmits<{ unavailable: [] }>()
const canvas = ref<HTMLCanvasElement>()
let renderer: MeshFlowRenderer | undefined
let observer: ResizeObserver | undefined
let resizeTimer: ReturnType<typeof setTimeout> | undefined
function syncActivity(): void {
  renderer?.setActive(props.active && !props.reducedMotion && !document.hidden)
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
    renderer = new MeshFlowRenderer(canvas.value, [props.primary, props.secondary, props.tertiary])
    syncActivity()
    renderer.setEnergy(props.energy)
    renderer.setArtwork(props.coverSrc)
    observer = new ResizeObserver(() => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => renderer?.resize(), 80)
    })
    observer.observe(canvas.value)
    canvas.value.addEventListener('webglcontextlost', lost)
    document.addEventListener('visibilitychange', syncActivity)
  } catch (reason) {
    renderer?.dispose()
    renderer = undefined
    console.warn('[MeshFlowBackground] Unable to initialize', reason)
    emit('unavailable')
  }
})
watch(
  () => props.coverSrc,
  (source) => renderer?.setArtwork(source)
)
watch(
  () => [props.primary, props.secondary, props.tertiary],
  (colors) => renderer?.setPalette(colors)
)
watch(
  () => props.energy,
  (energy) => renderer?.setEnergy(energy)
)
watch(() => [props.active, props.reducedMotion], syncActivity)
onBeforeUnmount(() => {
  observer?.disconnect()
  clearTimeout(resizeTimer)
  document.removeEventListener('visibilitychange', syncActivity)
  canvas.value?.removeEventListener('webglcontextlost', lost)
  renderer?.dispose()
  renderer = undefined
})
</script>

<template>
  <canvas ref="canvas" class="mesh-flow-background absolute inset-0 size-full" aria-hidden="true" />
</template>
