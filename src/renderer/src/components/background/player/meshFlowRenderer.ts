import {
  blurFragment,
  materialFragment,
  meshFragment,
  meshVertex,
  quadVertex
} from '../shaders/meshFlowShaders'

interface Program {
  value: WebGLProgram
  position: number
  uniforms: Record<string, WebGLUniformLocation | null>
}
const SIZE = 128
const INTERVAL = 1000 / 30

/** GPU artwork compositing at 128px; only the final deformed mesh fills the viewport. */
export class MeshFlowRenderer {
  private gl: WebGLRenderingContext
  private programs: WebGLProgram[] = []
  private textures: WebGLTexture[] = []
  private buffers: WebGLBuffer[] = []
  private targets: WebGLFramebuffer[] = []
  private material!: Program
  private blur!: Program
  private mesh!: Program
  private quad!: WebGLBuffer
  private grid!: WebGLBuffer
  private current!: WebGLTexture
  private previous!: WebGLTexture
  private surface!: WebGLTexture
  private temporary!: WebGLTexture
  private vertexCount = 0
  private frame = 0
  private last = 0
  private time = 0
  private fade = 1
  private pulse = 0
  private energy = 0
  private active = false
  private disposed = false
  private generation = 0
  private image: HTMLImageElement | null = null
  private source: string | null = null
  private currentPixels: HTMLCanvasElement | null = null
  private previousPixels: HTMLCanvasElement | null = null
  private colors: string[]

  constructor(
    private canvas: HTMLCanvasElement,
    colors: string[]
  ) {
    const gl = canvas.getContext('webgl', { alpha: false, depth: false, antialias: false })
    if (!gl) throw new Error('WebGL unavailable')
    this.gl = gl
    this.colors = colors
    try {
      this.material = this.program(quadVertex, materialFragment, [
        'u_previous',
        'u_current',
        'u_mix',
        'u_time',
        'u_pulse'
      ])
      this.blur = this.program(quadVertex, blurFragment, ['u_texture', 'u_direction'])
      this.mesh = this.program(meshVertex, meshFragment, ['u_texture', 'u_time', 'u_aspect'])
      this.quad = this.buffer(new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]))
      const points: number[] = []
      const divisions = 40
      for (let y = 0; y < divisions; y++) {
        for (let x = 0; x < divisions; x++) {
          const left = (x / divisions) * 2 - 1,
            bottom = (y / divisions) * 2 - 1
          const right = ((x + 1) / divisions) * 2 - 1,
            top = ((y + 1) / divisions) * 2 - 1
          points.push(left, bottom, right, bottom, left, top, left, top, right, bottom, right, top)
        }
      }
      this.vertexCount = points.length / 2
      this.grid = this.buffer(new Float32Array(points))
      this.previous = this.texture()
      this.current = this.texture()
      this.surface = this.texture()
      this.temporary = this.texture()
      for (const texture of [this.surface, this.temporary]) {
        const target = gl.createFramebuffer()
        if (!target) throw new Error('Unable to create mesh framebuffer')
        this.targets.push(target)
        gl.bindFramebuffer(gl.FRAMEBUFFER, target)
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0)
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE)
          throw new Error('Incomplete mesh framebuffer')
      }
      const fallback = this.fallback()
      this.currentPixels = this.previousPixels = fallback
      this.upload(this.current, fallback)
      this.upload(this.previous, fallback)
      this.resize()
    } catch (reason) {
      this.dispose()
      throw reason
    }
  }

  private program(vertex: string, fragment: string, names: string[]): Program {
    const gl = this.gl
    const value = gl.createProgram()
    if (!value) throw new Error('Unable to create mesh program')
    this.programs.push(value)
    for (const [type, source] of [
      [gl.VERTEX_SHADER, vertex],
      [gl.FRAGMENT_SHADER, fragment]
    ] as const) {
      const shader = gl.createShader(type)
      if (!shader) throw new Error('Unable to create mesh shader')
      try {
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error(gl.getShaderInfoLog(shader) || 'Mesh shader compilation failed')
        gl.attachShader(value, shader)
      } finally {
        gl.deleteShader(shader)
      }
    }
    gl.linkProgram(value)
    if (!gl.getProgramParameter(value, gl.LINK_STATUS))
      throw new Error(gl.getProgramInfoLog(value) || 'Mesh program link failed')
    return {
      value,
      position: gl.getAttribLocation(value, 'a_position'),
      uniforms: Object.fromEntries(names.map((name) => [name, gl.getUniformLocation(value, name)]))
    }
  }

  private buffer(data: Float32Array): WebGLBuffer {
    const gl = this.gl,
      buffer = gl.createBuffer()
    if (!buffer) throw new Error('Unable to create mesh buffer')
    this.buffers.push(buffer)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW)
    return buffer
  }

  private texture(): WebGLTexture {
    const gl = this.gl,
      texture = gl.createTexture()
    if (!texture) throw new Error('Unable to create mesh texture')
    this.textures.push(texture)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, SIZE, SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
    return texture
  }

  private upload(texture: WebGLTexture, pixels: HTMLCanvasElement): void {
    const gl = this.gl
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    try {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    } finally {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
    }
  }

  private fallback(): HTMLCanvasElement {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = SIZE
    const context = canvas.getContext('2d')!
    const gradient = context.createLinearGradient(0, 0, SIZE, SIZE)
    this.colors.forEach((color, index) =>
      gradient.addColorStop(index / Math.max(1, this.colors.length - 1), `rgb(${color})`)
    )
    context.fillStyle = gradient
    context.fillRect(0, 0, SIZE, SIZE)
    return canvas
  }

  private replace(pixels: HTMLCanvasElement): void {
    // Retarget from the currently displayed blend, including rapid consecutive track changes.
    const context = document.createElement('canvas').getContext('2d')!
    context.canvas.width = context.canvas.height = SIZE
    if (this.previousPixels) context.drawImage(this.previousPixels, 0, 0)
    context.globalAlpha = this.fade * this.fade * (3 - 2 * this.fade)
    if (this.currentPixels) context.drawImage(this.currentPixels, 0, 0)
    this.previousPixels = context.canvas
    this.currentPixels = pixels
    this.upload(this.previous, context.canvas)
    this.upload(this.current, pixels)
    this.fade = this.active ? 0 : 1
    this.draw()
    this.schedule()
  }

  setPalette(colors: string[]): void {
    this.colors = colors
    if (!this.source) this.replace(this.fallback())
  }

  setArtwork(source: string | null): void {
    const generation = ++this.generation
    if (this.image) {
      this.image.onload = this.image.onerror = null
      this.image.removeAttribute('src')
      this.image = null
    }
    this.source = source
    if (!source) {
      this.replace(this.fallback())
      return
    }
    const image = new Image()
    this.image = image
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (this.disposed || generation !== this.generation) return
      try {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = SIZE
        const context = canvas.getContext('2d')!
        context.fillStyle = '#17202b'
        context.fillRect(0, 0, SIZE, SIZE)
        context.drawImage(image, 0, 0, SIZE, SIZE)
        const pixels = context.getImageData(0, 0, SIZE, SIZE)
        for (let i = 0; i < pixels.data.length; i += 4) {
          const gray =
            pixels.data[i] * 0.2126 + pixels.data[i + 1] * 0.7152 + pixels.data[i + 2] * 0.0722
          for (let channel = 0; channel < 3; channel++) {
            const value = Math.max(0, gray + (pixels.data[i + channel] - gray) * 1.45)
            pixels.data[i + channel] = 220 * (1 - Math.exp(-value / 180))
          }
        }
        context.putImageData(pixels, 0, 0)
        this.replace(canvas)
      } catch {
        this.source = null
        this.replace(this.fallback())
      }
      this.image = null
    }
    image.onerror = () => {
      if (this.disposed || generation !== this.generation) return
      this.source = null
      this.image = null
      this.replace(this.fallback())
    }
    image.src = source
  }

  private bind(program: Program, buffer: WebGLBuffer): void {
    const gl = this.gl
    gl.useProgram(program.value)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.enableVertexAttribArray(program.position)
    gl.vertexAttribPointer(program.position, 2, gl.FLOAT, false, 0, 0)
  }

  private sample(texture: WebGLTexture, slot = 0): void {
    this.gl.activeTexture(this.gl.TEXTURE0 + slot)
    this.gl.bindTexture(this.gl.TEXTURE_2D, texture)
  }

  private drawMaterial(pulse: number): void {
    const gl = this.gl,
      p = this.material
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[0])
    gl.viewport(0, 0, SIZE, SIZE)
    this.bind(p, this.quad)
    this.sample(this.previous)
    this.sample(this.current, 1)
    gl.uniform1i(p.uniforms.u_previous, 0)
    gl.uniform1i(p.uniforms.u_current, 1)
    gl.uniform1f(p.uniforms.u_mix, this.fade * this.fade * (3 - 2 * this.fade))
    gl.uniform1f(p.uniforms.u_time, this.time)
    gl.uniform1f(p.uniforms.u_pulse, pulse)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  private draw(): void {
    if (this.disposed) return
    const gl = this.gl
    this.drawMaterial(this.pulse)
    this.bind(this.blur, this.quad)
    gl.uniform1i(this.blur.uniforms.u_texture, 0)
    for (let axis = 0; axis < 2; axis++) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets[axis ? 0 : 1])
      this.sample(axis ? this.temporary : this.surface)
      gl.uniform2f(this.blur.uniforms.u_direction, axis ? 0 : 1 / SIZE, axis ? 1 / SIZE : 0)
      gl.drawArrays(gl.TRIANGLES, 0, 6)
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null)
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    this.bind(this.mesh, this.grid)
    this.sample(this.surface)
    gl.uniform1i(this.mesh.uniforms.u_texture, 0)
    gl.uniform1f(this.mesh.uniforms.u_time, this.time)
    gl.uniform1f(this.mesh.uniforms.u_aspect, this.canvas.width / this.canvas.height)
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount)
  }

  resize(): void {
    if (this.disposed) return
    const { width, height } = this.canvas.getBoundingClientRect()
    if (!width || !height) return
    const scale = Math.min(
      (window.devicePixelRatio || 1) * 0.65,
      1,
      Math.sqrt(900_000 / (width * height))
    )
    this.canvas.width = Math.max(1, Math.round(width * scale))
    this.canvas.height = Math.max(1, Math.round(height * scale))
    this.draw()
  }

  setActive(active: boolean): void {
    this.active = active
    this.last = 0
    if (!active) {
      cancelAnimationFrame(this.frame)
      this.frame = 0
      this.draw()
    } else this.schedule()
  }

  setEnergy(energy: number): void {
    this.energy = Number.isFinite(energy) ? Math.max(0, Math.min(1, energy)) : 0
  }

  private schedule(): void {
    if (!this.frame && this.active && !this.disposed) this.frame = requestAnimationFrame(this.tick)
  }

  private tick = (now: number): void => {
    this.frame = 0
    if (!this.active || this.disposed) return
    const elapsed = this.last ? now - this.last : INTERVAL
    if (elapsed >= INTERVAL) {
      const delta = Math.min(elapsed, 100) / 1000
      this.last = now - (elapsed % INTERVAL)
      this.time += delta
      this.fade = Math.min(1, this.fade + delta / 0.6)
      this.pulse += (this.energy - this.pulse) * (1 - Math.exp(-delta * 5))
      this.draw()
    }
    this.schedule()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.active = false
    this.generation++
    cancelAnimationFrame(this.frame)
    this.frame = 0
    if (this.image) {
      this.image.onload = this.image.onerror = null
      this.image.removeAttribute('src')
      this.image = null
    }
    for (const buffer of this.buffers) this.gl.deleteBuffer(buffer)
    for (const texture of this.textures) this.gl.deleteTexture(texture)
    for (const target of this.targets) this.gl.deleteFramebuffer(target)
    for (const program of this.programs) this.gl.deleteProgram(program)
  }
}
