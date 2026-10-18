<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(defineProps<{ paused?: boolean }>(), { paused: false })
const horizon = 560
const sunX = 980
const water = ref<HTMLCanvasElement | null>(null)
let context: CanvasRenderingContext2D | null = null
let observer: ResizeObserver | null = null
let motion: MediaQueryList | null = null
let glint: HTMLCanvasElement | null = null
let width = 1
let height = 1
let frame = 0
let lastFrame = 0
let elapsed = 0

// All geometry and light profiles are cached. Only the bounded water surface
// is redrawn (at most 20 fps); scenery and small CSS animations stay separate.
const glints = Array.from({ length: 112 }, (_, index) => ({
  depth: (index * 0.61803398875) % 1,
  offset: Math.sin(index * 127.1) * 0.5,
  length: 0.3 + ((index * 37) % 71) / 100,
  phase: index * 2.399963,
  speed: 0.65 + ((index * 13) % 17) / 20
}))
const ripples = Array.from({ length: 28 }, (_, index) => ({
  x: ((index * 137 + 31) % 1440) / 1440,
  depth: ((index * 43 + 19) % 300) / 300,
  length: 0.012 + ((index * 19) % 78) / 2500,
  phase: index * 1.71
}))
const birds = [
  { x: '0%', y: '4px', size: '30px', delay: '-0.4s', duration: '1.8s' },
  { x: '41%', y: '20px', size: '23px', delay: '-1.1s', duration: '2.1s' },
  { x: '76%', y: '0px', size: '20px', delay: '-0.7s', duration: '1.6s' }
]

function createGlint(): HTMLCanvasElement {
  const sprite = document.createElement('canvas')
  sprite.width = 64
  sprite.height = 8
  const ctx = sprite.getContext('2d')
  if (!ctx) return sprite
  const light = ctx.createLinearGradient(0, 0, 64, 0)
  light.addColorStop(0, 'rgba(255,204,146,0)')
  light.addColorStop(0.22, 'rgba(255,204,146,0.45)')
  light.addColorStop(0.5, 'rgba(255,224,175,0.95)')
  light.addColorStop(0.78, 'rgba(255,204,146,0.45)')
  light.addColorStop(1, 'rgba(255,204,146,0)')
  ctx.fillStyle = light
  ctx.fillRect(0, 0, 64, 8)
  ctx.globalCompositeOperation = 'destination-in'
  const edge = ctx.createLinearGradient(0, 0, 0, 8)
  edge.addColorStop(0, 'transparent')
  edge.addColorStop(0.5, '#000')
  edge.addColorStop(1, 'transparent')
  ctx.fillStyle = edge
  ctx.fillRect(0, 0, 64, 8)
  return sprite
}

function drawWater(): void {
  if (!context || !glint) return
  context.clearRect(0, 0, width, height)
  const center = (sunX / 1440) * width
  for (const light of glints) {
    const depth = (light.depth + elapsed * 0.008) % 1
    const spread = width * (0.018 + Math.pow(depth, 0.85) * 0.115)
    const x =
      center +
      light.offset * spread * 2 +
      Math.sin(elapsed * 0.55 * light.speed + light.phase) * spread * 0.12
    const y = Math.pow(depth, 1.65) * height
    const length =
      width *
      (0.006 + depth * 0.032) *
      light.length *
      (0.85 + Math.sin(elapsed * 0.75 + light.phase) * 0.15)
    const fade = Math.min(1, depth * 30) * Math.pow(1 - depth, 1.4)
    const shimmer = 0.5 + 0.5 * Math.sin(elapsed * light.speed + light.phase)
    context.globalAlpha = fade * (0.24 + shimmer * 0.58)
    context.drawImage(glint, x - length / 2, y, length, 1.1 + depth * 2.5)
  }
  for (const ripple of ripples) {
    const depth = ripple.depth
    const x = ((ripple.x * width + elapsed * 0.6 * (0.3 + depth)) % (width + 40)) - 20
    const y = depth * height + Math.sin(elapsed * 0.6 + ripple.phase) * 1.5
    context.globalAlpha = 0.025 + (0.5 + 0.5 * Math.sin(elapsed * 0.6 + ripple.phase)) * 0.06
    context.drawImage(glint, x, y, ripple.length * width, 1 + depth)
  }
  context.globalAlpha = 1
}

function resize(): void {
  const element = water.value
  if (!element) return
  const bounds = element.getBoundingClientRect()
  const scale = Math.min(
    1,
    960 / Math.max(bounds.width, 1),
    300 / Math.max(bounds.height, 1),
    Math.sqrt(230_000 / Math.max(bounds.width * bounds.height, 1))
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
  drawWater()
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
  if (!lastFrame || now - lastFrame >= 1000 / 20) {
    elapsed += lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0
    lastFrame = now
    drawWater()
  }
  frame = requestAnimationFrame(tick)
}
function syncAnimation(): void {
  stop()
  if (!inactive()) frame = requestAnimationFrame(tick)
}
watch(() => props.paused, syncAnimation)
onMounted(() => {
  context = water.value?.getContext('2d') ?? null
  if (!context) return
  glint = createGlint()
  motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  motion.addEventListener('change', syncAnimation)
  document.addEventListener('visibilitychange', syncAnimation)
  window.addEventListener('focus', syncAnimation)
  window.addEventListener('blur', syncAnimation)
  observer = new ResizeObserver(resize)
  if (water.value) observer.observe(water.value)
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
  glint = null
  context = null
})
</script>

<template>
  <div
    class="sunset-background"
    :class="{ 'is-paused': paused }"
    :style="{ '--horizon': `${horizon / 9}%`, '--sun-x': `${sunX / 14.4}%` }"
    aria-hidden="true"
  >
    <span class="sunset-sun" />
    <svg class="sunset-scenery" viewBox="0 0 1440 900" preserveAspectRatio="none">
      <defs>
        <linearGradient id="sunset-water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#a77d69" />
          <stop offset="0.2" stop-color="#6e6064" />
          <stop offset="1" stop-color="#232c3b" />
        </linearGradient>
        <linearGradient id="sunset-haze" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#f3c499" stop-opacity="0.17" />
          <stop offset="1" stop-color="#f3c499" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path fill="url(#sunset-water)" :d="`M0 ${horizon}H1440V900H0Z`" />
      <!-- Every mountain ends on the shared waterline, never on a diagonal. -->
      <path
        fill="#776c76"
        d="M0 560V531Q47 518 83 523L142 505 177 511 239 476 270 488 308 479 352 500 401 506 447 531Q499 542 574 552L610 560Z"
      />
      <path
        fill="#7b6c73"
        d="M1060 560 1119 541 1160 525 1208 529 1256 502 1300 514 1348 490 1390 503 1440 487V560Z"
      />

      <path fill="url(#sunset-haze)" :d="`M0 ${horizon}H1440V587H0Z`" />
    </svg>
    <canvas ref="water" class="sunset-water" />
    <!-- Near land occludes both water and horizon haze; its fill stays opaque. -->
    <svg
      class="sunset-near-mountains"
      viewBox="0 0 1440 900"
      preserveAspectRatio="none"
      fill="#575563"
    >
      <path
        d="M0 566V550L72 539 134 550 187 530 232 539 284 523 322 536 365 532 431 551 480 555 537 562 575 566Z"
      />
      <path d="M1190 567 1260 551 1312 556 1370 539 1440 547V567Z" />
    </svg>
    <div class="sunset-boat">
      <svg viewBox="0 0 64 85" class="sunset-boat__rock" fill="#262d38" stroke-linejoin="round">
        <path d="M9 65h46l-8 6H17Z" />
        <path d="M32 63V9" fill="none" stroke="#31333c" stroke-width="1.5" />
        <path d="M29 15 8 58h21Z" fill="#e8c8a5" />
        <path d="m35 24 17 34H35Z" fill="#bca594" />
        <path d="M17 77h30m-25 4h20" opacity="0.2" fill="none" stroke="#262d38" />
      </svg>
    </div>
    <svg class="sunset-clouds" viewBox="0 0 1000 100" preserveAspectRatio="none">
      <path
        fill="#d4a698"
        opacity="0.24"
        d="M0 35Q110 17 190 30T390 24Q310 39 210 38T0 35M540 67Q640 45 740 58T1000 55Q880 71 740 68T540 67"
      />
      <path fill="#f3d3b6" opacity="0.19" d="M140 49Q230 40 340 46T530 42Q340 57 140 49" />
    </svg>
    <div class="sunset-flock">
      <svg
        v-for="(bird, index) in birds"
        :key="index"
        class="sunset-bird"
        :style="{
          left: bird.x,
          top: bird.y,
          width: bird.size,
          animationDelay: bird.delay,
          animationDuration: bird.duration
        }"
        viewBox="0 0 40 20"
        fill="none"
        stroke="#393d4c"
        stroke-width="1.6"
        stroke-linecap="round"
      >
        <path d="M2 6Q12 3 20 13 27 3 38 5" />
      </svg>
    </div>
    <svg class="sunset-shore" viewBox="0 0 1440 900" preserveAspectRatio="none">
      <path fill="#202a36" d="M0 824Q105 799 190 839T385 866Q462 888 552 900H0Z" />
      <path fill="#192431" d="M1120 900Q1202 872 1309 878T1440 852V900Z" />
      <g fill="none" stroke="#343741" stroke-width="2" stroke-linecap="round">
        <path
          d="M40 858q9-49 1-77m1 44q-9-24-22-29m23 13q12-26 23-31M100 854q-3-31 7-52m-6 40q-11-22-22-24M1400 883q-9-53-4-82m-1 50q-16-28-27-31m27 16q11-24 24-32"
        />
      </g>
    </svg>
  </div>
</template>

<style scoped>
.sunset-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
  background:
    radial-gradient(ellipse 46% 32% at 68% 60%, rgb(255 207 150 / 48%), transparent 85%),
    linear-gradient(180deg, #30394f, #826975 32%, #c58e7c 52%, #e4b48c 63%, #635c65);
}
.sunset-sun {
  position: absolute;
  top: var(--horizon);
  left: var(--sun-x);
  width: clamp(60px, 15vmin, 150px);
  aspect-ratio: 1;
  border-radius: 50%;
  transform: translate(-50%, -72%);
  background: linear-gradient(#ffe4ad, #f4b876);
}
.sunset-scenery,
.sunset-near-mountains,
.sunset-shore {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
.sunset-water {
  position: absolute;
  top: var(--horizon);
  width: 100%;
  height: calc(100% - var(--horizon));
}
.sunset-boat {
  position: absolute;
  left: 43%;
  top: 70%;
  width: clamp(30px, 4.2%, 62px);
  animation: sunset-sail 24s ease-in-out infinite alternate;
}
.sunset-boat__rock {
  display: block;
  width: 100%;
  transform-origin: 50% 80%;
  animation: sunset-rock 4.8s ease-in-out infinite;
}
.sunset-clouds {
  position: absolute;
  top: 31%;
  left: -4%;
  width: 108%;
  height: 16%;
  animation: sunset-cloud-drift 55s ease-in-out infinite alternate;
}
.sunset-flock {
  position: absolute;
  left: 27%;
  top: 28%;
  width: clamp(130px, 15%, 210px);
  height: 50px;
  animation: sunset-bird-glide 32s ease-in-out infinite alternate;
}
.sunset-bird {
  position: absolute;
  height: auto;
  opacity: 0.8;
  transform-origin: 50% 65%;
  animation: sunset-wing 1.8s ease-in-out infinite;
}
@keyframes sunset-sail {
  to {
    transform: translateX(24px);
  }
}
@keyframes sunset-rock {
  0%,
  100% {
    transform: translateY(0) rotate(-1.5deg);
  }
  50% {
    transform: translateY(2px) rotate(1.5deg);
  }
}
@keyframes sunset-cloud-drift {
  to {
    transform: translateX(6%);
  }
}
@keyframes sunset-bird-glide {
  to {
    transform: translate(130px, -22px);
  }
}
@keyframes sunset-wing {
  0%,
  100% {
    transform: scaleY(1);
  }
  50% {
    transform: scaleY(0.28);
  }
}
.is-paused * {
  animation-play-state: paused;
}
@media (prefers-reduced-motion: reduce) {
  .sunset-background * {
    animation: none;
  }
}
</style>
