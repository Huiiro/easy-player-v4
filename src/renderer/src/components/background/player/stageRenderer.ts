import {
  DEFAULT_PLAYER_CHEER_COLOR,
  DEFAULT_PLAYER_CHEER_LIGHTS,
  type PlayerCheerLights
} from '@/constants'
import {
  createArenaGeometry,
  createArenaOcclusion,
  createCrowdSilhouettes,
  drawBowl,
  drawCrowd
} from './stageArena'
import { StageDirector, stageProjection, type WorldPoint } from './stageCamera'
import { CheerBeatClock, createLightstickAtlas } from './stageCheer'
import { createLightTextures, drawStageLighting } from './stageLighting'
import { StageMusic, type StageAudioSample } from './stageMusic'
import { combineSpriteOcclusion, createStageOcclusion } from './stageOcclusion'
import { createCheerPalette, type CheerPalette } from './stagePalette'
import { drawArenaShell, drawEquipment, drawStage, drawStageScreens } from './stageScenery'
import { drawWingArtwork, glow } from './stageVideoWall'

const FRAME_INTERVAL = 1000 / 30
type Context = CanvasRenderingContext2D

interface CheerDesign {
  palettes: CheerPalette[]
  stickAtlas: ImageBitmap
  fixtures: ReturnType<typeof createLightTextures>
  silhouettes: HTMLCanvasElement[]
}

const crowdSpill: readonly WorldPoint[] = [
  [-38, 3, -49],
  [38, 3, -48],
  [-6, 4, -70],
  [58, 16, -49],
  [-57, 16, -49],
  [0, 27, -71]
]

function layer(width: number, height: number): Context {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Stage canvas is unavailable')
  return context
}

function createCheerDesign(colors: readonly string[]): CheerDesign {
  const palettes = colors.map(createCheerPalette)
  return {
    palettes,
    stickAtlas: createLightstickAtlas(palettes),
    fixtures: createLightTextures(palettes[0].fixtures),
    silhouettes: createCrowdSilhouettes(palettes[0])
  }
}

function releaseCheerDesign({ stickAtlas, fixtures, silhouettes }: CheerDesign): void {
  stickAtlas.close()
  for (const canvas of [...fixtures.beams, ...fixtures.lens, fixtures.markers, ...silhouettes]) {
    canvas.width = 0
    canvas.height = 0
  }
}

export class StageRenderer {
  private readonly director = new StageDirector()
  private readonly music = new StageMusic()
  private readonly cheerClock = new CheerBeatClock()
  private readonly wing = layer(192, 204)
  private arena: ReturnType<typeof createArenaGeometry> | undefined = createArenaGeometry()
  private cheerDesign?: CheerDesign
  private active = false
  private frame: number | undefined
  private lastFrame = 0
  private width = 0
  private height = 0

  constructor(
    private readonly ctx: Context,
    private cheerColors: readonly string[] = [DEFAULT_PLAYER_CHEER_COLOR],
    private cheerLights: Readonly<PlayerCheerLights> = DEFAULT_PLAYER_CHEER_LIGHTS
  ) {
    this.cheerDesign = createCheerDesign(cheerColors)
    drawWingArtwork(this.wing)
  }

  resize(): void {
    if (!this.cheerDesign) return
    const { canvas } = this.ctx
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (!width || !height) return
    const scale = Math.min(window.devicePixelRatio || 1, 1.5, Math.sqrt(1152000 / (width * height)))
    const pixelWidth = Math.max(1, Math.round(width * scale))
    const pixelHeight = Math.max(1, Math.round(height * scale))
    if (
      width === this.width &&
      height === this.height &&
      canvas.width === pixelWidth &&
      canvas.height === pixelHeight
    )
      return
    this.width = width
    this.height = height
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight
    this.ctx.setTransform(pixelWidth / width, 0, 0, pixelHeight / height, 0, 0)
    this.requestDraw()
  }

  setArtwork(artwork?: HTMLImageElement): void {
    if (!this.cheerDesign) return
    drawWingArtwork(this.wing, artwork)
    this.requestDraw()
  }

  setCheer(colors: readonly string[], lights: Readonly<PlayerCheerLights>): void {
    if (!this.cheerDesign) return
    const colorsChanged =
      colors.length !== this.cheerColors.length ||
      colors.some((color, index) => color !== this.cheerColors[index])
    if (!colorsChanged && lights === this.cheerLights) return
    this.cheerLights = lights
    if (colorsChanged) {
      const previous = this.cheerDesign
      this.cheerDesign = createCheerDesign(colors)
      this.cheerColors = colors
      releaseCheerDesign(previous)
    }
    this.requestDraw()
  }

  setActive(active: boolean, beatSequence: number): void {
    if (!this.cheerDesign) return
    if (active !== this.active) {
      this.active = active
      this.resetMusic(beatSequence)
      if (active) this.lastFrame = 0
    }
    if (document.hidden) this.stopAnimation()
    else this.requestDraw()
  }

  resetMusic(beatSequence: number): void {
    this.music.reset(beatSequence)
    this.cheerClock.reset(beatSequence)
  }

  setAudio(audio: StageAudioSample, intensity: number): void {
    if (!this.active) return
    this.cheerClock.sample(audio, intensity, performance.now())
    const accent = this.music.sample(audio, intensity)
    if (accent !== null) this.director.onBeat(accent)
  }

  dispose(): void {
    if (!this.cheerDesign) return
    this.active = false
    this.stopAnimation()
    releaseCheerDesign(this.cheerDesign)
    this.cheerDesign = undefined
    this.arena = undefined
    for (const canvas of [this.ctx.canvas, this.wing.canvas]) {
      canvas.width = 0
      canvas.height = 0
    }
  }

  private requestDraw(): void {
    if (!document.hidden) this.frame ??= requestAnimationFrame(this.tick)
  }

  private stopAnimation(): void {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame)
    this.frame = undefined
  }

  private tick = (now: number): void => {
    this.frame = undefined
    if (!this.active) {
      if (!document.hidden) this.draw(now)
      return
    }
    const elapsed = this.lastFrame ? now - this.lastFrame : FRAME_INTERVAL
    if (elapsed >= FRAME_INTERVAL - 1) {
      this.lastFrame = now
      const dt = Math.min(elapsed, 80) / 1000
      this.director.advance(dt)
      this.music.advance(dt)
      this.draw(now)
    }
    this.requestDraw()
  }

  private draw(now: number): void {
    const { ctx, width, height, cheerDesign, arena } = this
    if (!width || !height || !cheerDesign || !arena) return
    const cue = this.music.levels
    const cheer = {
      ...cheerDesign,
      lights: this.cheerLights,
      ...this.cheerClock.frame(now)
    }
    const atmosphere = cheer.palettes[0]
    const colors = atmosphere.fixtures
    const lighting = {
      ...cue,
      pulse: 0,
      kick: 0,
      energy: 0.27 + cue.energy * 0.5,
      section: 0.14 + cue.section * 0.8
    }
    const { energy, low: bass } = lighting
    const pose = this.director.pose()
    const { eye } = pose
    const project = stageProjection(pose, width, height)
    const bowlOcclusion = createArenaOcclusion(arena, project, width, height)
    const floorOcclusion = combineSpriteOcclusion(
      createStageOcclusion(project, eye, [width, height]),
      bowlOcclusion
    )
    const sky = ctx.createLinearGradient(0, 0, 0, height)
    sky.addColorStop(0, atmosphere.shade('#070508'))
    sky.addColorStop(0.55, atmosphere.shade('#171014'))
    sky.addColorStop(1, atmosphere.shade('#10080a'))
    ctx.fillStyle = sky
    ctx.fillRect(0, 0, width, height)
    drawArenaShell(ctx, project, atmosphere.shade)
    drawBowl(ctx, arena, project, atmosphere)
    drawCrowd(ctx, arena, project, width, height, false, bowlOcclusion, cheer, cheer.silhouettes)
    drawStage(ctx, project, eye, atmosphere, cue.section)
    drawStageScreens(ctx, project, eye, this.wing.canvas)
    drawEquipment(ctx, project, eye)
    drawStageLighting(ctx, project, height, cheer.fixtures, lighting, 0.27)
    drawCrowd(ctx, arena, project, width, height, true, floorOcclusion, cheer, cheer.silhouettes)
    if (cheer.lights.density && cheer.lights.brightness) {
      const crowdGlow =
        (cheer.lights.density / DEFAULT_PLAYER_CHEER_LIGHTS.density) *
        (cheer.lights.brightness / 100) *
        (0.12 + cheer.strength * 0.12)
      ctx.globalCompositeOperation = 'screen'
      for (const [index, anchor] of crowdSpill.entries()) {
        const p = project(anchor)
        if (!p || p.x < -width * 0.2 || p.x > width * 1.2 || p.y > height * 1.16) continue
        const tint = cheer.palettes[index % cheer.palettes.length].light
        glow(ctx, p.x, p.y, width * 0.28, height * 0.3, tint, Math.min(1, crowdGlow))
      }
      ctx.globalCompositeOperation = 'source-over'
    }
    const stage = project([0, 13, 16])
    if (stage) {
      ctx.globalCompositeOperation = 'screen'
      glow(ctx, stage.x, stage.y, width * 0.55, height * 0.5, colors[0], 0.125 + energy * 0.11)
      glow(
        ctx,
        stage.x,
        stage.y + height * 0.15,
        width * 0.29,
        height * 0.19,
        colors[2],
        0.182 + bass * 0.061
      )
      ctx.globalCompositeOperation = 'source-over'
    }
  }
}
