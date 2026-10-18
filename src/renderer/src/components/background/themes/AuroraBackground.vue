<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ paused?: boolean }>(), { paused: false })
const canvas = ref<HTMLCanvasElement | null>(null)
let context: CanvasRenderingContext2D | null = null
let observer: ResizeObserver | null = null
let motion: MediaQueryList | null = null
let nearRay: HTMLCanvasElement | null = null
let farRay: HTMLCanvasElement | null = null
let width = 1
let height = 1
let frame = 0
let lastFrame = 0
let elapsed = 0

const stars = Array.from({ length: 42 }, (_, index) => ({
  x: `${((index * 73.37 + 11) % 100).toFixed(2)}%`,
  y: `${((index * 31.71 + 7) % 94).toFixed(2)}%`,
  opacity: 0.15 + (index % 5) * 0.08,
  size: index % 7 === 0 ? '1.5px' : '1px'
}))

// Cache the emission profile. Animation only positions these tiny sprites;
// it never creates per-frame gradients, noise images, filters, or DOM nodes.
function createRay(distant: boolean): HTMLCanvasElement {
  const sprite = document.createElement('canvas')
  sprite.width = 16
  sprite.height = 256
  const ctx = sprite.getContext('2d')
  if (!ctx) return sprite
  const light = ctx.createLinearGradient(0, 0, 0, 256)
  light.addColorStop(0, 'rgba(123,76,122,0)')
  light.addColorStop(0.12, 'rgba(123,76,122,0.025)')
  light.addColorStop(0.38, 'rgba(60,137,109,0.07)')
  light.addColorStop(0.65, distant ? 'rgba(66,163,145,0.22)' : 'rgba(62,186,104,0.22)')
  light.addColorStop(0.86, distant ? 'rgba(92,210,173,0.48)' : 'rgba(92,235,118,0.55)')
  light.addColorStop(0.955, distant ? 'rgba(133,234,195,0.7)' : 'rgba(169,255,157,0.9)')
  light.addColorStop(0.982, 'rgba(104,218,126,0.42)')
  light.addColorStop(1, 'rgba(76,175,113,0)')
  ctx.fillStyle = light
  ctx.fillRect(0, 0, 16, 256)
  ctx.globalCompositeOperation = 'destination-in'
  const edge = ctx.createLinearGradient(0, 0, 16, 0)
  edge.addColorStop(0, 'rgba(0,0,0,0)')
  edge.addColorStop(0.35, 'rgba(0,0,0,0.85)')
  edge.addColorStop(0.5, '#000')
  edge.addColorStop(0.65, 'rgba(0,0,0,0.85)')
  edge.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = edge
  ctx.fillRect(0, 0, 16, 256)
  return sprite
}

function drawCurtain(distant: boolean): void {
  const ctx = context
  const sprite = distant ? farRay : nearRay
  if (!ctx || !sprite) return
  const count = distant ? 144 : 288
  const time = elapsed * 0.11
  const phase = distant ? 2.4 : 0.3
  const spacing = (width * 1.2) / (count - 1)
  for (let index = 0; index < count; index++) {
    const u = (index / (count - 1)) * 1.2 - 0.1
    // Project a folded ribbon: overlapping rays gather light in the folds.
    const fold = u * 14 + phase + time * 0.28
    const curl = u * 32 - time * 0.19 + phase
    const derivative = 1 + Math.cos(fold) * 0.77 + Math.cos(curl) * 0.544
    const rayWidth = spacing * (2.2 + Math.abs(derivative) * 0.9)
    const x = (u + Math.sin(fold) * 0.055 + Math.sin(curl) * 0.017) * width
    const bottom =
      (0.48 +
        (distant ? -0.12 : 0.08) +
        Math.sin(u * 5.1 + phase) * 0.11 +
        Math.sin(fold) * 0.065 +
        Math.sin(curl) * 0.018) *
      height
    const reach =
      (0.25 +
        0.1 * Math.sin(u * 8 + phase + time * 0.16) +
        0.035 * Math.sin(u * 37 + time * 0.35)) *
      height
    const current = 0.5 + 0.5 * Math.sin(u * 93 + Math.sin(u * 27 - time) * 2.1 + time * 0.8)
    const fine = 0.93 + 0.07 * Math.sin(u * 251 + Math.sin(u * 73) + time * 0.6)
    const envelope = Math.max(0, Math.sin(Math.max(0, Math.min(1, u)) * Math.PI))
    ctx.globalAlpha =
      (Math.pow(envelope, 0.45) *
        (0.26 + current * current * 0.74) *
        fine *
        (distant ? 0.16 : 0.4)) /
      (1 + Math.max(0, 1 - Math.abs(derivative)) * 0.6)
    const lean = 0.08 * Math.sin(u * 9 + time * 0.15 + phase)
    ctx.setTransform(1, 0, lean, 1, x - lean * reach, bottom - reach)
    ctx.drawImage(sprite, -rayWidth / 2, 0, rayWidth, reach)
  }
}

function draw(): void {
  if (!context) return
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.clearRect(0, 0, width, height)
  context.globalCompositeOperation = 'lighter'
  drawCurtain(true)
  drawCurtain(false)
  context.setTransform(1, 0, 0, 1, 0, 0)
  context.globalAlpha = 1
  context.globalCompositeOperation = 'source-over'
}

function resize(): void {
  const element = canvas.value
  if (!element) return
  const bounds = element.getBoundingClientRect()
  // Soft atmospheric light does not need device-pixel resolution. Bound both
  // raster cost and backing-store memory even on large / high-DPI screens.
  const scale = Math.min(
    1,
    960 / Math.max(bounds.width, 1),
    540 / Math.max(bounds.height, 1),
    Math.sqrt(360_000 / Math.max(bounds.width * bounds.height, 1))
  )
  const nextWidth = Math.max(1, Math.floor(bounds.width * scale))
  const nextHeight = Math.max(1, Math.floor(bounds.height * scale))
  if (
    width === nextWidth &&
    height === nextHeight &&
    element.width === nextWidth &&
    element.height === nextHeight
  )
    return
  width = element.width = nextWidth
  height = element.height = nextHeight
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
  if (!lastFrame || now - lastFrame >= 1000 / 24) {
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
  nearRay = createRay(false)
  farRay = createRay(true)
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
  nearRay = farRay = null
  context = null
})
</script>

<template>
  <div class="aurora-background" aria-hidden="true">
    <span
      v-for="(star, index) in stars"
      :key="index"
      class="aurora-star"
      :style="{
        left: star.x,
        top: star.y,
        width: star.size,
        height: star.size,
        opacity: star.opacity
      }"
    />
    <canvas ref="canvas" class="aurora-curtain" />
  </div>
</template>

<style scoped>
.aurora-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
  background:
    radial-gradient(ellipse 100% 70% at 48% 28%, rgb(18 47 48 / 24%), transparent 80%),
    linear-gradient(175deg, #050e19, #08151e 58%, #050b14);
}

.aurora-curtain {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.aurora-star {
  position: absolute;
  border-radius: 50%;
  background: #c3d9df;
}
</style>
