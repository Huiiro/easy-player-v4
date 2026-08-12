<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useUIStore } from '@/stores/ui/uiStore'
const props = defineProps<{ spectrum: number[]; color?: string; active?: boolean }>()
const ui = useUIStore()
const canvas = ref<HTMLCanvasElement>()
let raf = 0
let target = new Float32Array(0)
let levels = new Float32Array(0)
let bars = new Float32Array(0)
let gradient: CanvasGradient | undefined
let gradientHeight = 0
let gradientColor = ''
let context: CanvasRenderingContext2D | null = null
let resizeObserver: ResizeObserver | null = null
let width = 1
let height = 1
let pixelScale = 1
const ready = ref(false)

function scheduleRender(): void {
  if (!raf && !document.hidden && !ui.reduceMotion && props.active !== false)
    raf = requestAnimationFrame(render)
}

function updateTarget(values: number[]): void {
  if (target.length !== values.length) target = new Float32Array(values.length)
  target.set(values)
}

function render(): void {
  raf = 0
  const e = canvas.value
  if (!e) return
  if (e.width !== width || e.height !== height) {
    e.width = width
    e.height = height
    gradient = undefined
  }
  const c = context || e.getContext('2d')
  if (!c) return
  context = c
  c.clearRect(0, 0, width, height)
  if (!target.length) {
    scheduleRender()
    return
  }

  const barCount = target.length * 2
  if (bars.length !== barCount) bars = new Float32Array(barCount)
  if (levels.length !== barCount) levels = new Float32Array(barCount)
  for (let index = 0; index < target.length; index += 1) {
    const value = target[index]
    bars[index * 2] = value
    bars[index * 2 + 1] = (value + (target[index + 1] ?? value)) / 2
  }

  const color = props.color || '77 136 220'
  if (!gradient || gradientHeight !== height || gradientColor !== color) {
    gradient = c.createLinearGradient(0, height, 0, 0)
    gradient.addColorStop(0, `rgb(${color} / .32)`)
    gradient.addColorStop(1, `rgb(${color} / .98)`)
    gradientHeight = height
    gradientColor = color
  }

  const bw = width / barCount
  const barWidth = Math.max(1, bw * 0.58)
  c.fillStyle = gradient
  for (let index = 0; index < barCount; index += 1) {
    const value = bars[index]
    levels[index] += (Math.max(0, Math.min(1, value)) - levels[index]) * 0.28
    const barHeight = Math.max(2 * pixelScale, levels[index] * height)
    c.fillRect(index * bw + (bw - barWidth) / 2, height - barHeight, barWidth, barHeight)
  }
  scheduleRender()
}
watch(() => props.spectrum, updateTarget, { immediate: true })
function handleVisibilityChange(): void {
  if (document.hidden) {
    cancelAnimationFrame(raf)
    raf = 0
  } else scheduleRender()
}
onMounted(() => {
  const element = canvas.value
  if (element) {
    resizeObserver = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect
      if (!box) return
      pixelScale = Math.min(window.devicePixelRatio || 1, 1.5)
      width = Math.max(1, Math.round(box.width * pixelScale))
      height = Math.max(1, Math.round(box.height * pixelScale))
      ready.value = true
      scheduleRender()
    })
    resizeObserver.observe(element)
  }
  document.addEventListener('visibilitychange', handleVisibilityChange)
  scheduleRender()
})
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  target = new Float32Array(0)
  levels = new Float32Array(0)
  bars = new Float32Array(0)
  gradient = undefined
  context = null
  resizeObserver?.disconnect()
  resizeObserver = null
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  const element = canvas.value
  if (element) {
    element.width = 1
    element.height = 1
  }
})
watch(
  () => ui.reduceMotion,
  (reduced) => {
    cancelAnimationFrame(raf)
    raf = 0
    if (reduced) render()
    else scheduleRender()
  }
)
watch(
  () => props.active,
  (active) => {
    cancelAnimationFrame(raf)
    raf = 0
    if (active === false) render()
    else scheduleRender()
  }
)
</script>
<template>
  <canvas
    ref="canvas"
    class="block h-16 w-full transition-opacity duration-150"
    :class="ready ? 'opacity-100' : 'opacity-0'"
  />
</template>
