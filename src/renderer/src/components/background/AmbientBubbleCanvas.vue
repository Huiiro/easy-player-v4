<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    primary: string
    secondary: string
    tertiary: string
    active?: boolean
    bubblesEnabled?: boolean
    reducedMotion?: boolean
    energy?: number
    beatSequence?: number
    intensity?: number
  }>(),
  {
    active: false,
    bubblesEnabled: true,
    reducedMotion: false,
    energy: 0,
    beatSequence: 0,
    intensity: 0.7
  }
)

interface Bubble {
  x: number
  y: number
  radius: number
  velocityX: number
  velocityY: number
  phase: number
  wobble: number
  opacity: number
  popY: number
  popProgress: number
  colorIndex: number
  highlightAngle: number
  highlightScale: number
  highlightStrength: number
  state: 'rising' | 'popping'
}

const canvasRef = ref<HTMLCanvasElement>()
let context: CanvasRenderingContext2D | null = null
let resizeObserver: ResizeObserver | undefined
let animationFrame = 0
let lastFrameAt = 0
let elapsed = 0
let width = 0
let height = 0
let dpr = 1
let noisePattern: CanvasPattern | null = null
const bubbles: Bubble[] = []

function parseColor(value: string): [number, number, number] {
  const parts = value
    .match(/[\d.]+/g)
    ?.slice(0, 3)
    .map(Number)
  return parts?.length === 3 ? [parts[0], parts[1], parts[2]] : [110, 160, 220]
}

function colorAt(index: number): [number, number, number] {
  return [parseColor(props.primary), parseColor(props.secondary), parseColor(props.tertiary)][
    index % 3
  ]
}

function resetBubble(bubble: Bubble, initial = false): void {
  const radius = 5 + Math.random() * 12
  bubble.x = width * (0.04 + Math.random() * 0.92)
  bubble.y = initial ? Math.random() * height : height + radius * 2
  bubble.radius = radius
  bubble.velocityX = (Math.random() - 0.5) * 5
  bubble.velocityY = 11 + Math.random() * 12
  bubble.phase = Math.random() * Math.PI * 2
  bubble.wobble = 5 + Math.random() * 14
  bubble.opacity = 0.07 + Math.random() * 0.1
  bubble.popY = height * (0.12 + Math.random() * 0.58)
  bubble.popProgress = 0
  bubble.colorIndex = Math.floor(Math.random() * 3)
  bubble.highlightAngle = Math.PI * (1.08 + Math.random() * 0.48)
  bubble.highlightScale = 0.7 + Math.random() * 0.7
  bubble.highlightStrength = 0.65 + Math.random() * 0.75
  bubble.state = 'rising'
}

function createBubbles(): void {
  bubbles.length = 0
  const count = Math.max(10, Math.min(18, Math.round((width * height) / 65000)))
  for (let index = 0; index < count; index += 1) {
    const bubble = {} as Bubble
    resetBubble(bubble, true)
    bubbles.push(bubble)
  }
}

function createNoisePattern(): void {
  if (!context) return
  const noise = document.createElement('canvas')
  noise.width = 128
  noise.height = 128
  const noiseContext = noise.getContext('2d')
  if (!noiseContext) return
  const image = noiseContext.createImageData(noise.width, noise.height)
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const value = 224 + Math.floor(Math.random() * 24)
    image.data[offset] = value
    image.data[offset + 1] = value
    image.data[offset + 2] = value
    image.data[offset + 3] = Math.random() > 0.72 ? 2 : 0
  }
  noiseContext.putImageData(image, 0, 0)
  noisePattern = context.createPattern(noise, 'repeat')
}

function resize(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const bounds = canvas.getBoundingClientRect()
  width = Math.max(1, bounds.width)
  height = Math.max(1, bounds.height)
  dpr = Math.min(window.devicePixelRatio || 1, 1.5)
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  context = canvas.getContext('2d', { alpha: true })
  context?.setTransform(dpr, 0, 0, dpr, 0, 0)
  createNoisePattern()
  createBubbles()
  draw()
}

function drawGlow(
  x: number,
  y: number,
  radius: number,
  scaleX: number,
  scaleY: number,
  color: [number, number, number],
  opacity: number
): void {
  if (!context) return
  context.save()
  context.translate(x, y)
  context.scale(scaleX, scaleY)
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, radius)
  gradient.addColorStop(0, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${opacity})`)
  gradient.addColorStop(0.34, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${opacity * 0.78})`)
  gradient.addColorStop(0.7, `rgba(${color[0]}, ${color[1]}, ${color[2]}, ${opacity * 0.2})`)
  gradient.addColorStop(1, `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0)`)
  context.fillStyle = gradient
  context.fillRect(-radius, -radius, radius * 2, radius * 2)
  context.restore()
}

function drawBubble(bubble: Bubble): void {
  if (!context) return
  const [red, green, blue] = colorAt(bubble.colorIndex)
  if (bubble.state === 'popping') {
    const progress = bubble.popProgress
    const alpha = (1 - progress) * bubble.opacity * 1.7
    context.strokeStyle = `rgba(${red}, ${green}, ${blue}, ${alpha})`
    context.lineWidth = Math.max(0.7, 1.4 * (1 - progress))
    context.beginPath()
    context.arc(bubble.x, bubble.y, bubble.radius * (1 + progress * 1.8), 0, Math.PI * 2)
    context.stroke()
    for (let index = 0; index < 6; index += 1) {
      const angle = bubble.phase + (Math.PI * 2 * index) / 6
      const distance = bubble.radius * progress * 2.4
      context.fillStyle = `rgba(${red}, ${green}, ${blue}, ${alpha * 0.8})`
      context.beginPath()
      context.arc(
        bubble.x + Math.cos(angle) * distance,
        bubble.y + Math.sin(angle) * distance,
        Math.max(0.6, bubble.radius * 0.09 * (1 - progress)),
        0,
        Math.PI * 2
      )
      context.fill()
    }
    return
  }

  const gradient = context.createRadialGradient(
    bubble.x + Math.cos(bubble.highlightAngle) * bubble.radius * 0.42,
    bubble.y + Math.sin(bubble.highlightAngle) * bubble.radius * 0.42,
    bubble.radius * 0.04,
    bubble.x,
    bubble.y,
    bubble.radius
  )
  gradient.addColorStop(0, `rgba(255, 255, 255, ${bubble.opacity * bubble.highlightStrength})`)
  gradient.addColorStop(
    Math.min(0.3, 0.11 * bubble.highlightScale),
    `rgba(255, 255, 255, ${bubble.opacity * 0.2})`
  )
  gradient.addColorStop(0.72, `rgba(${red}, ${green}, ${blue}, ${bubble.opacity * 0.05})`)
  gradient.addColorStop(1, `rgba(${red}, ${green}, ${blue}, ${bubble.opacity * 0.16})`)
  context.fillStyle = gradient
  context.strokeStyle = `rgba(${red}, ${green}, ${blue}, ${bubble.opacity * 1.05})`
  context.lineWidth = 0.7
  context.beginPath()
  context.arc(bubble.x, bubble.y, bubble.radius, 0, Math.PI * 2)
  context.fill()
  context.stroke()
}

function update(deltaSeconds: number): void {
  const energy = Math.max(0, Math.min(1, props.energy))
  for (const bubble of bubbles) {
    if (bubble.state === 'popping') {
      bubble.popProgress += deltaSeconds / 0.48
      if (bubble.popProgress >= 1) resetBubble(bubble)
      continue
    }
    bubble.phase += deltaSeconds * (0.42 + energy * 0.16)
    bubble.y -= bubble.velocityY * deltaSeconds * (1 + energy * 0.22)
    bubble.x += (bubble.velocityX + Math.sin(bubble.phase) * bubble.wobble) * deltaSeconds * 0.34
    if (bubble.y <= bubble.popY || bubble.x < -bubble.radius || bubble.x > width + bubble.radius) {
      bubble.state = 'popping'
      bubble.popProgress = 0
    }
  }
}

function draw(): void {
  if (!context || !width || !height) return
  context.clearRect(0, 0, width, height)
  const energy = Math.max(0, Math.min(1, props.energy))
  const strength = props.intensity * (1 + energy * 0.18)
  const colors = [
    parseColor(props.primary),
    parseColor(props.secondary),
    parseColor(props.tertiary)
  ]
  const drift = props.reducedMotion ? 0 : elapsed
  context.globalCompositeOperation = 'screen'
  drawGlow(
    width * (0.18 + Math.sin(drift * 0.07) * 0.025),
    height * 0.2,
    Math.max(width, height) * 0.46,
    1.08,
    0.74,
    colors[0],
    0.23 * strength
  )
  drawGlow(
    width * (0.82 + Math.cos(drift * 0.055) * 0.025),
    height * 0.76,
    Math.max(width, height) * 0.5,
    1.05,
    0.78,
    colors[1],
    0.21 * strength
  )
  drawGlow(
    width * 0.57,
    height * (0.12 + Math.sin(drift * 0.045) * 0.035),
    Math.max(width, height) * 0.38,
    1.2,
    0.66,
    colors[2],
    0.17 * strength
  )
  context.globalCompositeOperation = 'source-over'
  if (props.bubblesEnabled) {
    for (const bubble of bubbles) drawBubble(bubble)
  }
  if (noisePattern) {
    context.globalAlpha = 0.12
    context.fillStyle = noisePattern
    context.fillRect(0, 0, width, height)
    context.globalAlpha = 1
  }
}

function animate(timestamp: number): void {
  animationFrame = 0
  if (!props.active || props.reducedMotion || !props.bubblesEnabled) {
    draw()
    return
  }
  if (timestamp - lastFrameAt < 1000 / 30) {
    animationFrame = requestAnimationFrame(animate)
    return
  }
  const deltaSeconds = Math.min(0.05, Math.max(0, (timestamp - (lastFrameAt || timestamp)) / 1000))
  lastFrameAt = timestamp
  elapsed += deltaSeconds
  update(deltaSeconds)
  draw()
  animationFrame = requestAnimationFrame(animate)
}

function startAnimation(): void {
  if (animationFrame) cancelAnimationFrame(animationFrame)
  animationFrame = 0
  lastFrameAt = 0
  if (props.active && props.bubblesEnabled && !props.reducedMotion)
    animationFrame = requestAnimationFrame(animate)
  else draw()
}

watch(() => [props.active, props.bubblesEnabled, props.reducedMotion], startAnimation)
watch(() => [props.primary, props.secondary, props.tertiary, props.intensity], draw)
watch(
  () => props.beatSequence,
  () => {
    if (!props.active || !props.bubblesEnabled || props.reducedMotion || props.energy < 0.34) return
    const candidate = bubbles.find(
      (bubble) => bubble.state === 'rising' && bubble.y < height * 0.72
    )
    if (candidate) {
      candidate.state = 'popping'
      candidate.popProgress = 0
    }
  }
)

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(canvas)
  resize()
  startAnimation()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  if (animationFrame) cancelAnimationFrame(animationFrame)
})
</script>

<template>
  <canvas ref="canvasRef" class="ambient-bubble-canvas" aria-hidden="true" />
</template>

<style scoped>
.ambient-bubble-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
</style>
