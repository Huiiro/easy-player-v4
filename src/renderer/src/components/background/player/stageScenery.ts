import { projectFace, type Project, type WorldPoint } from './stageCamera'
import type { CheerPalette } from './stagePalette'
import { drawStageSpeakers, lineArrayHang } from './stageSpeakers'
import { drawVideoWall, glow } from './stageVideoWall'

type Context = CanvasRenderingContext2D
type Quad = readonly [WorldPoint, WorldPoint, WorldPoint, WorldPoint]
type Box = readonly [min: WorldPoint, max: WorldPoint]

export const stageDeckHeight = 1.9

const deck: Box = [
  [-53, 0, 5],
  [53, stageDeckHeight, 31]
]
const runway: Box = [
  [-5.3, 0, -38],
  [5.3, stageDeckHeight, 5]
]
const thrust: Box = [
  [-10, 0, -46],
  [10, stageDeckHeight, -38]
]
export const stagePlatforms = [deck, runway, thrust] as const
export const rigHeight = 34.8
export const rigDepth = 14
export const runwayLights = [-5.3, 5.3]
export const stageLightColumns = { centers: [-48, 48], front: 12.2, back: 14, halfWidth: 0.88 }

export const mainScreen: Quad = [
  [-31, 29, 24],
  [31, 29, 24],
  [31, 6, 24],
  [-31, 6, 24]
]
const wingFrames = [
  [-51, -32.15],
  [32.15, 51]
] as const
const wingCenters = wingFrames.map(([left, right]) => (left + right) / 2)
export const wingScreens: readonly Quad[] = wingCenters.map((x) => [
  [x - 8, 24, 22],
  [x + 8, 24, 22],
  [x + 8, 7, 22],
  [x - 8, 7, 22]
])

const screenBays = [
  {
    screen: mainScreen,
    housing: [
      [-32.15, stageDeckHeight, 24.24],
      [32.15, 31, 31]
    ],
    center: [0, 16, 26]
  },
  ...wingFrames.map(([left, right], index) => ({
    screen: wingScreens[index],
    housing: [
      [left, stageDeckHeight, 22.24],
      [right, 26.4, 31]
    ] as Box,
    center: [wingCenters[index], 14, 24] as WorldPoint
  }))
] as const

function plane(
  ctx: Context,
  project: Project,
  points: readonly WorldPoint[],
  color: string,
  edge?: string
): void {
  const vertices = projectFace(points, project)
  if (vertices.length < 3) return
  ctx.beginPath()
  ctx.moveTo(vertices[0].x, vertices[0].y)
  for (const vertex of vertices.slice(1)) ctx.lineTo(vertex.x, vertex.y)
  ctx.closePath()
  ctx.fillStyle = color
  ctx.fill()
  if (edge) {
    ctx.strokeStyle = edge
    ctx.lineWidth = 0.8
    ctx.stroke()
  }
}

interface BoxFace {
  corners: Quad
  side: 'top' | 'front' | 'side'
}

export function visibleBoxFaces([[l, b, f], [r, t, k]]: Box, eye: WorldPoint): BoxFace[] {
  const faces: BoxFace[] = []
  if (eye[0] < l)
    faces.push({
      corners: [
        [l, b, f],
        [l, b, k],
        [l, t, k],
        [l, t, f]
      ],
      side: 'side'
    })
  if (eye[0] > r)
    faces.push({
      corners: [
        [r, b, f],
        [r, b, k],
        [r, t, k],
        [r, t, f]
      ],
      side: 'side'
    })
  if (eye[2] < f)
    faces.push({
      corners: [
        [l, b, f],
        [r, b, f],
        [r, t, f],
        [l, t, f]
      ],
      side: 'front'
    })
  if (eye[2] > k)
    faces.push({
      corners: [
        [l, b, k],
        [r, b, k],
        [r, t, k],
        [l, t, k]
      ],
      side: 'front'
    })
  if (eye[1] > t)
    faces.push({
      corners: [
        [l, t, k],
        [r, t, k],
        [r, t, f],
        [l, t, f]
      ],
      side: 'top'
    })
  return faces
}

function solid(
  ctx: Context,
  project: Project,
  eye: WorldPoint,
  box: Box,
  top: string,
  front: string,
  side: string
): void {
  const finishes = { top, front, side }
  for (const face of visibleBoxFaces(box, eye))
    plane(ctx, project, face.corners, finishes[face.side])
}

function segment(ctx: Context, project: Project, from: WorldPoint, to: WorldPoint): void {
  const a = project(from)
  const b = project(to)
  if (!a || !b) return
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
}

export function drawArenaShell(
  ctx: Context,
  project: Project,
  shade = (color: string): string => color
): void {
  plane(
    ctx,
    project,
    [
      [-122, 0, 33],
      [122, 0, 33],
      [122, 0, -132],
      [-122, 0, -132]
    ],
    shade('#0d1318')
  )
  plane(
    ctx,
    project,
    [
      [-72, 0, 32],
      [72, 0, 32],
      [72, 39, 32],
      [-72, 39, 32]
    ],
    shade('#0b101d')
  )
  ctx.beginPath()
  for (const x of [-70, -59, 59, 70]) segment(ctx, project, [x, 1, 31.8], [x, 39, 31.8])
  ctx.strokeStyle = shade('#1b2337')
  ctx.lineWidth = 1.1
  ctx.stroke()
  plane(
    ctx,
    project,
    [
      [-100, 44.4, 29],
      [100, 44.4, 29],
      [100, 45.4, 24],
      [-100, 45.4, 24]
    ],
    shade('#252e42')
  )
}

export function drawStage(
  ctx: Context,
  project: Project,
  eye: WorldPoint,
  cheer?: CheerPalette,
  wash = 0
): void {
  const shade = cheer?.shade ?? ((color: string): string => color)
  // Downstage deck and the two connected pieces of the runway share a floor height.
  solid(ctx, project, eye, deck, shade('#242b30'), shade('#181e22'), shade('#14191d'))
  solid(ctx, project, eye, runway, shade('#22292c'), shade('#171c20'), shade('#12191d'))
  solid(ctx, project, eye, thrust, shade('#22292c'), shade('#181e20'), shade('#13191e'))
  if (cheer) {
    const deckTop = projectFace(
      [
        [-53, stageDeckHeight, 5],
        [53, stageDeckHeight, 5],
        [53, stageDeckHeight, 31],
        [-53, stageDeckHeight, 31]
      ],
      project
    )
    const center = project([0, stageDeckHeight, 15.2])
    if (center && deckTop.length >= 3) {
      const xs = deckTop.map(({ x }) => x)
      const ys = deckTop.map(({ y }) => y)
      ctx.save()
      ctx.beginPath()
      ctx.moveTo(deckTop[0].x, deckTop[0].y)
      for (const point of deckTop.slice(1)) ctx.lineTo(point.x, point.y)
      ctx.closePath()
      ctx.clip()
      ctx.globalCompositeOperation = 'screen'
      glow(
        ctx,
        center.x,
        center.y,
        Math.max(3, 0.56 * (Math.max(...xs) - Math.min(...xs))),
        Math.max(3, 0.66 * (Math.max(...ys) - Math.min(...ys))),
        cheer.fixtures[1],
        0.58 + wash * 0.22
      )
      ctx.restore()
    }
  }
  const trim = stageDeckHeight + 0.01
  ctx.beginPath()
  for (const side of [-1, 1]) {
    const x = side * 5.3
    segment(ctx, project, [x, trim, 5], [x, trim, -38])
    segment(ctx, project, [x, trim, -38], [side * 10, trim, -38])
    segment(ctx, project, [side * 10, trim, -38], [side * 10, trim, -46])
    segment(ctx, project, [x, trim, 5], [side * 53, trim, 5])
  }
  segment(ctx, project, [-10, trim, -46], [10, trim, -46])
  ctx.strokeStyle = cheer ? `rgb(${cheer.core} / 0.54)` : '#4e5657'
  ctx.lineWidth = 1
  ctx.stroke()
}

export function drawStageScreens(
  ctx: Context,
  project: Project,
  eye: WorldPoint,
  wingTexture: HTMLCanvasElement
): void {
  const order = [...screenBays].sort((a, b) => project.depth(b.center) - project.depth(a.center))
  for (const { screen, housing } of order) {
    solid(ctx, project, eye, housing, '#232b2f', '#151b21', '#11171b')
    if (screen === mainScreen) plane(ctx, project, screen, '#090e12', '#2a3338')
    else drawVideoWall(ctx, project, screen, wingTexture)
  }
}

function drawLightColumns(ctx: Context, project: Project, eye: WorldPoint): void {
  const { centers, front, back, halfWidth } = stageLightColumns
  for (const x of centers) {
    const left = x - halfWidth
    const right = x + halfWidth
    const bottom = stageDeckHeight + 0.32
    solid(
      ctx,
      project,
      eye,
      [
        [x - 1.15, stageDeckHeight, front - 0.21],
        [x + 1.15, bottom, back + 0.2]
      ],
      '#303848',
      '#181f2c',
      '#131a25'
    )
    solid(
      ctx,
      project,
      eye,
      [
        [left, bottom, front],
        [right, rigHeight, back]
      ],
      '#313a4a',
      '#191f2c',
      '#131b26'
    )
    ctx.beginPath()
    const side = eye[0] < x ? left : right
    // Front and side bracing follow the real corners of the truss.
    for (const rail of [left + 0.07, right - 0.07]) {
      segment(ctx, project, [rail, bottom, front - 0.015], [rail, rigHeight, front - 0.015])
    }
    segment(ctx, project, [side, bottom, back], [side, rigHeight, back])
    for (let y = bottom; y < rigHeight; y += 2.65) {
      const top = Math.min(rigHeight, y + 2.65)
      segment(ctx, project, [left, y, front - 0.02], [right, (y + top) / 2, front - 0.02])
      segment(ctx, project, [right, (y + top) / 2, front - 0.02], [left, top, front - 0.02])
      segment(ctx, project, [side, y, front], [side, (y + top) / 2, back])
      segment(ctx, project, [side, (y + top) / 2, back], [side, top, front])
    }
    ctx.strokeStyle = '#4d596c'
    ctx.lineWidth = 0.96
    ctx.stroke()
  }
}

const backline = [
  { x: -36.5, z: 17, width: 2.8, depth: 1.65, height: 2.6, kind: 'amp' },
  { x: -32.8, z: 18.4, width: 2.8, depth: 1.65, height: 2.32, kind: 'amp' },
  { x: -28.9, z: 19.6, width: 3.0, depth: 1.85, height: 0.92, kind: 'case' },
  { x: 26.8, z: 18.4, width: 2.4, depth: 1.85, height: 2.14, kind: 'rack' },
  { x: 30.0, z: 19.0, width: 2.4, depth: 1.85, height: 1.74, kind: 'rack' },
  { x: 34.6, z: 17.6, width: 3.1, depth: 1.72, height: 1.1, kind: 'case' },
  { x: 38.0, z: 19.3, width: 2.8, depth: 1.75, height: 1.36, kind: 'case' }
] as const

function drawBackline(ctx: Context, project: Project, eye: WorldPoint): void {
  const order = [...backline].sort(
    (a, b) =>
      project.depth([b.x, stageDeckHeight, b.z]) - project.depth([a.x, stageDeckHeight, a.z])
  )
  for (const { x, z, width, depth, height, kind } of order) {
    const left = x - width / 2
    const right = x + width / 2
    const bottom = stageDeckHeight + 0.04
    const top = bottom + height
    solid(
      ctx,
      project,
      eye,
      [
        [left, bottom, z],
        [right, top, z + depth]
      ],
      '#333e45',
      '#182027',
      '#222b32'
    )
    const front = z - 0.018
    const panel = (
      l: number,
      b: number,
      r: number,
      t: number,
      color: string,
      edge?: string
    ): void =>
      plane(
        ctx,
        project,
        [
          [l, b, front],
          [r, b, front],
          [r, t, front],
          [l, t, front]
        ],
        color,
        edge
      )
    if (kind === 'case') {
      panel(left + 0.09, bottom + 0.1, right - 0.09, top - 0.1, '#1b242a', '#53616a')
      panel(left + 0.13, top - 0.3, right - 0.13, top - 0.21, '#53616a')
      for (const handle of [x - width * 0.27, x + width * 0.27])
        panel(handle - 0.18, top - 0.47, handle + 0.18, top - 0.31, '#0b1318', '#53616a')
    } else if (kind === 'amp') {
      panel(left + 0.16, bottom + 0.16, right - 0.16, top - 0.45, '#2b3439', '#657275')
      panel(left + 0.16, top - 0.38, right - 0.16, top - 0.13, '#655743')
      for (const knob of [-0.58, -0.3, -0.02, 0.26, 0.54])
        panel(x + knob, top - 0.29, x + knob + 0.07, top - 0.2, '#13191b')
    } else {
      panel(left + 0.12, bottom + 0.1, right - 0.12, top - 0.12, '#0f171c', '#4a5960')
      for (let row = 0; row < 4; row++) {
        const y = bottom + 0.29 + row * height * 0.18
        panel(left + 0.22, y, right - 0.22, y + 0.12, '#303e45')
        panel(right - 0.58, y + 0.015, right - 0.42, y + 0.085, row % 2 ? '#709287' : '#a98b61')
      }
    }
  }
}

function drawMicrophones(ctx: Context, project: Project): void {
  ctx.beginPath()
  const floor = stageDeckHeight + 0.025
  for (const [x, z, lean] of [
    [-12, 11, 1],
    [-8.1, 8.6, 1],
    [9.3, 9.7, -1],
    [13.4, 11.8, -1]
  ]) {
    segment(ctx, project, [x, floor, z], [x, floor + 1.49, z])
    segment(
      ctx,
      project,
      [x - lean * 0.37, floor + 1.36, z + 0.39],
      [x + lean * 0.55, floor + 1.73, z - 0.24]
    )
    segment(ctx, project, [x, floor + 0.11, z], [x - 0.36, floor, z - 0.19])
    segment(ctx, project, [x, floor + 0.11, z], [x + 0.37, floor, z - 0.19])
    segment(ctx, project, [x, floor + 0.11, z], [x, floor, z + 0.35])
  }
  ctx.strokeStyle = '#778287'
  ctx.lineWidth = 1.03
  ctx.stroke()
}

function drawKeyboard(ctx: Context, project: Project, eye: WorldPoint, x: number): void {
  const left = x - 2.29
  const right = x + 2.29
  const top = stageDeckHeight + 1.93
  for (const offset of [-1.65, 1.65]) {
    solid(
      ctx,
      project,
      eye,
      [
        [x + offset - 0.12, stageDeckHeight, 16.54],
        [x + offset + 0.12, top - 0.22, 16.79]
      ],
      '#4a535a',
      '#3b454d',
      '#1e282d'
    )
  }
  solid(
    ctx,
    project,
    eye,
    [
      [left, top - 0.22, 16],
      [right, top, 17.42]
    ],
    '#373e43',
    '#232a30',
    '#192127'
  )
  const surface = (
    l: number,
    r: number,
    start: number,
    end: number,
    y: number,
    color: string
  ): void =>
    plane(
      ctx,
      project,
      [
        [l, y, start],
        [r, y, start],
        [r, y, end],
        [l, y, end]
      ],
      color
    )

  surface(left + 0.1, right - 0.1, 16.08, 16.4, top + 0.004, '#272e34')
  surface(left + 0.36, left + 1.2, 16.158, 16.318, top + 0.008, '#588c8a')
  for (const offset of [1.52, 1.73, 2.03, 2.24, 3.26, 3.45, 3.64]) {
    surface(left + offset, left + offset + 0.086, 16.16, 16.29, top + 0.012, '#77878d')
  }

  const bedLeft = left + 0.145
  const bedRight = right - 0.145
  const keyWidth = (bedRight - bedLeft) / 29
  const whiteTop = top + 0.018
  surface(bedLeft, bedRight, 16.42, 17.34, top + 0.007, '#171d21')
  for (let note = 0; note < 29; note++) {
    const key = bedLeft + note * keyWidth
    surface(key + 0.009, key + keyWidth - 0.009, 16.44, 17.32, whiteTop, '#e4e1d7')
  }
  for (let note = 0; note < 28; note++) {
    if (note % 7 === 2 || note % 7 === 6) continue
    const gap = bedLeft + (note + 1) * keyWidth
    const l = gap - keyWidth * 0.29
    const r = gap + keyWidth * 0.29
    const sharpTop = whiteTop + 0.064
    const edge = eye[0] < gap ? l : r
    plane(
      ctx,
      project,
      [
        [edge, whiteTop, 16.43],
        [edge, whiteTop, 17.02],
        [edge, sharpTop, 17.02],
        [edge, sharpTop, 16.43]
      ],
      '#2d3539'
    )
    surface(l, r, 16.43, 17.02, sharpTop, '#0b1115')
  }
}

export function drawEquipment(ctx: Context, project: Project, eye: WorldPoint): void {
  // Two connected trusses span the stage, with suspension cables and line arrays.
  ctx.beginPath()
  for (const z of [14, 26]) {
    for (const y of [34.8, 37.2]) segment(ctx, project, [-55, y, z], [55, y, z])
    for (let x = -55; x < 54; x += 5) {
      segment(ctx, project, [x, 34.8, z], [x + 2.5, 37.2, z])
      segment(ctx, project, [x + 2.5, 37.2, z], [x + 5, 34.8, z])
    }
  }
  for (const x of [-54, -35, -14, 14, 35, 54]) {
    segment(ctx, project, [x, 37.2, 14], [x, 37.2, 26])
    segment(ctx, project, [x, 37.2, 20], [x, 45, 27])
  }
  for (const x of [-lineArrayHang.x, lineArrayHang.x]) {
    for (const offset of [-1.42, 1.42]) {
      segment(
        ctx,
        project,
        [x + offset, rigHeight, rigDepth],
        [x + offset, lineArrayHang.y + 0.21, lineArrayHang.z + 1.04]
      )
      segment(
        ctx,
        project,
        [x + offset, lineArrayHang.y + 0.24, lineArrayHang.z + 1.04],
        [x + offset, lineArrayHang.y + 0.035, lineArrayHang.z + 1.04]
      )
    }
    segment(
      ctx,
      project,
      [x - 1.7, lineArrayHang.y + 0.24, lineArrayHang.z + 1.04],
      [x + 1.7, lineArrayHang.y + 0.24, lineArrayHang.z + 1.04]
    )
  }
  ctx.strokeStyle = '#515c73'
  ctx.lineWidth = 1.45
  ctx.stroke()
  drawLightColumns(ctx, project, eye)
  drawBackline(ctx, project, eye)

  for (const sign of [-1, 1]) {
    for (const x of [sign * 21, sign * 38]) {
      solid(
        ctx,
        project,
        eye,
        [
          [x - 1.3, stageDeckHeight, 7],
          [x + 1.3, stageDeckHeight + 0.8, 8.9]
        ],
        '#383d50',
        '#121824',
        '#232839'
      )
    }
    drawKeyboard(ctx, project, eye, sign * 14)
  }
  drawDrumKit(ctx, project, eye)
  drawMicrophones(ctx, project)
  drawStageSpeakers(ctx, project, eye)
}

function disc(
  center: WorldPoint,
  radius: number,
  direction: 'front' | 'up',
  start = 0,
  sweep = Math.PI * 2
): WorldPoint[] {
  return Array.from({ length: 21 }, (_, index) => {
    const angle = start + (index / 20) * sweep
    const x = center[0] + Math.cos(angle) * radius
    const offset = Math.sin(angle) * radius
    return direction === 'front'
      ? [x, center[1] + offset, center[2]]
      : [x, center[1], center[2] + offset]
  })
}

function drawDrumKit(ctx: Context, project: Project, eye: WorldPoint): void {
  const base = stageDeckHeight + 0.68
  solid(
    ctx,
    project,
    eye,
    [
      [-4.7, stageDeckHeight, 15.8],
      [4.7, base, 22.1]
    ],
    '#3d4558',
    '#252b3b',
    '#242b3d'
  )
  const cymbals = [
    { x: -2.45, z: 17.55, y: base + 1.95, size: 0.44, hiHat: true },
    { x: -2.8, z: 20, y: base + 2.81, size: 0.72 },
    { x: 2.85, z: 20.5, y: base + 2.49, size: 0.79 },
    { x: 3.1, z: 17.65, y: base + 2.72, size: 0.63 }
  ]
  ctx.beginPath()
  for (const { x, y, z } of cymbals) {
    segment(ctx, project, [x, base, z], [x, y + 0.12, z])
    segment(ctx, project, [x, base + 0.61, z], [x - 0.48, base, z - 0.23])
    segment(ctx, project, [x, base + 0.61, z], [x + 0.48, base, z - 0.21])
    segment(ctx, project, [x, base + 0.61, z], [x, base, z + 0.42])
  }
  segment(ctx, project, [0, base, 20.87], [0, base + 1.12, 20.87])
  ctx.strokeStyle = '#828c9c'
  ctx.lineWidth = 0.94
  ctx.stroke()
  plane(ctx, project, disc([0, base + 1.12, 20.87], 0.45, 'up'), '#161b27', '#667185')

  const kick: WorldPoint = [0, base + 0.98, 16.62]
  const cameraAngle = Math.atan2(eye[1] - kick[1], eye[0])
  const frontRim = disc(kick, 0.94, 'front', cameraAngle - Math.PI / 2, Math.PI)
  const rearRim = frontRim.map(([x, y]): WorldPoint => [x, y, 17.89]).reverse()
  plane(ctx, project, [...frontRim, ...rearRim], '#394760', '#68778e')
  plane(ctx, project, disc(kick, 0.96, 'front'), '#141c28', '#949eab')
  plane(ctx, project, disc([0.34, kick[1] - 0.34, 16.59], 0.18, 'front'), '#0c101a')

  const drums = [
    { x: -1.55, z: 17.25, y: base + 1.18, size: 0.55, shell: 0.32 },
    { x: -0.7, z: 18.3, y: base + 2.13, size: 0.52, shell: 0.57 },
    { x: 0.64, z: 18.45, y: base + 2.02, size: 0.58, shell: 0.66 },
    { x: 1.92, z: 17.55, y: base + 1.26, size: 0.69, shell: 0.88 }
  ]
  ctx.beginPath()
  for (const { x, z, y, shell } of drums) {
    if (Math.abs(x) < 1) {
      segment(ctx, project, [0, base + 1.46, 18.2], [x, y - shell, z])
      continue
    }
    segment(ctx, project, [x, base + 0.24, z], [x, y - shell, z])
    segment(ctx, project, [x, base + 0.24, z], [x - 0.52, base, z + 0.23])
    segment(ctx, project, [x, base + 0.24, z], [x + 0.49, base, z - 0.21])
  }
  ctx.strokeStyle = '#758193'
  ctx.lineWidth = 1
  ctx.stroke()
  drums.sort((a, b) => project.depth([b.x, b.y, b.z]) - project.depth([a.x, a.y, a.z]))
  for (const { x, z, y, size, shell } of drums) {
    const facing = Math.atan2(eye[2] - z, eye[0] - x)
    const upper = disc([x, y, z], size, 'up', facing - Math.PI / 2, Math.PI)
    const lower = upper.map(([px, py, pz]): WorldPoint => [px, py - shell, pz]).reverse()
    plane(ctx, project, [...upper, ...lower], '#3b526d', '#66758d')
    plane(ctx, project, disc([x, y, z], size, 'up'), '#adb9c9', '#e2c9b8')
  }
  for (const { x, y, z, size, hiHat } of cymbals) {
    if (hiHat) plane(ctx, project, disc([x, y - 0.14, z], size, 'up'), '#a58a58', '#a98f63')
    plane(ctx, project, disc([x, y, z], size, 'up'), '#ceb782', '#e6ca95')
    plane(ctx, project, disc([x, y + 0.055, z], size * 0.27, 'up'), '#efcf8b')
  }
}
