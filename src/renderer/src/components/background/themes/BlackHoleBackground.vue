<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fragmentShader, vertexShader } from '@/shaders/blackHoleShader'
import {
  ORBIT_HEIGHT,
  ORBIT_WIDTH,
  type OrbitTables
} from '@/components/background/themes/blackHoleGeodesics'

interface GpuTimer {
  TIME_ELAPSED_EXT: number
  GPU_DISJOINT_EXT: number
}

const props = withDefaults(defineProps<{ paused?: boolean }>(), { paused: false })
const canvas = ref<HTMLCanvasElement | null>(null)
const ready = ref(false)
let gl: WebGL2RenderingContext | null = null
let program: WebGLProgram | null = null
let buffer: WebGLBuffer | null = null
let pathsTexture: WebGLTexture | null = null
let endsTexture: WebGLTexture | null = null
let resolution: WebGLUniformLocation | null = null
let time: WebGLUniformLocation | null = null
let pointer: WebGLUniformLocation | null = null
let timer: GpuTimer | null = null
let query: WebGLQuery | null = null
let worker: Worker | undefined
let tables: OrbitTables | undefined
let observer: ResizeObserver | undefined
let motion: MediaQueryList | undefined
let bounds: DOMRect | undefined
let frame = 0
let lastTick = 0
let lastDraw = 0
let elapsed = 0
let pixelBudget = 650_000
let drawCount = 0
let slowFrames = 0
let gpuAverage = 0
let lastQualityChange = 0
let disposed = false
const targetPointer = { x: 0, y: 0 }
const currentPointer = { x: 0, y: 0 }
const frameInterval = 1000 / 30

function stop(): void {
  cancelAnimationFrame(frame)
  frame = 0
  lastTick = 0
  lastDraw = 0
  slowFrames = 0
}

function releaseResources(): void {
  stop()
  if (gl && !gl.isContextLost()) {
    gl.deleteQuery(query)
    gl.deleteTexture(pathsTexture)
    gl.deleteTexture(endsTexture)
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
  }
  query = null
  pathsTexture = null
  endsTexture = null
  buffer = null
  program = null
  ready.value = false
}

function compile(type: number, source: string): WebGLShader | null {
  if (!gl) return null
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[BlackHole] Shader compilation failed:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function uploadTexture(
  unit: number,
  width: number,
  height: number,
  data: Float32Array
): WebGLTexture | null {
  if (!gl) return null
  const texture = gl.createTexture()
  if (!texture) return null
  gl.activeTexture(gl.TEXTURE0 + unit)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  // Manual interpolation in the shader avoids requiring float-linear extensions.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG32F, width, height, 0, gl.RG, gl.FLOAT, data)
  return texture
}

function sizeCanvas(): void {
  const element = canvas.value
  if (!element || !bounds) return
  const width = Math.max(1, bounds.width)
  const height = Math.max(1, bounds.height)
  const scale = Math.min(
    window.devicePixelRatio || 1,
    1.5,
    1600 / Math.max(width, height),
    Math.sqrt(pixelBudget / (width * height))
  )
  const nextWidth = Math.max(1, Math.floor(width * scale))
  const nextHeight = Math.max(1, Math.floor(height * scale))
  if (element.width !== nextWidth || element.height !== nextHeight) {
    element.width = nextWidth
    element.height = nextHeight
  }
}

function adjustQuality(milliseconds: number, now: number): void {
  gpuAverage = gpuAverage ? gpuAverage * 0.75 + milliseconds * 0.25 : milliseconds
  if (now - lastQualityChange < 4000) return
  const budget =
    gpuAverage > 18 ? pixelBudget * 0.8 : gpuAverage < 9 ? pixelBudget * 1.1 : pixelBudget
  const next = Math.max(200_000, Math.min(1_000_000, budget))
  if (Math.abs(next - pixelBudget) < 1) return
  pixelBudget = next
  lastQualityChange = now
  sizeCanvas()
}

function draw(now = performance.now()): void {
  if (!gl || !program || !ready.value || !canvas.value || gl.isContextLost()) return
  // Poll one outstanding GPU query without synchronizing CPU and GPU.
  if (query && timer && gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) {
    if (!gl.getParameter(timer.GPU_DISJOINT_EXT)) {
      adjustQuality(Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6, now)
    }
    gl.deleteQuery(query)
    query = null
  }
  const measure = timer && !query && drawCount++ % 20 === 0
  if (measure) {
    query = gl.createQuery()
    if (query) gl.beginQuery(timer!.TIME_ELAPSED_EXT, query)
  }
  gl.viewport(0, 0, canvas.value.width, canvas.value.height)
  gl.uniform2f(resolution, canvas.value.width, canvas.value.height)
  gl.uniform2f(pointer, currentPointer.x, currentPointer.y)
  gl.uniform1f(time, elapsed)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  if (measure && query) gl.endQuery(timer!.TIME_ELAPSED_EXT)
}

function inactive(): boolean {
  return props.paused || document.hidden || !document.hasFocus() || !!motion?.matches
}

function tick(now: number): void {
  frame = 0
  if (!ready.value || inactive()) return
  if (!lastTick || now - lastTick >= frameInterval) {
    const delta = lastDraw ? Math.min((now - lastDraw) / 1000, 0.1) : 0
    // A sustained slow RAF is a fallback signal on GPUs without timing queries.
    if (!timer && lastDraw) {
      slowFrames = now - lastDraw > 46 ? slowFrames + 1 : Math.max(0, slowFrames - 1)
      if (slowFrames >= 20) {
        adjustQuality(25, now)
        slowFrames = 0
      }
    }
    elapsed += delta
    const smoothing = 1 - Math.exp(-delta * 5)
    currentPointer.x += (targetPointer.x - currentPointer.x) * smoothing
    currentPointer.y += (targetPointer.y - currentPointer.y) * smoothing
    lastTick = now - (lastTick ? (now - lastTick) % frameInterval : 0)
    lastDraw = now
    draw(now)
  }
  frame = requestAnimationFrame(tick)
}

function syncAnimation(): void {
  stop()
  if (motion?.matches) {
    currentPointer.x = currentPointer.y = 0
    targetPointer.x = targetPointer.y = 0
    draw()
  }
  if (ready.value && !inactive()) frame = requestAnimationFrame(tick)
}

function resize(): void {
  if (!canvas.value) return
  bounds = canvas.value.getBoundingClientRect()
  sizeCanvas()
  draw()
}

function movePointer(event: PointerEvent): void {
  if (!bounds || inactive() || event.pointerType === 'touch') return
  targetPointer.x = Math.max(
    -1,
    Math.min(1, ((event.clientX - bounds.left) / Math.max(bounds.width, 1)) * 2 - 1)
  )
  targetPointer.y = Math.max(
    -1,
    Math.min(1, 1 - ((event.clientY - bounds.top) / Math.max(bounds.height, 1)) * 2)
  )
}

function resetPointer(): void {
  targetPointer.x = targetPointer.y = 0
}

function pointerOut(event: PointerEvent): void {
  if (!event.relatedTarget) resetPointer()
}

function initialize(): void {
  const element = canvas.value
  if (!element || !tables || disposed) return
  releaseResources()
  gl = element.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power'
  })
  if (!gl || gl.isContextLost()) return
  const vertex = compile(gl.VERTEX_SHADER, vertexShader)
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentShader)
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
    return
  }
  program = gl.createProgram()
  if (program) {
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
  }
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!program || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    releaseResources()
    return
  }
  buffer = gl.createBuffer()
  pathsTexture = uploadTexture(0, ORBIT_WIDTH, ORBIT_HEIGHT, tables.paths)
  endsTexture = uploadTexture(1, ORBIT_WIDTH, 1, tables.ends)
  if (!buffer || !pathsTexture || !endsTexture || gl.getError() !== gl.NO_ERROR) {
    releaseResources()
    return
  }
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  gl.uniform1i(gl.getUniformLocation(program, 'u_paths'), 0)
  gl.uniform1i(gl.getUniformLocation(program, 'u_ends'), 1)
  resolution = gl.getUniformLocation(program, 'u_resolution')
  time = gl.getUniformLocation(program, 'u_time')
  pointer = gl.getUniformLocation(program, 'u_pointer')
  timer = gl.getExtension('EXT_disjoint_timer_query_webgl2') as GpuTimer | null
  gpuAverage = 0
  ready.value = true
  resize()
  syncAnimation()
}

function contextLost(event: Event): void {
  event.preventDefault()
  releaseResources()
}

watch(() => props.paused, syncAnimation)
onMounted(() => {
  motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  motion.addEventListener('change', syncAnimation)
  document.addEventListener('visibilitychange', syncAnimation)
  window.addEventListener('focus', syncAnimation)
  window.addEventListener('blur', syncAnimation)
  // Observe window-level movement without intercepting clicks on player controls.
  window.addEventListener('pointermove', movePointer, { passive: true })
  window.addEventListener('pointerout', pointerOut, { passive: true })
  window.addEventListener('blur', resetPointer)
  canvas.value?.addEventListener('webglcontextlost', contextLost)
  canvas.value?.addEventListener('webglcontextrestored', initialize)
  observer = new ResizeObserver(resize)
  if (canvas.value) observer.observe(canvas.value)
  worker = new Worker(new URL('./blackHole.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<OrbitTables>): void => {
    tables = event.data
    worker?.terminate()
    worker = undefined
    initialize()
  }
  worker.onerror = (event): void => {
    console.warn('[BlackHole] Orbit worker failed:', event.message)
    worker?.terminate()
    worker = undefined
  }
  worker.postMessage(null)
})
onBeforeUnmount(() => {
  disposed = true
  worker?.terminate()
  observer?.disconnect()
  motion?.removeEventListener('change', syncAnimation)
  document.removeEventListener('visibilitychange', syncAnimation)
  window.removeEventListener('focus', syncAnimation)
  window.removeEventListener('blur', syncAnimation)
  window.removeEventListener('pointermove', movePointer)
  window.removeEventListener('pointerout', pointerOut)
  window.removeEventListener('blur', resetPointer)
  canvas.value?.removeEventListener('webglcontextlost', contextLost)
  canvas.value?.removeEventListener('webglcontextrestored', initialize)
  releaseResources()
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
  gl = null
  tables = undefined
})
</script>

<template>
  <div class="black-hole-background" aria-hidden="true">
    <canvas ref="canvas" :class="{ ready }" />
  </div>
</template>

<style scoped>
.black-hole-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
  /* Static fallback while the worker starts, or when WebGL2 is unavailable/lost. */
  background:
    radial-gradient(circle at 50% 50%, #04040a 0 12%, transparent 12.8%),
    radial-gradient(ellipse at 50% 50%, transparent 17%, #e8b780 19%, #805034 22%, transparent 34%),
    radial-gradient(circle at 50% 50%, transparent 13%, #e0ad79 14%, #332336 18%, transparent 36%),
    #090914;
}

canvas {
  display: block;
  width: 100%;
  height: 100%;
  opacity: 0;
}

canvas.ready {
  opacity: 1;
}
</style>
