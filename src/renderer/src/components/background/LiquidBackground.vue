<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  primary: string
  secondary: string
  tertiary: string
  quaternary: string
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
let frame = 0
let lastFrameAt = 0
let lastAnimationAt = 0
let startedAt = 0
let lastDebugAt = 0
let resizeObserver: ResizeObserver | undefined
let coverTexture: WebGLTexture | null = null
let blurredCoverTexture: WebGLTexture | null = null
let coverLoaded = false
let coverLoadToken = 0
let smoothedEnergy = 0
let smoothedBass = 0
let beatEnvelope = 0

const vertexSource = `
  attribute vec2 a_position;
  void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`

// The cover is the source material. A low-resolution flow field displaces its
// UVs and samples along that flow, producing a soft liquid smear without a
// costly physical-fluid simulation.
const fragmentSource = `
  precision mediump float;
  uniform vec2 u_resolution;
  uniform float u_time;
  uniform float u_energy;
  uniform float u_bass;
  uniform float u_beat;
  uniform vec3 u_color_a;
  uniform vec3 u_color_b;
  uniform vec3 u_color_c;
  uniform vec3 u_color_d;
  uniform sampler2D u_cover;
  uniform sampler2D u_cover_blurred;
  uniform float u_cover_loaded;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p); vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0)), f.x), f.y);
  }
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rotation = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 4; i++) {
      value += amplitude * noise(p);
      p = rotation * p * 2.03 + vec2(13.7, 9.2);
      amplitude *= 0.5;
    }
    return value;
  }
  vec2 fluidFlow(vec2 p, float time) {
    float x = fbm(p + vec2(time * 0.43, -time * 0.21));
    float y = fbm(p + vec2(-time * 0.28, time * 0.37) + 7.1);
    return vec2(x, y) - 0.5;
  }
  vec3 fallbackPalette(vec2 p) {
    float a = exp(-dot(p - vec2(0.24, 0.30), p - vec2(0.24, 0.30)) / 0.20);
    float b = exp(-dot(p - vec2(1.30, 0.67), p - vec2(1.30, 0.67)) / 0.27);
    float c = exp(-dot(p - vec2(0.82, 0.18), p - vec2(0.82, 0.18)) / 0.18);
    float d = exp(-dot(p - vec2(0.72, 0.88), p - vec2(0.72, 0.88)) / 0.23);
    return vec3(0.02, 0.03, 0.05) + u_color_a * a + u_color_b * b + u_color_c * c + u_color_d * d;
  }
  vec3 smearSample(vec2 uv, vec2 direction, float blurRadius) {
    // Keep out-of-range flow samples inside the cover instead of reflecting
    // them back. Reflection creates repeated colour islands that read as
    // bubbling artefacts in a slow background.
    vec2 center = clamp(uv, 0.035, 0.965);
    vec2 offset = direction * blurRadius;
    vec2 sideOffset = vec2(-direction.y, direction.x) * blurRadius * 0.88;
    // This is a small 2D blur kernel in texture space, not a CSS blur applied
    // to the complete player. It keeps the broad colour masses but removes
    // recognisable cover detail before the layers are composited.
    vec3 color = texture2D(u_cover_blurred, center).rgb * 0.22;
    vec2 a = clamp(center + offset, 0.035, 0.965);
    vec2 b = clamp(center - offset, 0.035, 0.965);
    vec2 c = clamp(center + sideOffset, 0.035, 0.965);
    vec2 d = clamp(center - sideOffset, 0.035, 0.965);
    color += texture2D(u_cover_blurred, a).rgb * 0.18;
    color += texture2D(u_cover_blurred, b).rgb * 0.18;
    color += texture2D(u_cover_blurred, c).rgb * 0.16;
    color += texture2D(u_cover_blurred, d).rgb * 0.16;
    vec2 e = clamp(center + offset * 2.15, 0.035, 0.965);
    vec2 f = clamp(center - offset * 2.15, 0.035, 0.965);
    color += texture2D(u_cover_blurred, e).rgb * 0.05;
    color += texture2D(u_cover_blurred, f).rgb * 0.05;
    return color;
  }
  vec3 screenBlend(vec3 base, vec3 layer) {
    return 1.0 - (1.0 - base) * (1.0 - layer);
  }
  vec3 tiledCover(vec2 tileSpace, float tileIndex, vec2 direction, float blurRadius, float time) {
    // Identity is tied to the original panel, not the distorted coordinate.
    // That prevents a pixel crossing a warped join from suddenly adopting a
    // completely different random crop.
    vec2 tileId = vec2(tileIndex, 0.0);
    vec2 localUv = fract(tileSpace);
    float seed = hash(tileId + 0.13);
    float sideAngle = tileId.x < 1.0 ? -0.19 : (tileId.x >= 2.0 ? 0.19 : 0.0);
    // Coherent noise changes slowly over time, which feels organic without
    // the frame-to-frame jumps of actual random values.
    float drift = fbm(tileId * 0.73 + vec2(time * 0.11, -time * 0.07) + 2.9) - 0.5;
    float scaleDrift = fbm(tileId * 1.21 + vec2(-time * 0.06, time * 0.09) + 8.4) - 0.5;
    vec2 cropOffset = vec2(hash(tileId + 1.7), hash(tileId + 5.9)) - 0.5;
    vec2 cropDrift = fluidFlow(tileId * 0.58 + 1.2, time * 0.68 + seed * 4.3);
    float angle = sideAngle + drift * 0.16 + (seed - 0.5) * 0.06;
    localUv -= 0.5;
    localUv = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * localUv;
    localUv *= 1.10 + hash(tileId + 4.7) * 0.06 + scaleDrift * 0.07;
    localUv += cropOffset * 0.11 + cropDrift * 0.08;
    localUv += fluidFlow(localUv * 1.35 + tileId * 0.31, time * 0.72 + seed * 6.0) * 0.14;
    return smearSample(localUv + 0.5, direction, blurRadius);
  }
  void main() {
    vec2 screenUv = gl_FragCoord.xy / u_resolution.xy;
    vec2 uv = screenUv;
    uv.x *= u_resolution.x / u_resolution.y;
    // Time never depends on instantaneous audio values: that would move the
    // noise domain discontinuously and read as a visual stutter.
    float time = u_time * 0.43;
    float motion = 0.92 + u_energy * 0.18 + u_bass * 0.10;
    // Two differently advected noise fields fold the colour domains into each
    // other. Unlike a few orbiting circles this has no short repeating path.
    vec2 warp = fluidFlow(uv * 0.62, time) * 0.68;
    vec2 warpedUv = uv + warp * motion;
    warpedUv += fluidFlow(warpedUv * 1.34 + warp * 1.2, time * 1.19 + 4.3) * 0.25 * motion;
    warpedUv += fluidFlow(warpedUv * 3.1 - warp, time * 0.54 + 9.7) * 0.035;
    vec2 displacement = (warpedUv - uv) / vec2(u_resolution.x / u_resolution.y, 1.0);
    vec2 flowDirection = normalize(displacement + vec2(0.0001, 0.0001));
    float smear = 0.014 + u_energy * 0.011 + u_bass * 0.007 + u_beat * 0.018;
    // Lay three cover copies out horizontally. The flow concentrates toward
    // the centre, so the middle copy becomes the large, most liquid focal area
    // while the outside copies remain recognisable at the edges.
    vec2 centre = screenUv - vec2(0.5, 0.52);
    float centreWarp = exp(-dot(centre * vec2(1.15, 1.55), centre * vec2(1.15, 1.55)) / 0.075);
    vec2 pulseDirection = normalize(centre + vec2(0.0001, -0.0001));
    // A second, non-audio life cycle keeps the background from only reacting
    // when music has transients. The two incommensurate periods avoid a loop
    // that feels like a simple CSS animation.
    float lifeSwing = sin(time * 0.79 + sin(time * 0.23) * 1.3) * 0.62 + sin(time * 0.47 + 1.8) * 0.38;
    float lifeBreath = 0.5 + 0.5 * sin(time * 0.36 + sin(time * 0.17));
    vec2 lifeCurl = vec2(-centre.y, centre.x);
    // Non-uniform 1×3 atlas: a dominant middle cover with two narrow side
    // copies. Mapping x by region keeps those proportions before distortion.
    float atlasX;
    float tileIndex;
    if (screenUv.x < 0.20) {
      atlasX = screenUv.x / 0.20;
      tileIndex = 0.0;
    } else if (screenUv.x < 0.80) {
      atlasX = 1.0 + (screenUv.x - 0.20) / 0.60;
      tileIndex = 1.0;
    } else {
      atlasX = 2.0 + (screenUv.x - 0.80) / 0.20;
      tileIndex = 2.0;
    }
    vec2 tileSpace = vec2(atlasX, screenUv.y * 1.06 - 0.03);
    // The two atlas joins receive their own broad curl. This breaks the neat
    // vertical seams into the large folded transitions seen in AM's backdrop.
    float leftJoin = exp(-pow((screenUv.x - 0.20) / 0.10, 2.0));
    float rightJoin = exp(-pow((screenUv.x - 0.80) / 0.10, 2.0));
    float joinWarp = leftJoin + rightJoin;
    vec2 joinFlow = fluidFlow(uv * 0.34 + vec2(6.3, 1.7), time * 0.92 + 1.8);
    joinFlow.x += sin(screenUv.y * 7.0 + time * 2.1) * 0.26;
    joinFlow.y += cos(screenUv.y * 5.0 - time * 1.6) * 0.18;
    tileSpace += joinFlow * joinWarp * (0.58 + u_energy * 0.20 + u_beat * 0.38);
    tileSpace += displacement * (0.84 + centreWarp * 1.62);
    tileSpace += pulseDirection * centreWarp * u_beat * 0.36;
    tileSpace += lifeCurl * centreWarp * lifeSwing * 0.22;
    tileSpace += pulseDirection * centreWarp * (lifeBreath - 0.5) * 0.12;
    tileSpace += fluidFlow(uv * 0.48 + 3.4, time * 0.72) * (0.18 + centreWarp * 0.34) * motion;
    vec3 cover = tiledCover(tileSpace, tileIndex, flowDirection, smear * 2.10, time);
    // A diffuse larger atlas pass removes hard cell boundaries while retaining
    // the impression of several warped cover copies behind the main layer.
    vec2 hazeTiles = vec2(atlasX + 0.26, screenUv.y * 1.03 + 0.08);
    hazeTiles += joinFlow * joinWarp * 0.36;
    hazeTiles -= displacement * (0.52 + centreWarp * 0.92);
    hazeTiles += fluidFlow(uv * 0.30 - 4.8, time * 0.53 + 8.2) * (0.14 + centreWarp * 0.26);
    vec3 haze = tiledCover(hazeTiles, tileIndex, normalize(-flowDirection + vec2(0.0001)), smear * 3.45, time + 4.6);
    float hazeMask = smoothstep(0.34, 0.76, fbm(uv * 0.42 + vec2(-time * 0.11, time * 0.13) + 9.4));
    cover = mix(cover, screenBlend(cover, haze), 0.27 * hazeMask);
    // Dissolve the joins into broad artwork-derived colour fields before the
    // final backdrop blur, avoiding a visible three-panel collage.
    vec2 seamFogUv = (screenUv - 0.5) * 1.68 + 0.5;
    seamFogUv += fluidFlow(uv * 0.27 - 7.4, time * 0.43 + 5.2) * 0.19;
    vec3 seamFog = smearSample(seamFogUv, normalize(joinFlow + vec2(0.0001)), smear * 7.5);
    cover = mix(cover, seamFog, min(0.82, joinWarp * 0.74));
    // Keep the cover's colour geography, but blend it back into the derived
    // palette so faces, typography and hard artwork edges do not dominate.
    vec2 paletteUv = warpedUv + fluidFlow(uv * 0.38 - 2.4, time * 0.58 + 7.1) * 0.16;
    vec3 color = mix(fallbackPalette(paletteUv), cover, u_cover_loaded * 0.74);
    color = 1.0 - exp(-color * (1.24 + lifeBreath * 0.10 + u_energy * 0.20 + u_beat * 0.30));
    float vignette = 1.0 - smoothstep(0.25, 1.2, distance(uv, vec2(0.82, 0.52)));
    gl_FragColor = vec4(color * (0.72 + vignette * 0.28), 1.0);
  }
`

function colour(value: string, mix = 0): [number, number, number] {
  const components = value.split(/\s+/).map(Number)
  const [red = 77, green = 136, blue = 220] = components
  return [(red / 255) * (1 - mix), (green / 255) * (1 - mix), (blue / 255) * (1 - mix)]
}

function uniformColor(name: string, value: [number, number, number]): void {
  gl?.uniform3fv(gl.getUniformLocation(program!, name), value)
}

function loadCover(source: string | null): void {
  if (!gl || !coverTexture || !blurredCoverTexture) return
  const token = ++coverLoadToken
  coverLoaded = false
  if (!source) {
    start()
    return
  }
  const image = new Image()
  image.crossOrigin = 'anonymous'
  image.onload = () => {
    if (!gl || !coverTexture || !blurredCoverTexture || token !== coverLoadToken) return
    gl.bindTexture(gl.TEXTURE_2D, coverTexture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    const blurCanvas = document.createElement('canvas')
    const blurSize = 128
    const overscan = 12
    blurCanvas.width = blurSize
    blurCanvas.height = blurSize
    const context = blurCanvas.getContext('2d')
    if (context) {
      context.fillStyle = '#10141c'
      context.fillRect(0, 0, blurSize, blurSize)
      context.filter = 'blur(12px) saturate(1.18)'
      context.drawImage(
        image,
        -overscan,
        -overscan,
        blurSize + overscan * 2,
        blurSize + overscan * 2
      )
      context.filter = 'none'
      gl.bindTexture(gl.TEXTURE_2D, blurredCoverTexture)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, blurCanvas)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    }
    coverLoaded = true
    start()
  }
  image.onerror = () => {
    if (token === coverLoadToken) start()
  }
  image.src = source
}

function resize(): void {
  if (!canvas.value || !gl) return
  const rect = canvas.value!.getBoundingClientRect()
  // A blurred backdrop needs no native-resolution framebuffer. Keep the GPU
  // work bounded on 4K displays and let the browser upscale the soft result.
  const scale = Math.min(window.devicePixelRatio || 1, 1.25) * 0.65
  const width = Math.max(1, Math.round(rect.width * scale))
  const height = Math.max(1, Math.round(rect.height * scale))
  if (canvas.value!.width === width && canvas.value!.height === height) return
  canvas.value!.width = width
  canvas.value!.height = height
  gl.viewport(0, 0, width, height)
}

function render(now: number): void {
  if (!gl || !program || !canvas.value) return
  const animate = props.active && !props.reducedMotion && !document.hidden
  frame = animate ? requestAnimationFrame(render) : 0
  if (animate && now - lastFrameAt < 1000 / 30) return
  const elapsed = lastAnimationAt ? Math.min((now - lastAnimationAt) / 1000, 0.1) : 0
  lastAnimationAt = now
  lastFrameAt = now
  // Long release values keep beat transients from visibly kicking the texture.
  const energyBlend = 1 - Math.exp(-elapsed * 2.4)
  const bassBlend = 1 - Math.exp(-elapsed * 1.7)
  smoothedEnergy += (props.energy - smoothedEnergy) * energyBlend
  smoothedBass += (props.bass - smoothedBass) * bassBlend
  const beatBlend = 1 - Math.exp(-elapsed * (props.beat > beatEnvelope ? 15 : 1.9))
  beatEnvelope += (props.beat - beatEnvelope) * beatBlend
  resize()
  gl.useProgram(program)
  gl.uniform2f(
    gl.getUniformLocation(program, 'u_resolution'),
    canvas.value.width,
    canvas.value.height
  )
  gl.uniform1f(gl.getUniformLocation(program, 'u_time'), (now - startedAt) / 1000)
  gl.uniform1f(gl.getUniformLocation(program, 'u_energy'), smoothedEnergy)
  gl.uniform1f(gl.getUniformLocation(program, 'u_bass'), smoothedBass)
  gl.uniform1f(gl.getUniformLocation(program, 'u_beat'), beatEnvelope)
  uniformColor('u_color_a', colour(props.primary))
  uniformColor('u_color_b', colour(props.secondary))
  uniformColor('u_color_c', colour(props.tertiary))
  uniformColor('u_color_d', colour(props.quaternary))
  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, coverTexture)
  gl.uniform1i(gl.getUniformLocation(program, 'u_cover'), 0)
  gl.activeTexture(gl.TEXTURE1)
  gl.bindTexture(gl.TEXTURE_2D, blurredCoverTexture)
  gl.uniform1i(gl.getUniformLocation(program, 'u_cover_blurred'), 1)
  gl.uniform1f(gl.getUniformLocation(program, 'u_cover_loaded'), coverLoaded ? 1 : 0)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  if (props.debug && now - lastDebugAt >= 200) {
    lastDebugAt = now
    emit('debug', {
      width: canvas.value.width,
      height: canvas.value.height,
      time: (now - startedAt) / 1000,
      flowSpeed: 0.43,
      warpStrength: 0.68 * (0.92 + smoothedEnergy * 0.18 + smoothedBass * 0.1),
      beat: beatEnvelope
    })
  }
}

function start(): void {
  if (!frame && !document.hidden) frame = requestAnimationFrame(render)
}

function handleVisibility(): void {
  if (document.hidden && frame) cancelAnimationFrame(frame)
  frame = 0
  if (!document.hidden) start()
}

onMounted(() => {
  const target = canvas.value
  if (!target) return
  gl = target.getContext('webgl', { alpha: false, antialias: false, powerPreference: 'low-power' })
  if (!gl) {
    emit('unavailable')
    return
  }
  const vertex = gl.createShader(gl.VERTEX_SHADER)!
  const fragment = gl.createShader(gl.FRAGMENT_SHADER)!
  gl.shaderSource(vertex, vertexSource)
  gl.compileShader(vertex)
  gl.shaderSource(fragment, fragmentSource)
  gl.compileShader(fragment)
  if (
    !gl.getShaderParameter(vertex, gl.COMPILE_STATUS) ||
    !gl.getShaderParameter(fragment, gl.COMPILE_STATUS)
  ) {
    emit('unavailable')
    return
  }
  program = gl.createProgram()!
  gl.attachShader(program, vertex)
  gl.attachShader(program, fragment)
  gl.linkProgram(program)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    emit('unavailable')
    return
  }
  gl.useProgram(program)
  const position = gl.getAttribLocation(program, 'a_position')
  const buffer = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
  coverTexture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, coverTexture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([20, 25, 40, 255])
  )
  blurredCoverTexture = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, blurredCoverTexture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([20, 25, 40, 255])
  )
  loadCover(props.coverSrc)
  startedAt = performance.now()
  resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(target)
  document.addEventListener('visibilitychange', handleVisibility)
  start()
})

watch(() => [props.active, props.reducedMotion], start)
watch(() => props.coverSrc, loadCover)
onBeforeUnmount(() => {
  if (frame) cancelAnimationFrame(frame)
  resizeObserver?.disconnect()
  document.removeEventListener('visibilitychange', handleVisibility)
})
</script>

<template><canvas ref="canvas" class="absolute inset-0 size-full" aria-hidden="true" /></template>
