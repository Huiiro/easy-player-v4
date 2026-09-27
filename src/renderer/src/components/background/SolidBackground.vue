<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import vertexSource from '@/shaders/vertexSource.glsl?raw'
import fragmentSource from '@/shaders/solidSource.glsl?raw'

const props = defineProps<{ primary: string; active: boolean; reducedMotion: boolean }>()
const canvas = ref<HTMLCanvasElement>()
const available = ref(false)
const fallbackStyle = computed(() => ({
  '--solid-color': /^\d+\s+\d+\s+\d+$/.test(props.primary.trim())
    ? `rgb(${props.primary})`
    : props.primary
}))
let gl: WebGLRenderingContext | null = null
let program: WebGLProgram | null = null
let buffer: WebGLBuffer | null = null
let observer: ResizeObserver | undefined
let resizeTimer: ReturnType<typeof setTimeout> | undefined
let frame = 0
let lastFrame = 0
let colorUniform: WebGLUniformLocation | null = null
let resolutionUniform: WebGLUniformLocation | null = null

function parseColor(value: string): number[] {
  const channels = value.trim().split(/\s+/).map(Number)
  if (channels.length === 3 && channels.every(Number.isFinite))
    return channels.map((channel) => Math.max(0, Math.min(255, channel)) / 255)
  // Resolve theme CSS colors (including oklch) only when the palette changes.
  const context = document.createElement('canvas').getContext('2d')
  if (!context) return [0.3, 0.53, 0.86]
  context.fillStyle = '#4d88dc'
  context.fillStyle = value
  context.fillRect(0, 0, 1, 1)
  return Array.from(context.getImageData(0, 0, 1, 1).data)
    .slice(0, 3)
    .map((channel) => channel / 255)
}
let targetColor = parseColor(props.primary)
let currentColor = [...targetColor]

function stop(): void {
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  lastFrame = 0
}

function draw(now: number): void {
  frame = 0
  if (!gl || !program || !available.value || document.hidden) return
  // Render continuously only while fading to a new song color, then go idle.
  const changingColor = currentColor.some(
    (channel, i) => Math.abs(channel - targetColor[i]) > 1 / 255
  )
  const animate = props.active && !props.reducedMotion && changingColor
  if (animate && lastFrame && now - lastFrame < 1000 / 30 - 0.5) {
    frame = requestAnimationFrame(draw)
    return
  }
  const elapsed = lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 1 / 30
  lastFrame = now
  const blend = animate ? 1 - Math.exp(-elapsed * 2.4) : 1
  currentColor = currentColor.map((channel, i) => channel + (targetColor[i] - channel) * blend)
  gl.useProgram(program)
  gl.uniform3fv(colorUniform, currentColor)
  gl.uniform2f(resolutionUniform, gl.drawingBufferWidth, gl.drawingBufferHeight)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  if (animate) frame = requestAnimationFrame(draw)
  else lastFrame = 0
}

function start(): void {
  if (!frame && available.value && !document.hidden) frame = requestAnimationFrame(draw)
}

function resize(): void {
  if (!canvas.value || !gl) return
  const { width, height } = canvas.value.getBoundingClientRect()
  if (width <= 0 || height <= 0) return
  // Soft lighting needs no native-resolution framebuffer, even on 4K displays.
  const scale = Math.min(
    0.85,
    Math.sqrt(650_000 / (width * height)),
    1280 / Math.max(width, height)
  )
  canvas.value.width = Math.max(1, Math.round(width * scale))
  canvas.value.height = Math.max(1, Math.round(height * scale))
  gl.viewport(0, 0, canvas.value.width, canvas.value.height)
  start()
}

function release(): void {
  stop()
  available.value = false
  if (gl && buffer) gl.deleteBuffer(buffer)
  if (gl && program) gl.deleteProgram(program)
  buffer = null
  program = null
}

function init(): void {
  release()
  const target = canvas.value
  if (!target) return
  gl = target.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false
  })
  if (!gl) return
  const compile = (type: number, source: string): WebGLShader | null => {
    const shader = gl!.createShader(type)
    if (!shader) return null
    gl!.shaderSource(shader, source)
    gl!.compileShader(shader)
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
      gl!.deleteShader(shader)
      return null
    }
    return shader
  }
  const vertex = compile(gl.VERTEX_SHADER, vertexSource)
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource)
  if (vertex && fragment) {
    program = gl.createProgram()
    if (program) {
      gl.attachShader(program, vertex)
      gl.attachShader(program, fragment)
      gl.linkProgram(program)
    }
  }
  if (vertex) gl.deleteShader(vertex)
  if (fragment) gl.deleteShader(fragment)
  if (!program || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    release()
    return
  }
  buffer = gl.createBuffer()
  const position = gl.getAttribLocation(program, 'a_position')
  if (!buffer || position < 0) {
    release()
    return
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  colorUniform = gl.getUniformLocation(program, 'u_color')
  resolutionUniform = gl.getUniformLocation(program, 'u_resolution')
  available.value = true
  resize()
}

function contextLost(event: Event): void {
  event.preventDefault()
  stop()
  available.value = false
}
function visibilityChanged(): void {
  stop()
  start()
}

watch(
  () => props.primary,
  (value) => {
    targetColor = parseColor(value)
    start()
  }
)
watch(
  () => [props.active, props.reducedMotion],
  () => {
    stop()
    start()
  }
)
onMounted(() => {
  canvas.value?.addEventListener('webglcontextlost', contextLost)
  canvas.value?.addEventListener('webglcontextrestored', init)
  document.addEventListener('visibilitychange', visibilityChanged)
  init()
  observer = new ResizeObserver(() => {
    clearTimeout(resizeTimer)
    resizeTimer = setTimeout(resize, 100)
  })
  if (canvas.value) observer.observe(canvas.value)
})
onBeforeUnmount(() => {
  // Vue keeps the leaving DOM until its parent transition finishes. Hide the
  // canvas synchronously before clearing it; reactive styles no longer update
  // once this component is unmounted, so the material fallback must take over.
  if (canvas.value) canvas.value.style.display = 'none'
  observer?.disconnect()
  clearTimeout(resizeTimer)
  canvas.value?.removeEventListener('webglcontextlost', contextLost)
  canvas.value?.removeEventListener('webglcontextrestored', init)
  document.removeEventListener('visibilitychange', visibilityChanged)
  release()
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
  gl = null
  if (canvas.value) canvas.value.width = canvas.value.height = 1
})
</script>

<template>
  <div
    class="solid-background absolute inset-0 pointer-events-none"
    :style="fallbackStyle"
    aria-hidden="true"
  >
    <canvas
      ref="canvas"
      class="absolute inset-0 size-full"
      :style="{ opacity: available ? 1 : 0 }"
    />
  </div>
</template>

<style scoped>
.solid-background {
  background: color-mix(in srgb, var(--solid-color) 16%, #181e20);
}
</style>
