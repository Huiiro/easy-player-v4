<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import rainyImage from '@/assets/img/rainy_bg.jpg'
import { rainyFragmentShader, rainyVertexShader } from '@/shaders/rainyShader'

const props = withDefaults(defineProps<{ paused?: boolean }>(), { paused: false })
const canvas = ref<HTMLCanvasElement | null>(null)
const ready = ref(false)
let gl: WebGL2RenderingContext | null = null
let program: WebGLProgram | null = null
let buffer: WebGLBuffer | null = null
let texture: WebGLTexture | null = null
let image: HTMLImageElement | null = null
let observer: ResizeObserver | null = null
let motion: MediaQueryList | null = null
let frame = 0
let lastFrame = 0
let elapsed = 0
let disposed = false

function compile(type: number, source: string): WebGLShader | null {
  if (!gl) return null
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[RainyBackground] Shader compilation failed:', gl.getShaderInfoLog(shader))
    gl.deleteShader(shader)
    return null
  }
  return shader
}

function stop(): void {
  cancelAnimationFrame(frame)
  frame = 0
  lastFrame = 0
}

function release(): void {
  stop()
  if (gl && !gl.isContextLost()) {
    gl.deleteTexture(texture)
    gl.deleteBuffer(buffer)
    gl.deleteProgram(program)
  }
  texture = null
  buffer = null
  program = null
  ready.value = false
}

function resize(): void {
  const element = canvas.value
  if (!element) return
  const bounds = element.getBoundingClientRect()
  const scale = Math.min(
    window.devicePixelRatio || 1,
    1.25,
    1200 / Math.max(bounds.width, bounds.height, 1)
  )
  const width = Math.max(1, Math.floor(bounds.width * scale))
  const height = Math.max(1, Math.floor(bounds.height * scale))
  if (element.width !== width || element.height !== height) {
    element.width = width
    element.height = height
  }
  draw()
}

function draw(): void {
  if (!gl || !program || !canvas.value || !image || !ready.value || gl.isContextLost()) return
  gl.viewport(0, 0, canvas.value.width, canvas.value.height)
  gl.uniform2f(
    gl.getUniformLocation(program, 'u_resolution'),
    canvas.value.width,
    canvas.value.height
  )
  gl.uniform2f(
    gl.getUniformLocation(program, 'u_imageSize'),
    image.naturalWidth,
    image.naturalHeight
  )
  gl.uniform1f(gl.getUniformLocation(program, 'u_time'), elapsed)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
}

function inactive(): boolean {
  return props.paused || document.hidden || !document.hasFocus() || !!motion?.matches
}

function tick(now: number): void {
  frame = 0
  if (inactive() || !ready.value) return
  if (!lastFrame || now - lastFrame >= 1000 / 30) {
    elapsed += lastFrame ? Math.min((now - lastFrame) / 1000, 0.1) : 0
    lastFrame = now
    draw()
  }
  frame = requestAnimationFrame(tick)
}

function syncAnimation(): void {
  stop()
  if (ready.value && !inactive()) frame = requestAnimationFrame(tick)
  else draw()
}

function initialize(): void {
  const element = canvas.value
  if (!element || !image?.complete || !image.naturalWidth || disposed) return
  release()
  gl = element.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power'
  })
  if (!gl || gl.isContextLost()) return
  const vertex = compile(gl.VERTEX_SHADER, rainyVertexShader)
  const fragment = compile(gl.FRAGMENT_SHADER, rainyFragmentShader)
  if (!vertex || !fragment) {
    if (vertex) gl.deleteShader(vertex)
    if (fragment) gl.deleteShader(fragment)
    return
  }
  program = gl.createProgram()
  if (!program) return
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[RainyBackground] Program link failed:', gl.getProgramInfoLog(program))
    release()
    return
  }
  buffer = gl.createBuffer()
  texture = gl.createTexture()
  if (!buffer || !texture) {
    release()
    return
  }
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'a_position')
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
  gl.generateMipmap(gl.TEXTURE_2D)
  gl.uniform1i(gl.getUniformLocation(program, 'u_image'), 0)
  ready.value = true
  resize()
  syncAnimation()
}

function contextLost(event: Event): void {
  event.preventDefault()
  release()
}

watch(() => props.paused, syncAnimation)
onMounted(() => {
  motion = window.matchMedia('(prefers-reduced-motion: reduce)')
  motion.addEventListener('change', syncAnimation)
  document.addEventListener('visibilitychange', syncAnimation)
  window.addEventListener('focus', syncAnimation)
  window.addEventListener('blur', syncAnimation)
  canvas.value?.addEventListener('webglcontextlost', contextLost)
  canvas.value?.addEventListener('webglcontextrestored', initialize)
  observer = new ResizeObserver(resize)
  if (canvas.value) observer.observe(canvas.value)
  image = new Image()
  image.onload = initialize
  image.src = rainyImage
})
onBeforeUnmount(() => {
  // The leaving DOM outlives the component during the background transition.
  // A lost WebGL context must never replace the street image with a blank frame.
  if (canvas.value) canvas.value.style.display = 'none'
  disposed = true
  observer?.disconnect()
  motion?.removeEventListener('change', syncAnimation)
  document.removeEventListener('visibilitychange', syncAnimation)
  window.removeEventListener('focus', syncAnimation)
  window.removeEventListener('blur', syncAnimation)
  canvas.value?.removeEventListener('webglcontextlost', contextLost)
  canvas.value?.removeEventListener('webglcontextrestored', initialize)
  if (image) image.onload = null
  release()
  gl?.getExtension('WEBGL_lose_context')?.loseContext()
  gl = null
  image = null
})
</script>

<template>
  <div class="rainy-background" aria-hidden="true">
    <canvas ref="canvas" :class="{ ready }" />
  </div>
</template>

<style scoped>
.rainy-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  contain: strict;
  background:
    linear-gradient(rgb(15 19 30 / 15%), rgb(9 15 24 / 28%)),
    url('@/assets/img/rainy_bg.jpg') center / cover,
    #0f131e;
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
