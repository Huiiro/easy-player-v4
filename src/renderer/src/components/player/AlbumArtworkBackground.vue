<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps<{ src: string }>()
const emit = defineEmits<{ load: [image: HTMLImageElement]; error: [event: Event] }>()
const imageRef = ref<HTMLImageElement>()
const canvasRef = ref<HTMLCanvasElement>()
const painted = ref(false)
let observer: ResizeObserver | undefined
let sourceReady = false

function paint(): void {
  const image = imageRef.value
  const canvas = canvasRef.value
  if (!sourceReady || !image || !canvas) return
  const { clientWidth, clientHeight, naturalWidth, naturalHeight } = image
  if (!clientWidth || !clientHeight) return
  // Blur at a fraction of the viewport resolution, with a hard cap for large windows.
  const scale = Math.min(0.25, 512 / Math.max(clientWidth, clientHeight))
  const width = Math.max(1, Math.round(clientWidth * scale))
  const height = Math.max(1, Math.round(clientHeight * scale))
  if (painted.value && canvas.width === width && canvas.height === height) return
  const context = canvas.getContext('2d')
  if (!context || !('filter' in context)) return
  const fit = Math.max(clientWidth / naturalWidth, clientHeight / naturalHeight)
  const sourceWidth = clientWidth / fit
  const sourceHeight = clientHeight / fit
  canvas.width = width
  canvas.height = height
  context.filter = `blur(${64 * scale}px) saturate(1.68) contrast(1.28) brightness(0.52)`
  context.drawImage(
    image,
    (naturalWidth - sourceWidth) / 2,
    (naturalHeight - sourceHeight) / 2,
    sourceWidth,
    sourceHeight,
    0,
    0,
    width,
    height
  )
  painted.value = true
}

function onLoad(): void {
  const image = imageRef.value
  if (!image?.naturalWidth || sourceReady) return
  sourceReady = true
  paint()
  emit('load', image)
}

onMounted(() => {
  if (!imageRef.value) return
  observer = new ResizeObserver(paint)
  observer.observe(imageRef.value)
  onLoad()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  if (canvasRef.value) canvasRef.value.width = canvasRef.value.height = 0
})
</script>

<template>
  <div>
    <img
      ref="imageRef"
      :src="src"
      class="panel-background-item absolute inset-0 size-full object-cover"
      :class="painted && 'invisible'"
      alt=""
      crossorigin="anonymous"
      @load="onLoad"
      @error="emit('error', $event)"
    />
    <canvas
      ref="canvasRef"
      class="absolute inset-0 size-full"
      :class="!painted && 'invisible'"
      aria-hidden="true"
    />
  </div>
</template>

<style scoped>
.panel-background-item {
  filter: blur(64px) saturate(1.68) contrast(1.28) brightness(0.52);
}
</style>
