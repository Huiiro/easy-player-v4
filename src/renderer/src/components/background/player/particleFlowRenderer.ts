import { particleFragment, particleVertex } from '../shaders/particleFlowShaders'

const COUNT = 10000
const INTERVAL = 1000 / 30
const FIELD_WIDTH = 40
const FIELD_HEIGHT = 28
const CENTERS_X = [-0.5, 0.45, 0.05]
const CENTERS_Y = [0.28, -0.26, 0.12]
const unit = (value: number): number =>
  Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0

/** Reference: shaders/01, https://openprocessing.org/@u206311/1522899.
 * The original point-grid / inertial attraction is driven by audio rather than a pointer.
 */
export class ParticleFlowRenderer {
  private gl: WebGLRenderingContext
  private program: WebGLProgram | null = null
  private buffer: WebGLBuffer | null = null
  private seedBuffer: WebGLBuffer | null = null
  private velocityBuffer: WebGLBuffer | null = null
  private shaders: WebGLShader[] = []
  private position = 0
  private seedAttribute = 0
  private velocityAttribute = 0
  private uniforms: Record<string, WebGLUniformLocation | null> = {}
  private positions = new Float32Array(COUNT * 2)
  private homes = new Float32Array(COUNT * 2)
  private velocities = new Float32Array(COUNT * 2)
  private seeds = new Float32Array(COUNT)
  private directions = new Float32Array(COUNT * 2)
  private field = new Float32Array(FIELD_WIDTH * FIELD_HEIGHT * 2)
  private aspect = 1
  private scale = 1
  private frame = 0
  private last = 0
  private phase = 0
  private energy = 0
  private bass = 0
  private targetEnergy = 0
  private targetBass = 0
  private pulse = 0
  private sequence: number | undefined
  private active = false
  private disposed = false

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl', { alpha: false, depth: false, antialias: false })
    if (!gl) throw new Error('WebGL unavailable')
    this.gl = gl
    try {
      this.program = gl.createProgram()
      if (!this.program) throw new Error('Unable to create particle program')
      for (const [type, source] of [
        [gl.VERTEX_SHADER, particleVertex],
        [gl.FRAGMENT_SHADER, particleFragment]
      ] as const) {
        const shader = gl.createShader(type)
        if (!shader) throw new Error('Unable to create particle shader')
        this.shaders.push(shader)
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
          throw new Error(gl.getShaderInfoLog(shader) || 'Particle shader compilation failed')
        gl.attachShader(this.program, shader)
      }
      gl.linkProgram(this.program)
      if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(this.program) || 'Particle program link failed')
      this.position = gl.getAttribLocation(this.program, 'aPosition')
      this.seedAttribute = gl.getAttribLocation(this.program, 'aSeed')
      this.velocityAttribute = gl.getAttribLocation(this.program, 'aVelocity')
      for (const name of ['uAspect', 'uScale', 'uEnergy', 'uPulse', 'uPhase'])
        this.uniforms[name] = gl.getUniformLocation(this.program, name)
      this.buffer = gl.createBuffer()
      if (!this.buffer) throw new Error('Unable to create particle buffer')
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
      gl.bufferData(gl.ARRAY_BUFFER, this.positions.byteLength, gl.DYNAMIC_DRAW)
      this.seedBuffer = gl.createBuffer()
      if (!this.seedBuffer) throw new Error('Unable to create particle identity buffer')
      // Independent, reproducible samples avoid both rows and sunflower/spiral lattices.
      let state = 0x6d2b79f5
      const random = (): number => {
        state ^= state << 13
        state ^= state >>> 17
        state ^= state << 5
        return (state >>> 0) / 4294967296
      }
      for (let i = 0; i < COUNT; i++) {
        this.seeds[i] = random()
        const angle = random() * Math.PI * 2
        this.directions[i * 2] = Math.cos(angle)
        this.directions[i * 2 + 1] = Math.sin(angle)
        this.positions[i * 2] = this.homes[i * 2] = (random() * 2 - 1) * 0.94
        this.positions[i * 2 + 1] = this.homes[i * 2 + 1] = (random() * 2 - 1) * 0.94
      }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.seedBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, this.seeds, gl.STATIC_DRAW)
      this.velocityBuffer = gl.createBuffer()
      if (!this.velocityBuffer) throw new Error('Unable to create particle velocity buffer')
      gl.bindBuffer(gl.ARRAY_BUFFER, this.velocityBuffer)
      gl.bufferData(gl.ARRAY_BUFFER, this.velocities.byteLength, gl.DYNAMIC_DRAW)
      gl.enable(gl.BLEND)
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE)
      gl.clearColor(0.022, 0.032, 0.048, 1)
      this.resize()
    } catch (reason) {
      this.dispose()
      throw reason
    }
  }

  resize(): void {
    if (this.disposed) return
    const box = this.canvas.getBoundingClientRect()
    const width = Math.max(1, box.width),
      height = Math.max(1, box.height)
    this.scale = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(900000 / (width * height)))
    this.canvas.width = Math.max(1, Math.floor(width * this.scale))
    this.canvas.height = Math.max(1, Math.floor(height * this.scale))
    const aspect = width / height
    // Rescale the existing flow instead of resetting it on a window resize.
    for (let i = 0; i < COUNT; i++) {
      this.positions[i * 2] *= aspect / this.aspect
      this.velocities[i * 2] *= aspect / this.aspect
      this.homes[i * 2] *= aspect / this.aspect
    }
    this.aspect = aspect
    this.draw()
  }

  setAudio(energy: number, bass: number, beat: number, sequence: number): void {
    this.targetEnergy = unit(energy)
    this.targetBass = unit(bass)
    // A sampled onset must only fire once, even if several frames see it.
    if (this.active && this.sequence !== undefined && sequence !== this.sequence)
      this.pulse = Math.max(this.pulse, unit(beat))
    this.sequence = sequence
  }

  setActive(active: boolean): void {
    if (this.disposed || this.active === active) return
    this.active = active
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.last = 0
    if (active) this.frame = requestAnimationFrame(this.tick)
  }

  private tick = (now: number): void => {
    this.frame = 0
    if (!this.active || this.disposed) return
    if (!this.last || now - this.last >= INTERVAL) {
      const step = this.last ? Math.min(2, (now - this.last) / INTERVAL) : 1
      this.last = now
      this.advance(step)
      this.draw()
    }
    this.frame = requestAnimationFrame(this.tick)
  }

  private advance(step: number): void {
    const blend = 1 - Math.pow(0.78, step)
    this.energy += (this.targetEnergy - this.energy) * blend
    this.bass += (this.targetBass - this.bass) * blend
    this.pulse *= Math.pow(0.86, step)
    // Silent input freezes the flow field; inertia settles into an unstructured cloud.
    this.phase += (this.energy * 0.024 + this.bass * 0.016) * step
    const drive = Math.max(this.energy, this.bass * 0.8)
    // Audio advances a continuous gather -> return -> scatter -> return cycle.
    // Three separated flow centers prevent a single permanent vortex.
    const turn = this.phase * 1.4
    const cos = Math.cos(turn),
      sin = Math.sin(turn)
    // A smooth divergence-free field bends neighboring trajectories into wisps.
    // Sample once per cell, then interpolate for particles, avoiding per-particle noise work.
    for (let row = 0; row < FIELD_HEIGHT; row++) {
      const y = ((row / (FIELD_HEIGHT - 1)) * 2 - 1) * 1.3
      for (let col = 0; col < FIELD_WIDTH; col++) {
        const x = ((col / (FIELD_WIDTH - 1)) * 2 - 1) * this.aspect * 1.3
        const a = Math.cos(x * 2.1 + y * 2.8 + this.phase * 0.61)
        const b = Math.cos(x * -3.7 + y * 1.6 - this.phase * 0.43)
        const c = Math.cos(x * 5.3 + y * -4.1 + this.phase * 0.79)
        const offset = (row * FIELD_WIDTH + col) * 2
        this.field[offset] = (a * 2.8 + b * 0.88 - c * 0.74) * 0.3
        this.field[offset + 1] = (-a * 2.1 + b * 2.035 - c * 0.954) * 0.3
      }
    }
    for (let i = 0; i < COUNT * 2; i += 2) {
      const x = this.positions[i],
        y = this.positions[i + 1]
      const index = i / 2,
        seed = this.seeds[index],
        group = index % 3
      // Local phase offsets and different inertia break synchronized choreography.
      const localPhase = this.phase + (seed - 0.5) * 1.15 + group * 0.12
      const gather = Math.pow(Math.max(0, Math.sin(localPhase)), 2) * drive
      const scatter = Math.pow(Math.max(0, -Math.sin(localPhase)), 2) * drive
      const damping = Math.pow(0.84 + seed * 0.1, step)
      const spring = (0.008 - drive * 0.0045) * (0.65 + seed * 0.7)
      const hx = this.homes[i],
        hy = this.homes[i + 1]
      const cx =
        CENTERS_X[group] * this.aspect +
        Math.sin(this.phase * 0.7 + group * 2.1) * this.aspect * 0.1
      const cy = CENTERS_Y[group] + Math.cos(this.phase * 0.8 + group * 2.1) * 0.15
      const ux = this.directions[i],
        uy = this.directions[i + 1]
      const radius = 0.06 + Math.sqrt(seed) * (0.32 + 0.12 * Math.sin(seed * 19 + this.phase * 0.6))
      const orbitX = cx + (ux * cos - uy * sin) * radius * Math.min(this.aspect, 1.25)
      const orbitY = cy + (ux * sin + uy * cos) * radius
      const spreadX = hx * 1.22 + ux * this.aspect * 0.32
      const spreadY = hy * 1.22 + uy * 0.32
      const wave = drive * (1 - gather) * (1 - scatter) * 0.1
      const targetX =
        hx +
        (orbitX - hx) * gather +
        (spreadX - hx) * scatter +
        Math.sin(hy * 7 + this.phase * 2) * wave
      const targetY =
        hy +
        (orbitY - hy) * gather +
        (spreadY - hy) * scatter +
        Math.cos((hx / this.aspect) * 6 + this.phase * 1.7) * wave
      const dx = x - cx,
        dy = y - cy
      const distance = Math.max(0.12, Math.hypot(dx, dy))
      const burst = this.pulse * 0.006 * (0.5 + seed)
      const fx = Math.max(
        0,
        Math.min(FIELD_WIDTH - 1.001, (x / (this.aspect * 1.3) + 1) * 0.5 * (FIELD_WIDTH - 1))
      )
      const fy = Math.max(
        0,
        Math.min(FIELD_HEIGHT - 1.001, (y / 1.3 + 1) * 0.5 * (FIELD_HEIGHT - 1))
      )
      const col = Math.floor(fx),
        row = Math.floor(fy)
      const tx = fx - col,
        ty = fy - row
      const offset = (row * FIELD_WIDTH + col) * 2
      const below = offset + FIELD_WIDTH * 2
      const flowX =
        (this.field[offset] * (1 - tx) + this.field[offset + 2] * tx) * (1 - ty) +
        (this.field[below] * (1 - tx) + this.field[below + 2] * tx) * ty
      const flowY =
        (this.field[offset + 1] * (1 - tx) + this.field[offset + 3] * tx) * (1 - ty) +
        (this.field[below + 1] * (1 - tx) + this.field[below + 3] * tx) * ty
      const turbulence = drive * (0.0014 + seed * 0.0018)
      // Soft bounds bring outgoing particles back without wrapping or teleporting.
      const boundX = Math.max(0, Math.abs(x) - this.aspect * 0.98) * Math.sign(x) * 0.03
      const boundY = Math.max(0, Math.abs(y) - 0.98) * Math.sign(y) * 0.03
      this.velocities[i] =
        (this.velocities[i] +
          ((targetX - x) * spring + (dx / distance) * burst + flowX * turbulence - boundX) * step) *
        damping
      this.velocities[i + 1] =
        (this.velocities[i + 1] +
          ((targetY - y) * spring + (dy / distance) * burst + flowY * turbulence - boundY) * step) *
        damping
      this.positions[i] += this.velocities[i] * step
      this.positions[i + 1] += this.velocities[i + 1] * step
    }
  }

  private draw(): void {
    if (this.disposed) return
    const gl = this.gl
    gl.viewport(0, 0, this.canvas.width, this.canvas.height)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.useProgram(this.program)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.positions)
    gl.enableVertexAttribArray(this.position)
    gl.vertexAttribPointer(this.position, 2, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.seedBuffer)
    gl.enableVertexAttribArray(this.seedAttribute)
    gl.vertexAttribPointer(this.seedAttribute, 1, gl.FLOAT, false, 0, 0)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.velocityBuffer)
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.velocities)
    gl.enableVertexAttribArray(this.velocityAttribute)
    gl.vertexAttribPointer(this.velocityAttribute, 2, gl.FLOAT, false, 0, 0)
    gl.uniform1f(this.uniforms.uAspect, this.aspect)
    gl.uniform1f(this.uniforms.uScale, this.scale)
    gl.uniform1f(this.uniforms.uEnergy, this.energy)
    gl.uniform1f(this.uniforms.uPulse, this.pulse)
    gl.uniform1f(this.uniforms.uPhase, this.phase % (Math.PI * 40))
    gl.drawArrays(gl.POINTS, 0, COUNT)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.active = false
    cancelAnimationFrame(this.frame)
    this.frame = 0
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, null)
    this.gl.useProgram(null)
    this.gl.deleteBuffer(this.buffer)
    this.gl.deleteBuffer(this.seedBuffer)
    this.gl.deleteBuffer(this.velocityBuffer)
    this.gl.deleteProgram(this.program)
    for (const shader of this.shaders) this.gl.deleteShader(shader)
    this.shaders = []
    this.positions = this.homes = this.velocities = new Float32Array(0)
    this.seeds = this.directions = new Float32Array(0)
    this.field = new Float32Array(0)
    this.canvas.width = this.canvas.height = 1
  }
}
