<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface Star {
  x: number
  y: number
  radius: number
  opacity: number
  phase: number
  twinkle: number
  depth: number
  color: number
  bright: boolean
}

const props = withDefaults(defineProps<{ paused?: boolean }>(), { paused: false })
const canvas = ref<HTMLCanvasElement | null>(null)
const nebulaCanvas = ref<HTMLCanvasElement | null>(null)
const palette = ['#eaf3ff', '#b7d3ff', '#ffe7c1', '#d8caff']
const glowPalette = ['234,243,255', '174,207,255', '255,223,169', '218,192,255']
let context: CanvasRenderingContext2D | null = null
let observer: ResizeObserver | null = null
let motion: MediaQueryList | null = null
let frame = 0
let lastFrame = 0
let elapsed = 0
let width = 1
let height = 1
let nebulaWidth = 0
let nebulaHeight = 0
let nebulaResizeTimer: ReturnType<typeof setTimeout> | undefined
let glowSprites: HTMLCanvasElement[] = []

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
const stars: Star[] = Array.from({ length: 1600 }, () => {
  const x = random()
  const clustered = random() < 0.55
  const bandY = 0.77 - x * 0.53 + (random() + random() + random() - 1.5) * 0.15
  const y = clustered ? Math.max(0.01, Math.min(0.99, bandY)) : random()
  const bright = random() < 0.035
  return {
    x,
    y,
    radius: bright ? 1.2 + random() * 1.1 : 0.5 + Math.pow(random(), 6) * 1.15,
    opacity: (clustered ? 0.31 : 0.35) + random() * 0.58,
    phase: random() * Math.PI * 2,
    twinkle: 0.65 + random() * 1.55,
    depth: 0.35 + random() * 0.9,
    color: Math.floor(random() * palette.length),
    bright
  }
})

function noiseHash(x: number, y: number): number {
  let value = Math.imul(x, 374761393) + Math.imul(y, 668265263)
  value = Math.imul(value ^ (value >>> 13), 1274126177)
  return ((value ^ (value >>> 16)) >>> 0) / 4294967295
}

function softNoise(x: number, y: number): number {
  const cellX = Math.floor(x)
  const cellY = Math.floor(y)
  let blendX = x - cellX
  let blendY = y - cellY
  blendX = blendX * blendX * (3 - 2 * blendX)
  blendY = blendY * blendY * (3 - 2 * blendY)
  const top = noiseHash(cellX, cellY) * (1 - blendX) + noiseHash(cellX + 1, cellY) * blendX
  const bottom =
    noiseHash(cellX, cellY + 1) * (1 - blendX) + noiseHash(cellX + 1, cellY + 1) * blendX
  return top * (1 - blendY) + bottom * blendY
}

function renderNebula(boundsWidth: number, boundsHeight: number): void {
  const element = nebulaCanvas.value
  if (!element || boundsWidth < 1 || boundsHeight < 1) return
  const nextWidth = Math.max(180, Math.min(560, Math.round(boundsWidth * 0.5)))
  const nextHeight = Math.max(100, Math.round((nextWidth * boundsHeight) / boundsWidth))
  if (nextWidth === nebulaWidth && nextHeight === nebulaHeight) return
  nebulaWidth = nextWidth
  nebulaHeight = nextHeight
  element.width = nextWidth
  element.height = nextHeight
  const ctx = element.getContext('2d')
  if (!ctx) return
  const image = ctx.createImageData(nextWidth, nextHeight)
  const pixels = image.data
  for (let x = 0; x < nextWidth; x++) {
    const u = x / nextWidth
    for (let y = 0; y < nextHeight; y++) {
      const v = y / nextHeight
      const warp = softNoise(u * 9.9, v * 1.9)
      const broad = softNoise(u * 11.5, v * 13.4)
      const detail = softNoise(u * 14.2, v * 14.7)
      const wisps = softNoise(u * 28.0, v * 18.0)
      const center = 0.58 - u * 0.53 + warp * 0.24 + (detail - 0.5) * 0.13
      const reach = 0.12 + (broad - 0.5) * 0.32 + (detail - 0.5) * 0.22
      const contour = Math.max(0, Math.min(1, (reach - Math.abs(v - center) + 0.025) / 0.09))
      const cloud = broad * 0.24 + detail * 0.24 + wisps * 0.12
      let density = contour * Math.max(0, Math.min(1, (cloud - 0.28) / 0.78))
      density = density * density * (3 - 2 * density)
      const dust = Math.max(0, (softNoise(u * 9.2 + 34.0, v * 9.2 + 6.0) - 0.62) / 0.38)
      density *= 1 - dust * 0.75
      const violet = Math.max(0, Math.min(1, 0.18 + broad * 0.65 + detail * 0.18))
      const index = (y * nextWidth + x) * 4
      pixels[index] = 61 + violet * 73
      pixels[index + 1] = 108 - violet * 28
      pixels[index + 2] = 169 + violet * 29
      pixels[index + 3] = density * (0.27 + broad * 0.17) * 255
    }
  }
  ctx.putImageData(image, 0, 0)
}

function scheduleNebula(boundsWidth: number, boundsHeight: number): void {
  if (!nebulaWidth) {
    renderNebula(boundsWidth, boundsHeight)
    return
  }
  if (nebulaResizeTimer) clearTimeout(nebulaResizeTimer)
  nebulaResizeTimer = setTimeout(() => {
    nebulaResizeTimer = undefined
    renderNebula(boundsWidth, boundsHeight)
  }, 150)
}

function createGlowSprite(rgb: string): HTMLCanvasElement {
  const sprite = document.createElement('canvas')
  sprite.width = sprite.height = 64
  const ctx = sprite.getContext('2d')
  if (!ctx) return sprite
  const halo = ctx.createRadialGradient(32, 32, 0, 32, 32, 31)
  halo.addColorStop(0, `rgba(${rgb}, 0.95)`)
  halo.addColorStop(0.1, `rgba(${rgb}, 0.48)`)
  halo.addColorStop(0.38, `rgba(${rgb}, 0.12)`)
  halo.addColorStop(1, `rgba(${rgb}, 0)`)
  ctx.fillStyle = halo
  ctx.fillRect(0, 0, 64, 64)
  const flare = ctx.createLinearGradient(0, 32, 64, 32)
  flare.addColorStop(0, `rgba(${rgb}, 0)`)
  flare.addColorStop(0.5, `rgba(${rgb}, 0.32)`)
  flare.addColorStop(1, `rgba(${rgb}, 0)`)
  ctx.fillStyle = flare
  ctx.fillRect(0, 31.5, 64, 1)
  ctx.save()
  ctx.translate(32, 32)
  ctx.rotate(Math.PI / 2)
  ctx.translate(-32, -32)
  ctx.fillRect(0, 31.5, 64, 1)
  ctx.restore()
  return sprite
}

function draw(): void {
  if (!context) return
  context.clearRect(0, 0, width, height)
  const count = Math.min(stars.length, Math.round((width * height) / 600))
  const sizeScale = Math.max(0.72, Math.min(1.3, height / 750))
  for (let index = 0; index < count; index++) {
    const star = stars[index]
    const x = ((star.x + elapsed * 0.00055 * star.depth) % 1) * width
    const y = ((star.y - elapsed * 0.00016 * star.depth + 1) % 1) * height
    const twinkle = 0.55 + 0.45 * Math.sin(elapsed * star.twinkle + star.phase)
    const opacity = star.opacity * twinkle
    const radius = star.radius * sizeScale
    if (star.bright) {
      const spriteSize = radius * 12
      context.globalAlpha = opacity * 0.8
      context.drawImage(
        glowSprites[star.color],
        x - spriteSize / 2,
        y - spriteSize / 2,
        spriteSize,
        spriteSize
      )
    }
    context.globalAlpha = opacity
    context.fillStyle = palette[star.color]
    if (radius < 1.15) {
      const size = Math.max(1, Math.round(radius * 1.35))
      context.fillRect(Math.round(x), Math.round(y), size, size)
    } else {
      context.beginPath()
      context.arc(x, y, radius, 0, Math.PI * 2)
      context.fill()
    }
  }
  context.globalAlpha = 1
}

function resize(): void {
  if (!canvas.value) return
  const bounds = canvas.value.getBoundingClientRect()
  const scale = Math.min(
    window.devicePixelRatio || 1,
    1.5,
    1800 / Math.max(bounds.width, bounds.height, 1),
    Math.sqrt(1_300_000 / Math.max(bounds.width * bounds.height, 1))
  )
  width = Math.max(1, Math.floor(bounds.width * scale))
  height = Math.max(1, Math.floor(bounds.height * scale))
  if (canvas.value.width !== width || canvas.value.height !== height) {
    canvas.value.width = width
    canvas.value.height = height
  }
  scheduleNebula(bounds.width, bounds.height)
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
  draw()
  if (!inactive()) frame = requestAnimationFrame(tick)
}

watch(() => props.paused, syncAnimation)
onMounted(() => {
  context = canvas.value?.getContext('2d', { alpha: true }) ?? null
  if (!context) return
  glowSprites = glowPalette.map(createGlowSprite)
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
  if (nebulaResizeTimer) clearTimeout(nebulaResizeTimer)
  observer?.disconnect()
  motion?.removeEventListener('change', syncAnimation)
  document.removeEventListener('visibilitychange', syncAnimation)
  window.removeEventListener('focus', syncAnimation)
  window.removeEventListener('blur', syncAnimation)
  glowSprites = []
  context = null
})
</script>

<template>
  <div class="starfield-background" aria-hidden="true">
    <canvas ref="nebulaCanvas" class="nebula-layer" />
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
    radial-gradient(ellipse 65% 48% at 55% 52%, rgb(28 36 76 / 26%), transparent 85%),
    linear-gradient(145deg, #030713, #090f22 52%, #050816);
}

canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}

.nebula-layer {
  z-index: 0;
  filter: blur(3px);
}

.star-layer {
  z-index: 1;
}
</style>
