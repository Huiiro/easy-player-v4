<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface Star {
  x: number
  y: number
  radius: number
  opacity: number
  phase: number
  speed: number
  color: number
}

const props = withDefaults(defineProps<{ paused?: boolean }>(), { paused: false })
const canvas = ref<HTMLCanvasElement | null>(null)
const distantCanvas = ref<HTMLCanvasElement | null>(null)
const palette = ['#e5edf5', '#c4d5e8', '#a4bfdc']
let context: CanvasRenderingContext2D | null = null
let observer: ResizeObserver | null = null
let motion: MediaQueryList | null = null
let frame = 0
let lastFrame = 0
let elapsed = 0
let width = 1
let height = 1
let glowSprite: HTMLCanvasElement | null = null
let visibleStars = 0

function createRandom(seed: number): () => number {
  let state = seed
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

const random = createRandom(88427)
function createStar(): Star {
  return {
    x: random(),
    y: random(),
    radius: 0.35 + Math.pow(random(), 3) * 0.55,
    opacity: 0.18 + random() * 0.44,
    phase: random() * Math.PI * 2,
    speed: 0.35 + random() * 0.4,
    color: Math.floor(random() * palette.length)
  }
}

// The distant field is painted only on resize. Keep animation work independent
// of its density, including on large / high-DPI displays.
const distantStars = Array.from({ length: 580 }, createStar)
const stars = Array.from({ length: 36 }, createStar)

function createGlowSprite(): HTMLCanvasElement {
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = 48
  const ctx = sprite.getContext('2d')
  if (!ctx) return sprite
  const halo = ctx.createRadialGradient(24, 24, 0, 24, 24, 24)
  halo.addColorStop(0, 'rgba(210,229,248,0.45)')
  halo.addColorStop(0.12, 'rgba(184,212,241,0.18)')
  halo.addColorStop(0.4, 'rgba(150,187,225,0.035)')
  halo.addColorStop(1, 'rgba(150,187,225,0)')
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, 48, 48)
  return sprite
}

function drawDistantStars(): void {
  const ctx = distantCanvas.value?.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, width, height)
  const count = Math.min(distantStars.length, Math.round((width * height) / 2700))
  for (let index = 0; index < count; index++) {
    const star = distantStars[index]
    // A broad, faint concentration gives depth without a dense, dusty stripe.
    const space = 0.65 + 0.35 * Math.sin(star.x * Math.PI)
    ctx.globalAlpha = star.opacity * space
    ctx.fillStyle = palette[star.color]
    ctx.beginPath()
    ctx.arc(star.x * width, star.y * height, star.radius, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

function draw(): void {
  if (!context) return
  context.clearRect(0, 0, width, height)
  for (let index = 0; index < visibleStars; index++) {
    const star = stars[index]
    // Wrap outside the viewport so a halo never disappears at the edge.
    const x = ((star.x * (width + 24) + elapsed * star.speed * 0.45) % (width + 24)) - 12
    const y = ((star.y * (height + 24) + elapsed * star.speed * 0.12) % (height + 24)) - 12
    const opacity =
      (0.6 + star.opacity * 0.4) * (0.86 + 0.14 * Math.sin(elapsed * star.speed + star.phase))
    const radius = 0.7 + star.radius * 0.65
    if (index % 4 === 0 && glowSprite) {
      const size = radius * 15
      context.globalAlpha = opacity * 0.7
      context.drawImage(glowSprite, x - size / 2, y - size / 2, size, size)
    }
    context.globalAlpha = opacity
    context.fillStyle = palette[star.color]
    context.beginPath()
    context.arc(x, y, radius, 0, Math.PI * 2)
    context.fill()
  }
  context.globalAlpha = 1
}

function resize(): void {
  if (!canvas.value || !distantCanvas.value) return
  const bounds = canvas.value.getBoundingClientRect()
  const nextWidth = Math.max(1, bounds.width)
  const nextHeight = Math.max(1, bounds.height)
  const scale = Math.min(
    window.devicePixelRatio || 1,
    1.5,
    1800 / Math.max(nextWidth, nextHeight),
    Math.sqrt(1_000_000 / (nextWidth * nextHeight))
  )
  const pixelWidth = Math.max(1, Math.floor(nextWidth * scale))
  const pixelHeight = Math.max(1, Math.floor(nextHeight * scale))
  if (
    width === nextWidth &&
    height === nextHeight &&
    canvas.value.width === pixelWidth &&
    canvas.value.height === pixelHeight
  )
    return
  width = nextWidth
  height = nextHeight
  for (const element of [canvas.value, distantCanvas.value]) {
    element.width = pixelWidth
    element.height = pixelHeight
    element.getContext('2d')?.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0)
  }
  visibleStars = Math.min(stars.length, Math.round((width * height) / 42000))
  drawDistantStars()
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
  context = canvas.value?.getContext('2d', { alpha: true }) ?? null
  if (!context) return
  glowSprite = createGlowSprite()
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
  glowSprite = null
  context = null
})
</script>

<template>
  <div class="starfield-background" aria-hidden="true">
    <canvas ref="distantCanvas" class="distant-layer" />
    <canvas ref="canvas" class="star-layer" />
  </div>
</template>

<style scoped>
.starfield-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
  background:
    radial-gradient(ellipse 95% 85% at 76% 18%, rgb(38 67 97 / 30%), transparent 75%),
    radial-gradient(ellipse 80% 70% at 14% 92%, rgb(22 43 65 / 20%), transparent 80%),
    linear-gradient(155deg, #080f1b, #0b1625 52%, #060c16);
}

canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}

.distant-layer {
  z-index: 0;
}

.star-layer {
  z-index: 1;
}
</style>
