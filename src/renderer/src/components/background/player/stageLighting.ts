import type { Project, ScreenPoint, WorldPoint } from './stageCamera'
import {
  rigDepth,
  rigHeight,
  runwayLights,
  stageDeckHeight,
  stageLightColumns
} from './stageScenery'
import type { StageMusicCue } from './stageMusic'
import type { StageColors } from './stagePalette'
import { glow } from './stageVideoWall'

type Context = CanvasRenderingContext2D

const spotFixtures = [
  ...[-45, -35, -25, -15, -5, 5, 15, 25, 35, 45].map((x) => ({ x, hanging: true })),
  ...[-46, -27, 27, 46].map((x) => ({ x, hanging: false }))
]

const pointLights: { position: WorldPoint; progress: number; size: number; column?: boolean }[] = []
const edgeHeight = stageDeckHeight + 0.055
for (const x of runwayLights) {
  for (let index = 0; index < 15; index++)
    pointLights.push({
      position: [x, edgeHeight, 4 - index * 2.96],
      progress: (index * 2.96) / 49.93,
      size: 0.95
    })
}
for (let index = 0; index < 12; index++) {
  pointLights.push({
    position: [-9.4 + index * 1.7, edgeHeight, -45.93],
    progress: 1,
    size: 1
  })
}
for (const x of stageLightColumns.centers) {
  for (let index = 0; index < 10; index++)
    pointLights.push({
      position: [x, 4.7 + index * 3, stageLightColumns.front - 0.045],
      progress: index / 9,
      size: 1.38,
      column: true
    })
}

function textureContext(width: number, height: number): Context {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Stage light texture canvas is unavailable')
  return context
}

function beamTexture(color: string): HTMLCanvasElement {
  const ctx = textureContext(96, 192)
  const { width, height } = ctx.canvas
  const pixels = ctx.createImageData(width, height)
  const [red, green, blue] = color.split(' ').map(Number)
  for (let y = 0; y < height; y++) {
    const fraction = (y + 0.5) / height
    const radius = 0.034 + fraction * 0.962
    const fade = (1 - fraction) ** 1.13
    for (let x = 0; x < width; x++) {
      const distance = Math.abs(((x + 0.5) / width) * 2 - 1) / radius
      const index = (y * width + x) * 4
      pixels.data[index] = red
      pixels.data[index + 1] = green
      pixels.data[index + 2] = blue
      pixels.data[index + 3] = 255 * fade * Math.max(0, 1 - distance * distance) ** 2
    }
  }
  ctx.putImageData(pixels, 0, 0)
  return ctx.canvas
}

function pointTexture(color: string): HTMLCanvasElement {
  const ctx = textureContext(40, 40)
  glow(ctx, 20, 20, 20, 20, color, 0.77)
  ctx.beginPath()
  ctx.ellipse(20, 20, 4.2, 3.5, 0, 0, Math.PI * 2)
  ctx.fillStyle = `rgb(${color})`
  ctx.fill()
  glow(ctx, 20, 20, 4.25, 3.55, '250 244 230', 0.92)
  return ctx.canvas
}

export function createLightTextures(colors: StageColors): {
  beams: HTMLCanvasElement[]
  lens: HTMLCanvasElement[]
  markers: HTMLCanvasElement
} {
  return {
    beams: colors.map(beamTexture),
    lens: colors.map(pointTexture),
    markers: pointTexture(colors[2])
  }
}

function drawHousing(
  ctx: Context,
  mount: ScreenPoint,
  pivot: ScreenPoint,
  lens: ScreenPoint,
  angle: number,
  radius: number,
  hanging: boolean
): void {
  ctx.strokeStyle = '#737e8e'
  ctx.lineWidth = Math.max(1, radius * 0.36)
  ctx.beginPath()
  ctx.moveTo(mount.x, mount.y)
  ctx.lineTo(pivot.x, pivot.y)
  ctx.stroke()
  ctx.save()
  ctx.translate(pivot.x, pivot.y)
  ctx.rotate(angle)
  const nose = Math.hypot(lens.x - pivot.x, lens.y - pivot.y)
  ctx.fillStyle = '#111624'
  ctx.strokeStyle = '#555d6c'
  ctx.lineWidth = Math.max(0.7, radius * 0.16)
  ctx.beginPath()
  ctx.roundRect(-radius, -radius * 0.9, 2 * radius, nose + radius * 1.05, radius * 0.34)
  ctx.fill()
  ctx.stroke()
  ctx.fillStyle = '#2d3545'
  ctx.fillRect(-radius * 0.94, nose - radius * 0.24, radius * 1.88, radius * 0.35)
  ctx.restore()
  if (!hanging) {
    ctx.fillStyle = '#111624'
    ctx.fillRect(mount.x - radius * 1.38, mount.y - radius * 0.3, radius * 2.76, radius * 0.42)
  }
}

export function spotlightCue(
  x: number,
  hanging: boolean,
  cue: Readonly<StageMusicCue>
): { aim: WorldPoint; spread: number; opacity: number; gel: number } {
  const { energy, low, mid, high, section, phase, pulse, kick, beatSequence } = cue
  const side = Math.sign(x)
  const beatAngle = (phase * Math.PI) / 4
  const fixtureOffset = Math.abs(x) * 0.024
  const sweep = Math.sin(beatAngle + fixtureOffset) * side
  const accent = side === (beatSequence % 2 ? -1 : 1) ? pulse : pulse * 0.58

  if (!hanging)
    return {
      aim: [
        x * (0.79 - 0.17 * low) + sweep * (4 + 17 * low),
        18 + 10 * low + 9 * section + 6 * kick,
        1 - 12 * low - 9 * section
      ],
      opacity: 0.16 + 0.22 * low + 0.08 * energy + 0.19 * kick,
      spread: 0.028 + 0.025 * low + 0.012 * kick,
      gel: 2
    }
  if (Math.abs(x) >= 35) {
    const wingAngle = 2 * beatAngle + fixtureOffset + 0.75
    return {
      aim: [
        side * (16 + 31 * section + 11 * high + Math.sin(wingAngle) * (5 + 17 * high)),
        1.2 + (8 + Math.cos(wingAngle) * 3) * high + 4 * section,
        -13 - 30 * section - 9 * high
      ],
      opacity: 0.13 + 0.22 * high + 0.11 * energy + 0.2 * accent,
      spread: 0.028 + 0.018 * high,
      gel: 0
    }
  }
  return {
    aim: [
      x * (0.49 + 0.48 * section) + sweep * (5 + 14 * mid + 9 * section),
      stageDeckHeight + 0.8 * mid,
      7 - 28 * section - 9 * mid
    ],
    opacity: 0.15 + 0.18 * mid + 0.11 * energy + 0.21 * accent,
    spread: 0.028 + 0.017 * mid,
    gel: 1
  }
}

export function markerIntensity(
  progress: number,
  column: boolean,
  cue: Readonly<StageMusicCue>
): number {
  if (column) {
    const ripple = 0.5 + 0.5 * Math.cos(progress * 6.8 - (cue.phase * Math.PI) / 2)
    return 0.27 + cue.high * (0.24 + 0.16 * ripple) + cue.pulse * 0.24
  }
  const wave = Math.max(0, 1 - Math.abs(progress - cue.chase) * 5.6)
  return 0.26 + cue.low * 0.27 + cue.pulse * 0.16 + cue.kick * (0.12 + 0.5 * wave)
}

export function drawStageLighting(
  ctx: Context,
  project: Project,
  height: number,
  textures: ReturnType<typeof createLightTextures>,
  cue: Readonly<StageMusicCue>,
  spill = 0
): void {
  ctx.save()
  for (const { x, hanging } of spotFixtures) {
    const z = hanging ? rigDepth : 6.9
    const y = hanging ? rigHeight : stageDeckHeight + 0.06
    const pivotY = y + (hanging ? -0.68 : 0.68)
    const { aim, gel, spread, opacity } = spotlightCue(x, hanging, cue)
    const [dx, dy, dz] = [aim[0] - x, aim[1] - pivotY, aim[2] - z]
    const length = Math.hypot(dx, dy, dz)
    // The fixture and the light cone share the projected lens position.
    const nozzle: WorldPoint = [
      x + (dx / length) * 1.03,
      pivotY + (dy / length) * 1.03,
      z + (dz / length) * 1.03
    ]
    const mount = project([x, y, z])
    const pivot = project([x, pivotY, z])
    const lens = project(nozzle)
    if (!mount || !pivot || !lens) continue
    const angle = Math.atan2(pivot.x - lens.x, lens.y - pivot.y)
    const radius = Math.max(1.15, (height * 0.51) / lens.depth)
    drawHousing(ctx, mount, pivot, lens, angle, radius, hanging)
    const target = project(aim)
    const reach = target ? Math.hypot(lens.x - target.x, lens.y - target.y) * 1.25 : height * 1.1
    const width = height * spread
    ctx.save()
    ctx.globalCompositeOperation = 'screen'
    ctx.translate(lens.x, lens.y)
    ctx.rotate(angle)
    ctx.globalAlpha = opacity
    ctx.drawImage(textures.beams[gel], -width, 0, width * 2, reach)
    ctx.globalAlpha = Math.min(0.97, 0.46 + opacity * 0.82)
    const bloomSize = radius * (4.9 + spill * 7)
    ctx.drawImage(textures.lens[gel], -bloomSize / 2, -bloomSize / 2, bloomSize, bloomSize)
    ctx.restore()
  }
  ctx.globalCompositeOperation = 'screen'
  for (const { position, progress, size, column } of pointLights) {
    const point = project(position)
    if (!point) continue
    const diameter = Math.max(5, (height * size) / point.depth)
    ctx.globalAlpha = Math.min(1, markerIntensity(progress, Boolean(column), cue) + spill)
    ctx.drawImage(
      textures.markers,
      point.x - diameter / 2,
      point.y - diameter / 2,
      diameter,
      diameter
    )
  }
  ctx.restore()
}
