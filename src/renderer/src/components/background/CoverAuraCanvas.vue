<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{ primary: string; secondary: string; shape?: 'rounded' | 'circle' }>()
const canvasRef = ref<HTMLCanvasElement>()
let resizeObserver: ResizeObserver | undefined
let worker: Worker | undefined
let drawFrame = 0
let requestId = 0
let lastRequestKey = ''
let workerBusy = false
let pendingRequest: {
  width: number
  height: number
  scale: number
  primary: string
  secondary: string
  shape: 'rounded' | 'circle'
} | null = null

function postDraw(request: NonNullable<typeof pendingRequest>): void {
  if (!worker) return
  workerBusy = true
  worker.postMessage({ id: ++requestId, ...request })
}

function requestDraw(): void {
  drawFrame = 0
  const canvas = canvasRef.value
  if (!canvas || !worker) return
  const bounds = canvas.getBoundingClientRect()
  if (!bounds.width || !bounds.height) return
  const scale = 0.75
  const width = Math.max(1, Math.round(bounds.width * scale))
  const height = Math.max(1, Math.round(bounds.height * scale))
  const shape = props.shape ?? 'rounded'
  const key = `${width}:${height}:${props.primary}:${props.secondary}:${shape}`
  if (key === lastRequestKey) return
  lastRequestKey = key
  const request = {
    width,
    height,
    scale,
    primary: props.primary,
    secondary: props.secondary,
    shape
  }
  if (workerBusy) pendingRequest = request
  else postDraw(request)
}

function scheduleDraw(): void {
  if (!drawFrame) drawFrame = requestAnimationFrame(requestDraw)
}

watch(() => [props.primary, props.secondary, props.shape], scheduleDraw)
onMounted(() => {
  if (!canvasRef.value) return
  worker = new Worker(new URL('./coverAura.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (
    event: MessageEvent<{
      id: number
      width: number
      height: number
      buffer: ArrayBuffer
    }>
  ) => {
    workerBusy = false
    if (pendingRequest) {
      const next = pendingRequest
      pendingRequest = null
      postDraw(next)
      return
    }
    if (event.data.id !== requestId) return
    const canvas = canvasRef.value
    if (!canvas) return
    canvas.width = event.data.width
    canvas.height = event.data.height
    canvas
      .getContext('2d')
      ?.putImageData(
        new ImageData(
          new Uint8ClampedArray(event.data.buffer),
          event.data.width,
          event.data.height
        ),
        0,
        0
      )
  }
  resizeObserver = new ResizeObserver(scheduleDraw)
  resizeObserver.observe(canvasRef.value)
  scheduleDraw()
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (drawFrame) cancelAnimationFrame(drawFrame)
  worker?.terminate()
})
</script>

<template>
  <canvas ref="canvasRef" class="cover-aura-canvas" aria-hidden="true" />
</template>

<style scoped>
.cover-aura-canvas {
  position: absolute;
  inset: -6rem;
  width: calc(100% + 12rem);
  height: calc(100% + 12rem);
  pointer-events: none;
}
</style>
