<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
const props = defineProps<{ spectrum: number[]; color?: string }>()
const canvas = ref<HTMLCanvasElement>()
let raf = 0
let target: number[] = []
let levels: number[] = []
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
  const b = target.flatMap((value, index) => [value, (value + (target[index + 1] ?? value)) / 2])
  levels = levels.length === b.length ? levels : b.map(() => 0)
  c.clearRect(0, 0, w, h)
  const bw = w / b.length,
    barWidth = Math.max(1, bw * 0.58),
    color = props.color || '77 136 220'
  b.forEach((v, i) => {
    levels[i] += (Math.max(0, Math.min(1, v)) - levels[i]) * 0.28
    const bh = Math.max(2 * d, levels[i] * h),
      g = c.createLinearGradient(0, h - bh, 0, h)
    g.addColorStop(0, `rgb(${color} / .98)`)
    g.addColorStop(1, `rgb(${color} / .32)`)
    c.fillStyle = g
    c.fillRect(i * bw + (bw - barWidth) / 2, h - bh, barWidth, bh)
  })
  raf = requestAnimationFrame(render)
}
watch(
  () => props.spectrum,
  (v) => (target = [...v]),
  { deep: true, immediate: true }
)
onMounted(() => (raf = requestAnimationFrame(render)))
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>
<template>
  <canvas ref="canvas" class="block h-16 w-full" />
</template>
