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

function scheduleRender(): void {
  if (!ui.reduceMotion && props.active !== false) raf = requestAnimationFrame(render)
}

function updateTarget(values: number[]): void {
  if (target.length !== values.length) target = new Float32Array(values.length)
  target.set(values)
}

function render(): void {
  const e = canvas.value
  if (!e) return
  const r = e.getBoundingClientRect(),
    d = devicePixelRatio || 1,
    w = Math.max(1, Math.floor(r.width * d)),
    h = Math.max(1, Math.floor(r.height * d))
  if (e.width !== w || e.height !== h) {
    e.width = w
    e.height = h
  }
  const c = e.getContext('2d')
  if (!c) return
  c.clearRect(0, 0, w, h)
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
  if (!gradient || gradientHeight !== h || gradientColor !== color) {
    gradient = c.createLinearGradient(0, h, 0, 0)
    gradient.addColorStop(0, `rgb(${color} / .32)`)
    gradient.addColorStop(1, `rgb(${color} / .98)`)
    gradientHeight = h
    gradientColor = color
  }

  const bw = w / barCount
  const barWidth = Math.max(1, bw * 0.58)
  c.fillStyle = gradient
  for (let index = 0; index < barCount; index += 1) {
    const value = bars[index]
    levels[index] += (Math.max(0, Math.min(1, value)) - levels[index]) * 0.28
    const barHeight = Math.max(2 * d, levels[index] * h)
    c.fillRect(index * bw + (bw - barWidth) / 2, h - barHeight, barWidth, barHeight)
  }
  scheduleRender()
}
watch(() => props.spectrum, updateTarget, { immediate: true })
onMounted(() => scheduleRender())
onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  target = new Float32Array(0)
  levels = new Float32Array(0)
  bars = new Float32Array(0)
  gradient = undefined
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
  <canvas ref="canvas" class="block h-16 w-full" />
</template>
