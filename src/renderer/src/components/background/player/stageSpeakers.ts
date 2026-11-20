import { projectFace, type Project, type WorldPoint } from './stageCamera'

type Quad = readonly [WorldPoint, WorldPoint, WorldPoint, WorldPoint]

interface Panel {
  corners: readonly WorldPoint[]
  color: string
  edge?: string
}

interface Face extends Panel {
  center: WorldPoint
  normal: WorldPoint
  details?: Panel[]
}

export const lineArrayHang = { x: 51.35, y: 30.8, z: 11.2 }
const cabinetFaces: Face[] = []

function midpoint(points: readonly WorldPoint[]): WorldPoint {
  const weight = 1 / points.length
  let x = 0
  let y = 0
  let z = 0
  for (const point of points) {
    x += point[0] * weight
    y += point[1] * weight
    z += point[2] * weight
  }
  return [x, y, z]
}

function distanceAlong(from: WorldPoint, to: WorldPoint, direction: WorldPoint): number {
  return (
    (to[0] - from[0]) * direction[0] +
    (to[1] - from[1]) * direction[1] +
    (to[2] - from[2]) * direction[2]
  )
}

function addFace(corners: Quad, interior: WorldPoint, color: string, details?: Panel[]): void {
  const [a, b, c] = corners
  const [ux, uy, uz] = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  const [vx, vy, vz] = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
  const center = midpoint(corners)
  const cross: WorldPoint = [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx]
  const outward = distanceAlong(interior, center, cross) >= 0
  const normal: WorldPoint = outward ? cross : [-cross[0], -cross[1], -cross[2]]
  cabinetFaces.push({ corners, color, center, normal, edge: '#3a4453', details })
}

// The grille and every driver sit on the same face, so their foreshortening
// follows the cabinet and they disappear when the camera sees its back.
function grille(front: Quad, flown: boolean): Panel[] {
  const [left, right, , top] = front
  const point = (u: number, v: number): WorldPoint => [
    left[0] + (right[0] - left[0]) * u,
    left[1] + (top[1] - left[1]) * v,
    left[2] + (top[2] - left[2]) * v
  ]
  const rect = (l: number, b: number, r: number, t: number): Quad => [
    point(l, b),
    point(r, b),
    point(r, t),
    point(l, t)
  ]
  const details: Panel[] = [
    { corners: rect(0.055, 0.12, 0.945, 0.88), color: '#0a0e16', edge: '#303946' }
  ]
  if (flown) {
    for (const v of [0.31, 0.52, 0.73])
      details.push({ corners: rect(0.12, v - 0.055, 0.88, v + 0.055), color: '#283341' })
    return details
  }
  const radiusU = 0.39 / (right[0] - left[0])
  const radiusV = 0.39 / Math.hypot(top[1] - left[1], top[2] - left[2])
  for (const u of [0.29, 0.71]) {
    for (const scale of [1, 0.49]) {
      const ring = Array.from({ length: 18 }, (_, index) => {
        const angle = (index * Math.PI * 2) / 18
        return point(u + Math.cos(angle) * radiusU * scale, 0.5 + Math.sin(angle) * radiusV * scale)
      })
      details.push({ corners: ring, color: scale === 1 ? '#293543' : '#111824', edge: '#465162' })
    }
  }
  return details
}

function addCabinet(
  x: number,
  width: number,
  frontBottom: WorldPoint,
  frontTop: WorldPoint,
  rearBottom: WorldPoint,
  rearTop: WorldPoint,
  flown: boolean,
  topCap = true,
  bottomCap = true
): void {
  const left = (point: WorldPoint): WorldPoint => [x - width / 2, point[1], point[2]]
  const right = (point: WorldPoint): WorldPoint => [x + width / 2, point[1], point[2]]
  const front: Quad = [left(frontBottom), right(frontBottom), right(frontTop), left(frontTop)]
  const back: Quad = [left(rearBottom), right(rearBottom), right(rearTop), left(rearTop)]
  const interior = midpoint([frontBottom, frontTop, rearBottom, rearTop])
  addFace(front, interior, '#1c2532', grille(front, flown))
  addFace(back, interior, '#141d28')
  addFace([front[0], back[0], back[3], front[3]], interior, '#141e2a')
  addFace([back[1], front[1], front[2], back[2]], interior, '#182230')
  if (topCap) addFace([front[3], front[2], back[2], back[3]], interior, '#384354')
  if (bottomCap) addFace([back[0], back[1], front[1], front[0]], interior, '#111823')
}

for (const center of [-45, -30, -15, 15, 30, 45]) {
  for (const offset of [-1.18, 1.18]) {
    const x = center + offset
    addCabinet(x, 2.26, [x, 0.035, 2.08], [x, 1.46, 2.08], [x, 0.035, 4.67], [x, 1.46, 4.67], false)
  }
}

for (const sign of [-1, 1]) {
  const x = sign * lineArrayHang.x
  let y = lineArrayHang.y
  let z = lineArrayHang.z
  for (let index = 0; index < 8; index++) {
    // Adjacent boxes share their hinge line. The lower baffles turn toward
    // the near seats while the upper ones fire out across the arena.
    const topAngle = 0.031 + index * 0.079
    const bottomAngle = topAngle + 0.079
    const pitch = (topAngle + bottomAngle) / 2
    const bottomY = y - Math.cos(pitch) * 1.22
    const bottomZ = z + Math.sin(pitch) * 1.22
    const cabinetDepth = 2.15
    addCabinet(
      x,
      3.72,
      [x, bottomY, bottomZ],
      [x, y, z],
      [
        x,
        bottomY + Math.sin(bottomAngle) * cabinetDepth,
        bottomZ + Math.cos(bottomAngle) * cabinetDepth
      ],
      [x, y + Math.sin(topAngle) * cabinetDepth, z + Math.cos(topAngle) * cabinetDepth],
      true,
      index === 0,
      index === 7
    )
    y = bottomY
    z = bottomZ
  }
}

function paint(ctx: CanvasRenderingContext2D, project: Project, panel: Panel): void {
  const vertices = projectFace(panel.corners, project)
  if (vertices.length < 3) return
  ctx.beginPath()
  ctx.moveTo(vertices[0].x, vertices[0].y)
  for (const point of vertices.slice(1)) ctx.lineTo(point.x, point.y)
  ctx.closePath()
  ctx.fillStyle = panel.color
  ctx.fill()
  if (panel.edge) {
    ctx.lineWidth = 0.76
    ctx.strokeStyle = panel.edge
    ctx.stroke()
  }
}

export function drawStageSpeakers(
  ctx: CanvasRenderingContext2D,
  project: Project,
  eye: WorldPoint
): void {
  const visible = cabinetFaces.filter((face) => distanceAlong(face.center, eye, face.normal) > 0)
  visible.sort((a, b) => project.depth(b.center) - project.depth(a.center))
  for (const face of visible) {
    paint(ctx, project, face)
    if (face.details) for (const detail of face.details) paint(ctx, project, detail)
  }
}
