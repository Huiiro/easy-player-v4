<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import fragmentSource from '@/shaders/fragmentSource.glsl?raw'
import vertexSource from '@/shaders/vertexSource.glsl?raw'

const props = defineProps<{
  primary: string
  secondary: string
  tertiary: string
  coverSrc: string | null
  energy: number
  bass: number
  beat: number
  active: boolean
  reducedMotion: boolean
  debug?: boolean
}>()
const emit = defineEmits<{
  unavailable: []
  debug: [
    state: {
      width: number
      height: number
      time: number
      flowSpeed: number
      warpStrength: number
      beat: number
    }
  ]
}>()

const canvas = ref<HTMLCanvasElement>()
let gl: WebGLRenderingContext | null = null
let program: WebGLProgram | null = null
let frame = 0,
  lastFrameAt = 0,
  lastAnimationAt = 0,
  startedAt = 0,
  lastDebugAt = 0
let resizeObserver: ResizeObserver | undefined
let resizeTimer: number | undefined
let coverTexture: WebGLTexture | null = null
let blurredCoverTexture: WebGLTexture | null = null
let coverTargetLoaded = false
let coverFade = 0
let coverLoadToken = 0
let smoothedEnergy = 0
let smoothedBass = 0
let beatEnvelope = 0
let drawingWidth = 0
let drawingHeight = 0

let uniforms: {
  resolution: WebGLUniformLocation | null
  time: WebGLUniformLocation | null
  energy: WebGLUniformLocation | null
  bass: WebGLUniformLocation | null
  beat: WebGLUniformLocation | null
  colorA: WebGLUniformLocation | null
  colorB: WebGLUniformLocation | null
  colorC: WebGLUniformLocation | null
  cover: WebGLUniformLocation | null
  coverBlurred: WebGLUniformLocation | null
  coverLoaded: WebGLUniformLocation | null
} | null = null

function colour(value: string): [number, number, number] {
  const fallback: [number, number, number] = [77, 136, 220]
  const hex = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/i)
  const values = hex
    ? hex[1].length === 3
      ? hex[1].split('').map((channel) => Number.parseInt(channel + channel, 16))
      : [hex[1].slice(0, 2), hex[1].slice(2, 4), hex[1].slice(4, 6)].map((channel) =>
          Number.parseInt(channel, 16)
        )
    : value.split(/\s+/).map(Number)
  const [r, g, b] = values
  const channels = [r, g, b].every((channel) => Number.isFinite(channel)) ? [r, g, b] : fallback
  return channels.map((channel) => Math.max(0, Math.min(255, channel)) / 255) as [
    number,
    number,
    number
  ]
}

function loadCover(source: string | null): void {
  if (!gl || !coverTexture || !blurredCoverTexture) return
  const token = ++coverLoadToken
  coverTargetLoaded = false
  if (!source) {
    coverFade = 0
    return
  }
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.onload = () => {
    if (!gl || !coverTexture || !blurredCoverTexture || token !== coverLoadToken) return
    try {
      gl.bindTexture(gl.TEXTURE_2D, coverTexture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
      const size = 128
      const overscan = 16
      const c = document.createElement('canvas')
      c.width = size
      c.height = size

      const ctx = c.getContext('2d')
      if (ctx) {
        ctx.fillStyle = '#10141c'
        ctx.fillRect(0, 0, size, size)
        ctx.filter = 'blur(15px) saturate(1.25)'
        ctx.drawImage(image, -overscan, -overscan, size + overscan * 2, size + overscan * 2)
        ctx.filter = 'none'
        gl.bindTexture(gl.TEXTURE_2D, blurredCoverTexture)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c)
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
      }
      coverFade = 0
      coverTargetLoaded = true
    } catch (error) {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
      coverTargetLoaded = false
      console.warn('[FluidBackground] Unable to upload cover texture', error)
    }
  }
  image.onerror = () => {
    if (token === coverLoadToken) coverTargetLoaded = false
  }
  image.src = source
}

function applyResize(): void {
  if (!canvas.value || !gl) return
  const rect = canvas.value.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return
  const dpr = window.devicePixelRatio || 1
  const scale = Math.min(dpr, 1.15) * 0.82
  const width = Math.max(1, Math.round(rect.width * scale))
  const height = Math.max(1, Math.round(rect.height * scale))
  if (canvas.value.width === width && canvas.value.height === height) return
  canvas.value.width = width
  canvas.value.height = height
  drawingWidth = width
  drawingHeight = height
  gl.viewport(0, 0, width, height)
}

function resize(): void {
  if (resizeTimer) window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(() => {
    resizeTimer = undefined
    applyResize()
  }, 80)
}

function render(now: number): void {
  if (!gl || !program || !canvas.value || !uniforms) return
  const animate = props.active && !props.reducedMotion && !document.hidden
  frame = animate ? requestAnimationFrame(render) : 0
  if (animate && now - lastFrameAt < 1000 / 30) return
  const elapsed = lastAnimationAt ? Math.min((now - lastAnimationAt) / 1000, 0.1) : 0
  lastAnimationAt = now
  lastFrameAt = now

  const eb = 1 - Math.exp(-elapsed * 2.4)
  const bb = 1 - Math.exp(-elapsed * 1.7)
  smoothedEnergy += (props.energy - smoothedEnergy) * eb
  smoothedBass += (props.bass - smoothedBass) * bb
  const beatBlend = 1 - Math.exp(-elapsed * (props.beat > beatEnvelope ? 17 : 2))
  beatEnvelope += (props.beat - beatEnvelope) * beatBlend
  if (coverTargetLoaded) coverFade = Math.min(1, coverFade + elapsed * 1.5)
  else coverFade = Math.max(0, coverFade - elapsed * 2)
  gl.useProgram(program)
  gl.uniform2f(
    uniforms.resolution!,
    drawingWidth || canvas.value.width,
    drawingHeight || canvas.value.height
  )
  gl.uniform1f(uniforms.time!, (now - startedAt) / 1000)
  gl.uniform1f(uniforms.energy!, smoothedEnergy)
  gl.uniform1f(uniforms.bass!, smoothedBass)
  gl.uniform1f(uniforms.beat!, beatEnvelope)
  gl.uniform3fv(uniforms.colorA!, colour(props.primary))
  gl.uniform3fv(uniforms.colorB!, colour(props.secondary))
  gl.uniform3fv(uniforms.colorC!, colour(props.tertiary))
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, coverTexture)
  gl.uniform1i(uniforms.cover!, 0)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, blurredCoverTexture)
  gl.uniform1i(uniforms.coverBlurred!, 1)
  gl.uniform1f(uniforms.coverLoaded!, coverFade)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  if (props.debug && now - lastDebugAt >= 200) {
    lastDebugAt = now
    emit('debug', {
      width: drawingWidth || canvas.value.width,
      height: drawingHeight || canvas.value.height,
      time: (now - startedAt) / 1000,
      flowSpeed: 0.12 + smoothedEnergy * 0.018,
      warpStrength: 1 + smoothedEnergy * 0.055 + smoothedBass * 0.085 + beatEnvelope * 0.055,
      beat: beatEnvelope
    })
  }
}

function start(): void {
  if (!frame && !document.hidden) {
    frame = requestAnimationFrame(render)
  }
}

function handleContextLost(event: Event): void {
  event.preventDefault()
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  emit('unavailable')
}

function handleVisibility(): void {
  if (document.hidden && frame) {
    cancelAnimationFrame(frame)
    frame = 0
  }
  if (!document.hidden) {
    lastAnimationAt = 0
    lastFrameAt = 0
    start()
  }
}

onMounted(() => {
  const target = canvas.value
  if (!target) return
  gl = target.getContext('webgl', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power'
  })
  if (!gl) {
    emit('unavailable')
    return
  }

  const compile = (type: number, source: string): WebGLShader => {
    const shader = gl!.createShader(type)
    if (!shader) return null
    gl!.shaderSource(shader, source)
    gl!.compileShader(shader)
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
      console.error('[FluidBackground]', gl!.getShaderInfoLog(shader))
      gl!.deleteShader(shader)
      return null
    }
    return shader
  }
  const vertex = compile(gl.VERTEX_SHADER, vertexSource)
  const fragment = compile(gl.FRAGMENT_SHADER, fragmentSource)
  if (!vertex || !fragment) {
    emit('unavailable')
    return
  }
  program = gl.createProgram()
  if (!program) {
    emit('unavailable')
    return
  }
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  gl.deleteShader(vertex)
  gl.deleteShader(fragment)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error('[FluidBackground]', gl.getProgramInfoLog(program))
    emit('unavailable')
    return
  }
  gl.useProgram(program)
  const getUniform = (name: string): WebGLUniformLocation => gl!.getUniformLocation(program!, name)
  uniforms = {
    resolution: getUniform('u_resolution'),
    time: getUniform('u_time'),
    energy: getUniform('u_energy'),
    bass: getUniform('u_bass'),
    beat: getUniform('u_beat'),
    colorA: getUniform('u_color_a'),
    colorB: getUniform('u_color_b'),
    colorC: getUniform('u_color_c'),
    cover: getUniform('u_cover'),
    coverBlurred: getUniform('u_cover_blurred'),
    coverLoaded: getUniform('u_cover_loaded')
  }
  const position = gl.getAttribLocation(program, 'a_position')
  const buffer = gl.createBuffer()
  if (position < 0 || !buffer) {
    emit('unavailable')
    return
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  const createTexture = (): WebGLTexture => {
    const texture = gl!.createTexture()
    if (!texture) return null
    gl!.bindTexture(gl!.TEXTURE_2D, texture)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE)
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE)
    gl!.texImage2D(
      gl!.TEXTURE_2D,
      0,
      gl!.RGBA,
      1,
      1,
      0,
      gl!.RGBA,
      gl!.UNSIGNED_BYTE,
      new Uint8Array([20, 25, 40, 255])
    )
    return texture
  }
  coverTexture = createTexture()
  blurredCoverTexture = createTexture()
  if (!coverTexture || !blurredCoverTexture) {
    emit('unavailable')
    return
  }
  startedAt = performance.now()
  applyResize()
  loadCover(props.coverSrc)
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(target)
  target.addEventListener('webglcontextlost', handleContextLost)
  document.addEventListener('visibilitychange', handleVisibility)
  start()
})

watch(
  () => [props.active, props.reducedMotion],
  () => {
    if (!props.active || props.reducedMotion) {
      if (frame) cancelAnimationFrame(frame)
      frame = 0
      start()
      return
    }
    lastAnimationAt = 0
    start()
  }
)

watch(() => props.coverSrc, loadCover)
watch(() => [props.primary, props.secondary, props.tertiary, props.coverSrc], start)

onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
  if (resizeTimer) window.clearTimeout(resizeTimer)
  resizeObserver?.disconnect()
  canvas.value?.removeEventListener('webglcontextlost', handleContextLost)
  document.removeEventListener('visibilitychange', handleVisibility)
  if (gl) {
    if (coverTexture) gl.deleteTexture(coverTexture)
    if (blurredCoverTexture) gl.deleteTexture(blurredCoverTexture)
    if (program) gl.deleteProgram(program)
  }
  coverTexture = null
  blurredCoverTexture = null
  program = null
  uniforms = null
  gl = null
})
</script>

<template>
  <canvas
    ref="canvas"
    class="absolute inset-0 size-full pointer-events-none brightness-80 saturate-110"
    aria-hidden="true"
  />
</template>
