<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ paused?: boolean }>(), { paused: false })
const canvas = ref<HTMLCanvasElement | null>(null)
const TAU = Math.PI * 2
const samples = 96
// Reuse geometry: no per-frame arrays, DOM updates, blur or shadow passes.
const x = new Float32Array((samples + 1) * 2)
const y = new Float32Array((samples + 1) * 2)
const depth = new Float32Array((samples + 1) * 2)
const colors = ['#78c9be', '#a5a3d4']
const particles = Array.from({ length: 48 }, (_, i) => ({
  x: (i * 0.61803398875 + 0.13) % 1,
  y: (i * 0.41421356237 + 0.07) % 1,
  radius: 0.6 + (i % 4) * 0.25,
  speed: 0.7 + (i % 5) * 0.18
}))
let context: CanvasRenderingContext2D | null = null
let observer: ResizeObserver | null = null
let motion: MediaQueryList | null = null
let frame = 0
let lastFrame = 0
let elapsed = 0
let width = 1
let height = 1

function draw(): void {
  const ctx = context
  if (!ctx) return
  ctx.clearRect(0, 0, width, height)
  const span = height * 1.12
  const radius = Math.min(width * 0.19, height * 0.23)
  const center = width * 0.5
  // One rotation in 80 seconds. A slight lean keeps the full-height subject organic.
  const rotation = (elapsed * TAU) / 80
  for (let strand = 0; strand < 2; strand++) {
    for (let i = 0; i <= samples; i++) {
      const t = i / samples
      const angle = t * TAU * 2.25 + rotation + strand * Math.PI
      const index = strand * (samples + 1) + i
      const z = Math.sin(angle)
      x[index] = center + (t - 0.5) * span * 0.26 + Math.cos(angle) * radius
      y[index] = height * 0.5 + (t - 0.5) * span + z * radius * 0.12
      depth[index] = (z + 1) * 0.5
    }
  }
  ctx.lineCap = 'round'
  // Muted base pairs read as a ladder without forming a bright wall behind text.
  ctx.strokeStyle = '#8eb8c4'
  ctx.lineWidth = 1
  for (let i = 0; i <= samples; i += 3) {
    const other = samples + 1 + i
    ctx.globalAlpha = 0.11
    ctx.beginPath()
    ctx.moveTo(x[i], y[i])
    ctx.lineTo(x[other], y[other])
    ctx.stroke()
  }
  // Back segments first; depth changes opacity and thickness instead of costly lighting.
  for (let front = 0; front < 2; front++) {
    for (let strand = 0; strand < 2; strand++) {
      ctx.strokeStyle = ctx.fillStyle = colors[strand]
      const offset = strand * (samples + 1)
      for (let i = 0; i <= samples; i++) {
        const index = offset + i
        const d = depth[index]
        if (Number(d >= 0.5) !== front) continue
        const edge = Math.min(1, i / 8, (samples - i) / 8)
        ctx.globalAlpha = (0.16 + d * 0.32) * edge
        if (i < samples) {
          ctx.lineWidth = 1.1 + d * 1.2
          ctx.beginPath()
          ctx.moveTo(x[index], y[index])
          ctx.lineTo(x[index + 1], y[index + 1])
          ctx.stroke()
        }
        if (i % 3 === 0) {
          ctx.beginPath()
          ctx.arc(x[index], y[index], 1.8 + d * 1.4, 0, TAU)
          ctx.fill()
        }
      }
    }
  }
  const count = Math.min(particles.length, Math.ceil((width * height) / 22000))
  ctx.fillStyle = '#a3c9d1'
  ctx.strokeStyle = '#83b4c0'
  ctx.lineWidth = 0.7
  for (let i = 0; i < count; i++) {
    const p = particles[i]
    const px = p.x * width + Math.sin(elapsed * 0.06 + i) * 9
    const py =
      ((((p.y * (height + 16) - elapsed * p.speed) % (height + 16)) + height + 16) %
        (height + 16)) -
      8
    ctx.globalAlpha = (0.12 + (i % 3) * 0.055) * (0.8 + Math.sin(elapsed * 0.2 + i) * 0.2)
    ctx.beginPath()
    ctx.arc(px, py, p.radius, 0, TAU)
    ctx.fill()
    // Sparse molecule-like pairs add structure in the margins, with fixed O(n) work.
    if (i % 3 === 0 && Math.abs(p.x - 0.5) > 0.22) {
      const angle = i * 2.4 + elapsed * 0.025
      const distance = 18 + (i % 5) * 5
      const dx = Math.cos(angle) * distance
      const dy = Math.sin(angle) * distance
      ctx.globalAlpha = 0.075
      ctx.beginPath()
      ctx.moveTo(px, py)
      ctx.lineTo(px + dx, py + dy)
      ctx.stroke()
      ctx.globalAlpha = 0.19
      ctx.beginPath()
      ctx.arc(px + dx, py + dy, p.radius * 0.8, 0, TAU)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
}

function resize(): void {
  const element = canvas.value
  if (!element || !context) return
  const bounds = element.getBoundingClientRect()
  width = Math.max(1, bounds.width)
  height = Math.max(1, bounds.height)
  // Bound both pixel count and longest edge, even on Retina / 4K displays.
  const scale = Math.min(
    window.devicePixelRatio || 1,
    1.5,
    1800 / Math.max(width, height),
    Math.sqrt(900000 / (width * height))
  )
  element.width = Math.max(1, Math.floor(width * scale))
  element.height = Math.max(1, Math.floor(height * scale))
  context.setTransform(element.width / width, 0, 0, element.height / height, 0, 0)
  draw()
}

function inactive(): boolean {
  return props.paused || document.hidden || !document.hasFocus() || !!motion?.matches
}
function stop(): void {
  cancelAnimationFrame(frame)
  frame = 0
  lastFrame = 0
}
function tick(now: number): void {
  frame = 0
  if (inactive()) return
  if (!lastFrame || now - lastFrame >= 1000 / 30) {
    elapsed += lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0
    lastFrame = now
    draw()
  }
  frame = requestAnimationFrame(tick)
}
function syncAnimation(): void {
  stop()
  if (!inactive()) frame = requestAnimationFrame(tick)
}
watch(() => props.paused, syncAnimation)
onMounted(() => {
  context = canvas.value?.getContext('2d') ?? null
  if (!context) return
  motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  motion.addEventListener('change', syncAnimation)
  document.addEventListener('visibilitychange', syncAnimation)
  window.addEventListener('focus', syncAnimation)
  window.addEventListener('blur', syncAnimation)
  observer = new ResizeObserver(resize)
  if (canvas.value) observer.observe(canvas.value)
  resize()
  syncAnimation()
})
onBeforeUnmount(() => {
  stop()
  observer?.disconnect()
  motion?.removeEventListener('change', syncAnimation)
  document.removeEventListener('visibilitychange', syncAnimation)
  window.removeEventListener('focus', syncAnimation)
  window.removeEventListener('blur', syncAnimation)
  context = null
})
</script>

<template>
  <div class="dna-background" aria-hidden="true">
    <canvas ref="canvas" />
  </div>
</template>

<style scoped>
.dna-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
  background:
    radial-gradient(ellipse 38% 80% at 50% 45%, rgb(39 88 91 / 24%), transparent 80%),
    radial-gradient(ellipse 40% 48% at 8% 30%, rgb(39 87 99 / 24%), transparent 85%),
    radial-gradient(ellipse 42% 55% at 92% 72%, rgb(72 62 105 / 24%), transparent 85%),
    radial-gradient(ellipse 55% 35% at 22% 100%, rgb(48 61 89 / 18%), transparent 85%),
    linear-gradient(145deg, #08121a, #0c1a23 60%, #09131e);
}
canvas {
  display: block;
  width: 100%;
  height: 100%;
}
</style>
