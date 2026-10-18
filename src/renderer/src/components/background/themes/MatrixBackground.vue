<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

interface DataStream {
  x: number
  offset: number
  speed: number
  scale: number
  opacity: number
  phase: number
  variant: number
  glyph: number
  token: number
  depth: number
}

const props = withDefaults(defineProps<{ paused?: boolean }>(), { paused: false })
const canvas = ref<HTMLCanvasElement | null>(null)
// All text uses the same ASCII monospace face. Continuous character ribbons
// provide the motion; short code tokens stay attached to their leading edge.
const glyphs = Array.from('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ[]{}<>/=:;+-')
const tokens = [
  'read()',
  'recv()',
  'sync()',
  'decode()',
  'push()',
  'frame[]',
  '0x7F',
  '0xA3',
  'ACK',
  'READY',
  'crc.ok',
  'bit>>1'
]
const cellWidth = 20
const cellHeight = 24
const atlasScale = 2
const atlasColumns = 16
const glyphRegion = Math.ceil(glyphs.length / atlasColumns) * cellHeight
const tokenRegion = Math.ceil(tokens.length / 4) * cellHeight
const trailRows = Array.from({ length: 12 }, (_, index) => 18 + ((index * 7) % 19))
let context: CanvasRenderingContext2D | null = null
let codeAtlas: HTMLCanvasElement | null = null
let trailAtlas: HTMLCanvasElement | null = null
let streams: DataStream[] = []
let observer: ResizeObserver | null = null
let motion: MediaQueryList | null = null
let width = 1
let height = 1
let pixelScale = 1
let streamCount = 0
let frame = 0
let lastFrame = 0
let lastTick = 0
let elapsed = 0

function createRandom(seed: number): () => number {
  let state = seed
  return () => {
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    return (state >>> 0) / 4294967296
  }
}

function createAtlas(): HTMLCanvasElement {
  const atlas = document.createElement('canvas')
  atlas.width = 512 * atlasScale
  atlas.height = (glyphRegion + tokenRegion) * 2 * atlasScale
  const ctx = atlas.getContext('2d')
  if (!ctx) return atlas
  ctx.scale(atlasScale, atlasScale)
  ctx.font = '16px Consolas, monospace'
  ctx.textBaseline = 'middle'
  for (let palette = 0; palette < 2; palette++) {
    ctx.fillStyle = palette ? '#e1ffe8' : '#64d990'
    ctx.shadowColor = palette ? '#8defb3' : 'transparent'
    ctx.shadowBlur = palette ? 2 : 0
    ctx.textAlign = 'center'
    glyphs.forEach((glyph, index) => {
      ctx.fillText(
        glyph,
        ((index % atlasColumns) + 0.5) * cellWidth,
        palette * glyphRegion + (Math.floor(index / atlasColumns) + 0.5) * cellHeight
      )
    })
    ctx.textAlign = 'left'
    tokens.forEach((token, index) => {
      ctx.fillText(
        token,
        (index % 4) * 128 + 4,
        glyphRegion * 2 + palette * tokenRegion + (Math.floor(index / 4) + 0.5) * cellHeight
      )
    })
  }
  return atlas
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: number,
  bright: boolean,
  x: number,
  y: number,
  scale: number
): void {
  if (!codeAtlas) return
  ctx.drawImage(
    codeAtlas,
    (glyph % atlasColumns) * cellWidth * atlasScale,
    ((bright ? glyphRegion : 0) + Math.floor(glyph / atlasColumns) * cellHeight) * atlasScale,
    cellWidth * atlasScale,
    cellHeight * atlasScale,
    x,
    y,
    cellWidth * scale,
    cellHeight * scale
  )
}

// Twelve fixed ribbon textures share one atlas. They are reused by every
// stream, including after resize, so the animation never rasterises text or
// allocates a canvas. Long tails are faded into the cache once.
function createTrails(): HTMLCanvasElement {
  const atlas = document.createElement('canvas')
  atlas.width = trailRows.length * cellWidth * atlasScale
  atlas.height = Math.max(...trailRows) * cellHeight * atlasScale
  const ctx = atlas.getContext('2d')
  if (!ctx) return atlas
  const random = createRandom(481927)
  trailRows.forEach((rows, variant) => {
    for (let row = 0; row < rows; row++) {
      if (random() < 0.07) continue
      const depth = (row + 1) / rows
      ctx.globalAlpha = 0.012 + Math.pow(depth, 2.5) * 0.92
      drawGlyph(
        ctx,
        Math.floor(random() * glyphs.length),
        false,
        variant * cellWidth * atlasScale,
        row * cellHeight * atlasScale,
        atlasScale
      )
    }
  })
  ctx.globalAlpha = 1
  return atlas
}

function createStreams(count: number): void {
  const random = createRandom(219437)
  streamCount = count
  streams = Array.from({ length: count }, (_, index) => {
    const foreground = index % 15 === 10
    const distant = index % 4 === 0 && !foreground
    return {
      x: (index + 0.1 + random() * 0.8) / count,
      offset: random(),
      speed: foreground
        ? 320 + random() * 120
        : distant
          ? 80 + random() * 60
          : 150 + random() * 110,
      scale: foreground
        ? 1.18 + random() * 0.22
        : distant
          ? 0.7 + random() * 0.12
          : 0.88 + random() * 0.16,
      opacity: foreground
        ? 0.7 + random() * 0.12
        : distant
          ? 0.25 + random() * 0.1
          : 0.48 + random() * 0.22,
      phase: random() * Math.PI * 2,
      variant: Math.floor(random() * trailRows.length),
      glyph: Math.floor(random() * glyphs.length),
      token: index % 10 === 3 && !foreground ? Math.floor(random() * tokens.length) : -1,
      depth: foreground ? 2 : distant ? 0 : 1
    }
  }).sort((left, right) => left.depth - right.depth)
}

function draw(): void {
  if (!context || !codeAtlas || !trailAtlas) return
  context.clearRect(0, 0, width, height)
  for (const stream of streams) {
    const scale = stream.scale * pixelScale
    const glyphHeight = cellHeight * scale
    const rows = trailRows[stream.variant]
    const tailHeight = rows * glyphHeight
    const travel = height + tailHeight + glyphHeight
    const clock = elapsed + 0.18 * (Math.sin(elapsed * 0.7 + stream.phase) - Math.sin(stream.phase))
    const headY =
      ((stream.offset * travel + clock * stream.speed * pixelScale) % travel) - glyphHeight
    const x = stream.x * width - (cellWidth * scale) / 2
    const centre = Math.abs(stream.x - 0.5) * 2
    const breathingRoom = 0.4 + centre * 0.6
    const pulse = 0.86 + 0.14 * Math.sin(elapsed * 0.5 + stream.phase)
    const opacity = stream.opacity * breathingRoom * pulse
    context.globalAlpha = opacity
    context.drawImage(
      trailAtlas,
      stream.variant * cellWidth * atlasScale,
      0,
      cellWidth * atlasScale,
      rows * cellHeight * atlasScale,
      x,
      headY - tailHeight,
      cellWidth * scale,
      tailHeight
    )
    // Only draw leading glyphs and tokens while they intersect the viewport.
    if (headY >= height || headY + glyphHeight <= 0) continue
    const glyph = (stream.glyph + Math.floor(elapsed * 6 + stream.phase)) % glyphs.length
    context.globalAlpha = Math.min(0.88, opacity * (stream.depth === 0 ? 0.7 : 1.2))
    drawGlyph(context, glyph, stream.depth > 0, x, headY, scale)
    if (stream.depth === 2) {
      // A short highlight follows the fast leading edge, rather than a
      // screen-wide blur or scan pass.
      context.globalAlpha = opacity * 0.2
      context.fillStyle = '#b2f6cc'
      context.fillRect(
        x + cellWidth * scale * 0.47,
        headY - glyphHeight * 0.6,
        Math.max(1, scale),
        glyphHeight * 1.2
      )
    }
    if (stream.token >= 0) {
      const signal = Math.pow(Math.max(0, Math.sin(elapsed * 0.7 + stream.phase)), 2)
      context.globalAlpha = opacity * signal * 0.75
      context.drawImage(
        codeAtlas,
        (stream.token % 4) * 128 * atlasScale,
        (glyphRegion * 2 + tokenRegion + Math.floor(stream.token / 4) * cellHeight) * atlasScale,
        128 * atlasScale,
        cellHeight * atlasScale,
        x + cellWidth * scale,
        headY,
        128 * scale,
        glyphHeight
      )
    }
  }
  context.globalAlpha = 1
}

function resize(): void {
  const element = canvas.value
  if (!element) return
  const bounds = element.getBoundingClientRect()
  const scale = Math.min(
    window.devicePixelRatio || 1,
    1.25,
    1440 / Math.max(bounds.width, 1),
    900 / Math.max(bounds.height, 1),
    Math.sqrt(720_000 / Math.max(bounds.width * bounds.height, 1))
  )
  const nextWidth = Math.max(1, Math.floor(bounds.width * scale))
  const nextHeight = Math.max(1, Math.floor(bounds.height * scale))
  const count = Math.max(12, Math.min(64, Math.ceil(bounds.width / 32)))
  if (width === nextWidth && height === nextHeight && pixelScale === scale && streamCount === count)
    return
  width = element.width = nextWidth
  height = element.height = nextHeight
  pixelScale = scale
  if (streamCount !== count) createStreams(count)
  draw()
}

function inactive(): boolean {
  return props.paused || document.hidden || !document.hasFocus() || !!motion?.matches
}
function stop(): void {
  cancelAnimationFrame(frame)
  frame = 0
  lastFrame = 0
  lastTick = 0
}
function tick(now: number): void {
  frame = 0
  if (inactive()) return
  elapsed += lastTick ? Math.min((now - lastTick) / 1000, 0.1) : 0
  lastTick = now
  const interval = 1000 / 24
  if (!lastFrame || now - lastFrame >= interval) {
    // Carry the vsync remainder so a 60 Hz display averages 24 updates,
    // instead of rounding every update down to 20 fps.
    lastFrame = lastFrame ? now - ((now - lastFrame) % interval) : now
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
  codeAtlas = createAtlas()
  trailAtlas = createTrails()
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
  streams = []
  codeAtlas = trailAtlas = null
  context = null
})
</script>

<template>
  <div class="matrix-background" aria-hidden="true">
    <canvas ref="canvas" />
  </div>
</template>

<style scoped>
.matrix-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
  background:
    radial-gradient(ellipse 70% 100% at 18% 30%, rgb(24 62 46 / 15%), transparent 80%),
    linear-gradient(155deg, #030a07, #06110b 58%, #020705);
}
canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
}
</style>
