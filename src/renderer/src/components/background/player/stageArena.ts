import { projectFace, type Project, type ScreenPoint, type WorldPoint } from './stageCamera'
import {
  cheerReach,
  lightstickAngles,
  lightstickSpriteSize,
  type StageCheerFrame
} from './stageCheer'
import type { CheerPalette } from './stagePalette'
import {
  beginStageClip,
  createFaceOcclusion,
  type SpriteBounds,
  type SpriteOcclusion,
  type StageCutouts
} from './stageOcclusion'

type Context = CanvasRenderingContext2D
type Quad = readonly [WorldPoint, WorldPoint, WorldPoint, WorldPoint]
interface Face {
  corners: Quad
  fill: string
  edge?: string
  rows?: [WorldPoint, WorldPoint][]
}
interface Spectator {
  position: WorldPoint
  wrist: WorldPoint
  phase: number
  colorMix: number
  light: number
  size: number
  cheerDelay: number
  cheerTierWeight: number
}
interface CrowdBlock {
  people: Spectator[]
  corners: WorldPoint[]
}

function randomSequence(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 4294967296
  }
}

const bowlAspect = 1.19
const bowlCenterZ = -34
const rearJoin = 2.73
type SeatingPoint = (fraction: number, radius: number, y: number) => WorldPoint

function ring(angle: number, radius: number, y: number): WorldPoint {
  return [Math.sin(angle) * radius * bowlAspect, y, Math.cos(angle) * radius + bowlCenterZ]
}

function seatPoint(side: number, fraction: number, radius: number, y: number): WorldPoint {
  // Leave an access gap between the downstage wings and the nearest tier.
  const backstage = Math.max(Math.acos(42 / radius), Math.asin(56 / (radius * bowlAspect)))
  return ring(side * (backstage + fraction * (rearJoin - backstage)), radius, y)
}

function band(
  point: SeatingPoint,
  start: number,
  end: number,
  inner: number,
  front: number,
  outer: number,
  back: number
): Quad {
  return [
    point(start, inner, front),
    point(end, inner, front),
    point(end, outer, back),
    point(start, outer, back)
  ]
}

interface ArenaGeometry {
  faces: Face[]
  seatingOccluders: Quad[]
  rafters: [WorldPoint, WorldPoint][]
  stands: CrowdBlock[]
  floor: CrowdBlock[]
}

function spectator(crowdRandom: () => number, position: WorldPoint, tier = -1): Spectator {
  const [x, y, z] = position
  const wrist: WorldPoint = [
    x + (crowdRandom() - 0.5) * 0.72,
    y - 0.53 + crowdRandom() * 1.08,
    z + (crowdRandom() - 0.5) * 0.44
  ]
  const phase = crowdRandom() * Math.PI * 2
  return {
    position,
    wrist,
    phase,
    colorMix: crowdRandom(),
    light: crowdRandom(),
    size: 0.77 + crowdRandom() * 0.38,
    cheerDelay:
      Math.min(0.1, Math.abs(x) * 0.00075 + Math.max(0, -z - 6) * 0.00045) +
      (phase / (Math.PI * 2) - 0.5) * 0.17,
    cheerTierWeight: (tier + 1) / tiers.length
  }
}

function addCrowdBlock(blocks: CrowdBlock[], people: Spectator[]): void {
  if (!people.length) return
  let [minX, minY, minZ] = people[0].position
  let [maxX, maxY, maxZ] = people[0].position
  for (const {
    position: [x, y, z]
  } of people) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    minZ = Math.min(minZ, z)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
    maxZ = Math.max(maxZ, z)
  }
  const corners: WorldPoint[] = []
  for (const x of [minX, maxX]) {
    for (const y of [minY, maxY]) {
      for (const z of [minZ, maxZ]) corners.push([x, y, z])
    }
  }
  blocks.push({ people, corners })
}

function crowdBlockVisible(
  block: CrowdBlock,
  project: Project,
  width: number,
  height: number
): boolean {
  let outside = 15
  let projected = 0
  for (const corner of block.corners) {
    const p = project(corner)
    if (!p) continue
    projected++
    // Reject a block only when all eight corners are beyond the same screen edge.
    outside &=
      (p.x < -30 ? 1 : 0) |
      (p.x > width + 30 ? 2 : 0) |
      (p.y < 0 ? 4 : 0) |
      (p.y > height + 36 ? 8 : 0)
    if (!outside) return true
  }
  return projected > 0 && projected < block.corners.length
}

const tiers = [
  { radius: 59, height: 2.1, depth: 12.6, rise: 4.65, rows: 10, seats: 10, concourse: 3.4 },
  { radius: 75, height: 9.45, depth: 13.8, rise: 5.25, rows: 10, seats: 11, concourse: 3.8 },
  { radius: 92.6, height: 17.5, depth: 15.4, rise: 6.6, rows: 12, seats: 12, concourse: 4.2 }
]

export function isInsideArenaFloor(x: number, z: number): boolean {
  // Leave a service aisle on the arena side of the lowest stand's front wall.
  return (x / bowlAspect) ** 2 + (z - bowlCenterZ) ** 2 <= (tiers[0].radius - 3.3) ** 2
}

function interpolate(a: WorldPoint, b: WorldPoint, t: number): WorldPoint {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function addSeating(
  { faces, seatingOccluders, stands }: ArenaGeometry,
  crowdRandom: () => number,
  point: SeatingPoint,
  section: number,
  sectionCount: number,
  backstageEnd = false
): void {
  const start = section / sectionCount
  const end = (section + 1) / sectionCount
  const bay = end - start
  const aisle = bay * 0.1
  tiers.forEach(({ radius, height, depth, rise, rows, seats, concourse }, tier) => {
    const back = radius + depth
    const top = height + rise
    const walk = tiers[tier - 1]
    const below = walk ? walk.height + walk.rise : 0
    const fascia = band(point, start, end, radius, below, radius, height)
    const frontRail = band(point, start, end, radius - 0.06, height, radius - 0.06, height + 0.52)
    const seatsSurface = band(point, start, end, radius, height, back, top)
    const concourseSurface = band(point, start, end, back, top, back + concourse, top)
    const rowsOnSurface: [WorldPoint, WorldPoint][] = []
    seatingOccluders.push(fascia, frontRail, seatsSurface, concourseSurface)
    faces.push(
      {
        corners: fascia,
        fill: '#273040'
      },
      {
        corners: band(
          point,
          start,
          end,
          radius - 0.04,
          height - 0.42,
          radius - 0.04,
          height - 0.16
        ),
        fill: '#4b5261'
      },
      { corners: frontRail, fill: '#303b46', edge: '#424e5c' },
      {
        corners: seatsSurface,
        fill: '#192328',
        rows: rowsOnSurface
      },
      {
        corners: band(point, start, start + aisle, radius, height + 0.028, back, top + 0.028),
        fill: '#303a4a'
      },
      { corners: concourseSurface, fill: '#151d2b' }
    )
    if (section % 3 === 1) {
      const door = start + bay * 0.43
      faces.push({
        corners: band(
          point,
          door,
          door + bay * 0.14,
          radius - 0.085,
          below,
          radius - 0.085,
          below + 1.52
        ),
        fill: '#665440',
        edge: '#3d3940'
      })
    }
    if (backstageEnd) {
      const front = point(start, radius, height)
      const rearSeat = point(start, back, top)
      const rearWalk = point(start, back + concourse, top)
      const sideWall: Quad = [
        front,
        rearSeat,
        [rearSeat[0], below, rearSeat[2]],
        [front[0], below, front[2]]
      ]
      const walkWall: Quad = [
        rearSeat,
        rearWalk,
        [rearWalk[0], below, rearWalk[2]],
        [rearSeat[0], below, rearSeat[2]]
      ]
      seatingOccluders.push(sideWall, walkWall)
      faces.push({ corners: sideWall, fill: '#1c2431' }, { corners: walkWall, fill: '#1c2431' })
    }
    const people: Spectator[] = []
    for (let row = 0; row < rows; row++) {
      const setback = (row + 0.8) / (rows + 0.5)
      const left = interpolate(seatsSurface[0], seatsSurface[3], setback)
      const right = interpolate(seatsSurface[1], seatsSurface[2], setback)
      rowsOnSurface.push([
        [left[0], left[1] + 0.07, left[2]],
        [right[0], right[1] + 0.07, right[2]]
      ])
      for (let seat = 0; seat < seats; seat++) {
        const [x, y, z] = interpolate(left, right, 0.13 + 0.81 * ((seat + 0.5) / seats))
        people.push(spectator(crowdRandom, [x, y + 0.96, z], tier))
      }
    }
    addCrowdBlock(stands, people)
  })
}

function addRoofSection(
  { faces, rafters }: ArenaGeometry,
  start: number,
  end: number,
  section: number
): void {
  const inner = ring(start, 105, 43.5)
  const next = ring(end, 105, 43.5)
  const fascia = ring(start, 105, 40.2)
  const outer = ring(start, 129, 44)
  faces.push(
    {
      corners: [inner, next, ring(end, 129, 44), outer],
      fill: section % 2 ? '#1d282c' : '#182226',
      edge: '#364555'
    },
    { corners: [inner, next, ring(end, 105, 40.2), fascia], fill: '#233137', edge: '#48595f' },
    {
      corners: [ring(start, 124, 44), ring(end, 124, 44), ring(end, 119, 26), ring(start, 119, 26)],
      fill: '#141e23',
      edge: '#303a4b'
    }
  )
  rafters.push(
    [inner, ring(end, 114, 35.5)],
    [ring(start, 114, 35.5), next],
    [fascia, ring(end, 105, 40.2)],
    [ring(start, 114, 35.5), ring(end, 114, 35.5)],
    [inner, outer],
    [ring(start, 114, 35.5), outer]
  )
}

export function createArenaGeometry(): ArenaGeometry {
  const geometry: ArenaGeometry = {
    faces: [],
    seatingOccluders: [],
    rafters: [],
    stands: [],
    floor: []
  }
  const crowdRandom = randomSequence(445)
  // The two banks share the rear curve and are open at the stage end.
  for (const side of [-1, 1]) {
    const point: SeatingPoint = (fraction, radius, y) => seatPoint(side, fraction, radius, y)
    for (let section = 0; section < 19; section++)
      addSeating(geometry, crowdRandom, point, section, 19, section === 0)
  }
  for (let section = 0; section < 62; section++) {
    addRoofSection(
      geometry,
      (section / 62 - 0.5) * 5.48,
      ((section + 1) / 62 - 0.5) * 5.48,
      section
    )
  }
  const rearRoofSpan = 2 * Math.PI - 5.48
  for (let section = 0; section < 9; section++) {
    addRoofSection(
      geometry,
      2.74 + (rearRoofSpan * section) / 9,
      2.74 + (rearRoofSpan * (section + 1)) / 9,
      section
    )
  }

  // Fixed rows inside ticketed blocks, with a central passage and cross aisles.
  for (const side of [-1, 1]) {
    for (const [left, right] of [
      [5.8, 20.8],
      [23.5, 41.5],
      [44.4, 63]
    ]) {
      for (const [near, far] of [
        [-87.2, -70.2],
        [-66.8, -53],
        [-49.6, -32.8],
        [-29.4, -4.2]
      ]) {
        const people: Spectator[] = []
        for (let z = near; z <= far; z += 1.13) {
          for (let x = left; x <= right; x += 0.93) {
            if (x < (z < -35.5 ? 13 : 8.3) && z > -49.3) continue
            if (!isInsideArenaFloor(x, z)) continue
            people.push(spectator(crowdRandom, [side * x, 1.24 + crowdRandom() * 0.23, z]))
          }
        }
        addCrowdBlock(geometry.floor, people)
      }
    }
  }

  // Close the same slope, front rail, and concourse around the far end.
  const rearPoint: SeatingPoint = (fraction, radius, y) =>
    ring(rearJoin + (2 * Math.PI - 2 * rearJoin) * fraction, radius, y)
  for (let section = 0; section < 8; section++)
    addSeating(geometry, crowdRandom, rearPoint, section, 8)
  return geometry
}

export function createArenaOcclusion(
  { seatingOccluders }: ArenaGeometry,
  project: Project,
  width: number,
  height: number
): SpriteOcclusion {
  return createFaceOcclusion(project, seatingOccluders, [width, height])
}

function face(ctx: Context, points: ScreenPoint[], fill: string, edge?: string): void {
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y)
  ctx.closePath()
  ctx.fillStyle = fill
  ctx.fill()
  if (edge) {
    ctx.strokeStyle = edge
    ctx.lineWidth = 0.85
    ctx.stroke()
  }
}

export function drawBowl(
  ctx: Context,
  { faces: arena, rafters }: ArenaGeometry,
  project: Project,
  cheer: CheerPalette
): void {
  const faces: {
    points: ScreenPoint[]
    depth: number
    fill: string
    edge?: string
    rows?: Face['rows']
  }[] = []
  for (const { corners, fill, edge, rows } of arena) {
    const points = projectFace(corners, project)
    if (points.length < 3) continue
    const depth = points.reduce((sum, point) => sum + point.depth, 0) / points.length
    faces.push({ points, depth, fill, edge, rows })
  }
  faces.sort((a, b) => b.depth - a.depth)
  const rowColor = `rgb(${cheer.light} / 15%)`
  for (const { points, fill, edge, rows } of faces) {
    face(ctx, points, cheer.shade(fill), edge && cheer.shade(edge))
    if (rows) drawLines(ctx, project, rows, rowColor, 0.78)
  }
  drawLines(ctx, project, rafters, `rgb(${cheer.light} / 13%)`, 1.1)
}

function drawLines(
  ctx: Context,
  project: Project,
  segments: [WorldPoint, WorldPoint][],
  color: string,
  width: number
): void {
  ctx.beginPath()
  for (const [from, to] of segments) {
    const a = project(from)
    const b = project(to)
    if (!a || !b) continue
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
  }
  ctx.strokeStyle = color
  ctx.lineWidth = width
  ctx.stroke()
}

export function createCrowdSilhouettes(cheer: CheerPalette): HTMLCanvasElement[] {
  const rims = [`rgb(${cheer.light} / 30%)`, `rgb(${cheer.light} / 13%)`]
  return rims.map((rim) => {
    const canvas = document.createElement('canvas')
    canvas.width = 22
    canvas.height = 26
    const ctx = canvas.getContext('2d')
    if (!ctx) return canvas
    ctx.fillStyle = cheer.shade('#090a11')
    ctx.beginPath()
    ctx.ellipse(11, 6, 4.2, 5.3, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.moveTo(14, 10)
    ctx.quadraticCurveTo(20, 12, 20, 24)
    ctx.lineTo(2, 24)
    ctx.quadraticCurveTo(2, 12, 8, 10)
    ctx.closePath()
    ctx.fill()
    ctx.strokeStyle = rim
    ctx.beginPath()
    ctx.ellipse(11, 6, 4.2, 5.3, 0, Math.PI * 1.07, Math.PI * 1.65)
    ctx.moveTo(7.7, 10.8)
    ctx.quadraticCurveTo(3.8, 12.8, 2.8, 19)
    ctx.stroke()
    return canvas
  })
}

function drawCheerArm(
  ctx: Context,
  shoulder: ScreenPoint,
  elbow: ScreenPoint,
  hand: ScreenPoint,
  thickness: number,
  occlude: SpriteOcclusion
): void {
  const left = Math.min(shoulder.x, elbow.x, hand.x)
  const top = Math.min(shoulder.y, elbow.y, hand.y)
  const bounds: SpriteBounds = [
    left - thickness,
    top - thickness,
    Math.max(shoulder.x, elbow.x, hand.x) - left + thickness * 2,
    Math.max(shoulder.y, elbow.y, hand.y) - top + thickness * 2
  ]
  const cutouts = occlude(bounds, Math.max(shoulder.depth, elbow.depth, hand.depth))
  if (cutouts === null) return
  const clipped = beginStageClip(ctx, bounds, cutouts)
  ctx.beginPath()
  ctx.moveTo(shoulder.x, shoulder.y)
  ctx.lineTo(elbow.x, elbow.y)
  ctx.lineTo(hand.x, hand.y)
  ctx.lineWidth = thickness
  ctx.stroke()
  if (clipped) ctx.restore()
}

const stickDirections = Array.from({ length: lightstickAngles }, (_, index) => {
  const angle = (index - (lightstickAngles - 1) / 2) * 0.04
  return [Math.sin(angle), -Math.cos(angle)] as const
})

export function drawCrowd(
  ctx: Context,
  { floor, stands }: ArenaGeometry,
  project: Project,
  width: number,
  height: number,
  front: boolean,
  occlude: SpriteOcclusion,
  cheer: StageCheerFrame,
  bodies: readonly HTMLCanvasElement[]
): void {
  const atmosphere = cheer.palettes[0]
  const opacityLevels = 3
  const colors = cheer.palettes.map((palette, index) => ({
    sourceY: index * lightstickSpriteSize,
    halo: `rgb(${palette.light} / 34%)`,
    core: `rgb(${palette.distantCore} / 92%)`,
    batches: Array.from({ length: opacityLevels }, () => ({
      distant: new Path2D(),
      hasDistant: false,
      near: [] as { sourceX: number; area: SpriteBounds; cutouts: StageCutouts }[]
    }))
  }))
  const blocks = front ? floor : stands
  const { beat, strength, period, previousPeriod, periodBlend, lights } = cheer
  const density = lights.density / 100
  const brightness = lights.brightness / 100
  const variation = 2 * (1 - lights.uniformity / 100)
  const tierCoverage = 0.4 * density * (1 - density)
  ctx.save()
  ctx.lineCap = 'round'
  ctx.strokeStyle = atmosphere.shade('#222129')
  const bodyColor = front ? '#090e11' : '#1f2c31'
  ctx.fillStyle = atmosphere.shade(bodyColor)
  for (const block of blocks) {
    if (!crowdBlockVisible(block, project, width, height)) continue
    for (const {
      position,
      wrist,
      light,
      size,
      phase,
      colorMix,
      cheerDelay,
      cheerTierWeight
    } of block.people) {
      const p = project(position)
      if (!p || p.x < -30 || p.x > width + 30 || p.y < 0 || p.y > height + 36) continue
      const radius = Math.min(14, Math.max(0.55, (height * size * 0.135) / p.depth))
      const silhouette = radius >= (front ? 1.25 : 2.05)
      // At this distance a body is only a dark pixel against the seat rows.
      if (radius >= 0.9) {
        const body: SpriteBounds = silhouette
          ? [p.x - radius * 2.5, p.y - radius * 1.4, radius * 5, radius * 5.7]
          : [p.x - radius * 0.6, p.y - radius * 0.5, radius * 1.55, radius * (front ? 1.8 : 1.3)]
        const bodyCutouts = occlude(body, p.depth)
        if (bodyCutouts !== null) {
          const clipped = beginStageClip(ctx, body, bodyCutouts)
          if (silhouette) ctx.drawImage(bodies[Number(light <= 0.61)], ...body)
          else ctx.fillRect(...body)
          if (clipped) ctx.restore()
        }
      }
      // Use each seat's fixed light value so changing density never shuffles the crowd.
      if (!brightness || !density || light < 1 - density - tierCoverage * cheerTierWeight) continue
      const localBeat = beat - cheerDelay * variation
      const effort = (0.89 + 0.11 * variation * Math.cos(localBeat * Math.PI - phase)) * strength
      const reach = cheerReach(localBeat, period, previousPeriod, periodBlend)
      const lift = reach * effort
      const side = phase > 4.4 ? -1 : 1
      const [x, y, z] = position
      const armOffset = (wrist[0] - x) * 0.22 * variation
      const lamp = project([
        x + side * (0.59 - lift * 0.2) + armOffset,
        y - 0.37 + 0.22 * cheerTierWeight + (1.37 + (size - 1) * 0.58 * variation) * lift,
        z + 0.22 + lift * 0.25
      ])
      if (!lamp) continue
      const half = Math.min(
        20,
        Math.max(3 + 0.52 * cheerTierWeight, radius * (2.16 + 0.13 * cheerTierWeight))
      )
      const area: SpriteBounds = [lamp.x - half, lamp.y - half * 1.3, half * 2, half * 2]
      const cutouts = occlude(area, lamp.depth)
      if (cutouts === null) continue
      if (silhouette && radius >= 2.4) {
        const shoulder = project([x + side * 0.23, y - 0.27, z])
        const elbow = project([x + side * (0.65 - 0.16 * lift), y - 0.64 + 0.85 * lift, z + 0.11])
        if (shoulder && elbow) drawCheerArm(ctx, shoulder, elbow, lamp, radius * 0.42, occlude)
      }
      const wristLag =
        (reach - cheerReach(localBeat - 0.09, period, previousPeriod, periodBlend)) * effort
      const tilt = side * (0.31 - 0.22 * lift - 0.55 * wristLag)
      const angle = Math.round((0.5 + tilt * 0.5) * (lightstickAngles - 1))
      const glow = light + 0.14 * cheerTierWeight
      const group = glow > 0.83 ? 2 : glow > 0.61 ? 1 : 0
      const batch = colors[Math.floor(colorMix * colors.length)].batches[group]
      // The distant light tube and its halo can share strokes whenever the sprite is unobstructed.
      if (half <= 4.4 && !cutouts.length) {
        const [dx, dy] = stickDirections[angle]
        batch.distant.moveTo(lamp.x + dx * half * 0.15, lamp.y + dy * half * 0.15)
        batch.distant.lineTo(lamp.x + dx * half * 0.85, lamp.y + dy * half * 0.85)
        batch.hasDistant = true
      } else {
        batch.near.push({ sourceX: angle * lightstickSpriteSize, area, cutouts })
      }
    }
  }
  for (let group = 0; group < opacityLevels; group++) {
    ctx.globalAlpha = Math.min(1, brightness * (0.56 + group * 0.19 + 0.13 * strength))
    for (const { sourceY, halo, core, batches } of colors) {
      const { distant, hasDistant, near } = batches[group]
      if (hasDistant) {
        ctx.strokeStyle = halo
        ctx.lineWidth = 2.4
        ctx.stroke(distant)
        ctx.strokeStyle = core
        ctx.lineWidth = 1.05
        ctx.stroke(distant)
      }
      for (const { sourceX, area, cutouts } of near) {
        const clipped = beginStageClip(ctx, area, cutouts)
        ctx.drawImage(
          cheer.stickAtlas,
          sourceX,
          sourceY,
          lightstickSpriteSize,
          lightstickSpriteSize,
          ...area
        )
        if (clipped) ctx.restore()
      }
    }
  }
  ctx.restore()
}
