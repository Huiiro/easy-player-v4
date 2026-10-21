<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ paused?: boolean }>(), { paused: false })
const canvas = ref<HTMLCanvasElement | null>(null)
const running = ref(false)
let observer: ResizeObserver | null = null
let motion: MediaQueryList | null = null
let lastWidth = 0
let lastHeight = 0
let lastPixels = 0

function syncAnimation(): void {
  running.value = !props.paused && !document.hidden && document.hasFocus() && !motion?.matches
}

function resize(): void {
  const element = canvas.value
  const host = element?.parentElement
  if (!element || !host) return
  const { width, height } = host.getBoundingClientRect()
  if (!width || !height) return
  // Cover every corner at every rotation, including ultrawide windows.
  const radius = Math.hypot(width * 0.5, height * 0.5) + 4
  const diameter = radius * 2
  // One bounded texture (<= 1.96 MP), painted only when the viewport changes.
  const pixels = Math.max(
    1,
    Math.min(1400, Math.round(diameter * Math.min(window.devicePixelRatio || 1, 1.5)))
  )
  if (width === lastWidth && height === lastHeight && pixels === lastPixels) return
  lastWidth = width
  lastHeight = height
  lastPixels = pixels
  element.width = element.height = pixels
  element.style.width = element.style.height = `${diameter}px`
  const ctx = element.getContext('2d')
  if (!ctx) return
  ctx.setTransform(pixels / diameter, 0, 0, pixels / diameter, pixels / 2, pixels / 2)
  let seed = 71023
  const random = (): number => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 4294967296
  }
  // Broad, faint sky haze is baked into the same rotating texture, not animated separately.
  ctx.save()
  ctx.rotate(-0.55)
  ctx.scale(1, 0.42)
  for (const [offset, color] of [
    [-0.45, 'rgba(81,111,156,0.17)'],
    [0.12, 'rgba(107,91,133,0.14)'],
    [0.65, 'rgba(118,105,86,0.11)']
  ] as const) {
    const cx = radius * offset
    const cy = radius * 0.38
    const haze = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.72)
    haze.addColorStop(0, color)
    haze.addColorStop(1, 'rgba(20,28,45,0)')
    ctx.fillStyle = haze
    ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2)
  }
  ctx.restore()
  const palette = ['#adc9e8', '#dce1e8', '#9bbce4', '#dfc29b', '#bdd0db']
  const count = Math.min(720, Math.max(300, Math.round((width * height) / 1800)))
  ctx.lineCap = 'round'
  for (let i = 0; i < count; i++) {
    // All stars share one pole; a soft density band breaks up uniform rings.
    const r = Math.sqrt(random()) * radius
    const angle = random() * Math.PI * 2
    const band = Math.exp(
      -Math.pow((Math.sin(angle + 0.55) * r - radius * 0.16) / (radius * 0.22), 2)
    )
    const exposure = i % 5 === 0 ? 0.08 + random() * 0.12 : 0.32 + random() * 0.25
    const brightness = (0.13 + Math.pow(random(), 2) * 0.46) * (0.75 + band * 0.6)
    ctx.strokeStyle = ctx.fillStyle = palette[Math.floor(random() * palette.length)]
    ctx.lineWidth = 0.45 + random() * 0.65
    // Soft exposure ends, rather than bright comet heads or perfect graphic rings.
    for (let part = 0; part < 5; part++) {
      ctx.globalAlpha = brightness * (part === 0 || part === 4 ? 0.45 : 0.85)
      ctx.beginPath()
      ctx.arc(
        0,
        0,
        Math.max(r, 0.5),
        angle + (exposure * part) / 5,
        angle + (exposure * (part + 1)) / 5
      )
      ctx.stroke()
    }
    if (i % 6 === 0) {
      ctx.globalAlpha = brightness * 0.65
      ctx.beginPath()
      ctx.arc(Math.cos(angle) * r, Math.sin(angle) * r, 0.7, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  // Faint short-exposure stars provide depth between the longer arcs.
  ctx.fillStyle = '#b7cadf'
  for (let i = 0; i < 260; i++) {
    const r = Math.sqrt(random()) * radius
    const angle = random() * Math.PI * 2
    ctx.globalAlpha = 0.14 + random() * 0.21
    ctx.beginPath()
    ctx.arc(Math.cos(angle) * r, Math.sin(angle) * r, 0.4 + random() * 0.45, 0, Math.PI * 2)
    ctx.fill()
  }
  // Small near-polar trails make the center legible without an artificial beacon.
  ctx.strokeStyle = '#c4d4e4'
  ctx.lineWidth = 0.7
  for (let i = 0; i < 16; i++) {
    ctx.globalAlpha = 0.18 + random() * 0.22
    const angle = random() * Math.PI * 2
    ctx.beginPath()
    ctx.arc(0, 0, 5 + Math.sqrt(random()) * 62, angle, angle + 0.42)
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

watch(() => props.paused, syncAnimation)
onMounted(() => {
  motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  motion.addEventListener('change', syncAnimation)
  document.addEventListener('visibilitychange', syncAnimation)
  window.addEventListener('focus', syncAnimation)
  window.addEventListener('blur', syncAnimation)
  observer = new ResizeObserver(resize)
  if (canvas.value?.parentElement) observer.observe(canvas.value.parentElement)
  resize()
  syncAnimation()
})
onBeforeUnmount(() => {
  running.value = false
  // Vue retains the DOM during the leave transition; stop its compositor animation now.
  if (canvas.value) canvas.value.style.animationPlayState = 'paused'
  observer?.disconnect()
  motion?.removeEventListener('change', syncAnimation)
  document.removeEventListener('visibilitychange', syncAnimation)
  window.removeEventListener('focus', syncAnimation)
  window.removeEventListener('blur', syncAnimation)
})
</script>

<template>
  <div class="star-trails-background" aria-hidden="true">
    <canvas ref="canvas" :style="{ animationPlayState: running ? 'running' : 'paused' }" />
    <div class="mountain-foreground" />
  </div>
</template>

<style scoped>
.star-trails-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
  background:
    radial-gradient(ellipse 80% 75% at 50% 50%, rgb(42 65 94 / 44%), transparent 85%),
    linear-gradient(180deg, #0c1626, #15263b 72%, #2a3947);
}
canvas {
  position: absolute;
  left: 50%;
  top: 50%;
  max-width: none;
  transform: translate(-50%, -50%);
  /* Accelerated long-exposure sky: one rigid rotation, no per-frame JS or painting. */
  animation: sidereal-turn 600s linear infinite;
}
.star-trails-background::after {
  content: '';
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse at 50% 50%, transparent 24%, rgb(4 10 18 / 18%) 100%),
    linear-gradient(0deg, rgb(7 13 20 / 32%), transparent 30%);
}
.mountain-foreground {
  position: absolute;
  z-index: 1;
  inset: auto 0 0;
  height: 25%;
  max-height: 240px;
  background: url('../../../assets/svg/common/star-trails-mountains.svg') center bottom / 100% 100%
    no-repeat;
}
@keyframes sidereal-turn {
  from {
    transform: translate(-50%, -50%) rotate(0deg);
  }
  to {
    transform: translate(-50%, -50%) rotate(-360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  canvas {
    animation: none;
  }
}
</style>
