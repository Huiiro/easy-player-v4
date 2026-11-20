import { projectFace, type Project, type ScreenPoint, type WorldPoint } from './stageCamera'
import { stagePlatforms, visibleBoxFaces } from './stageScenery'

export type SpriteBounds = readonly [x: number, y: number, width: number, height: number]
export type StageCutouts = readonly ScreenPoint[][]
export type SpriteOcclusion = (rect: SpriteBounds, depth: number) => StageCutouts | null

const open: StageCutouts = []
const edgeOverlap = 0.48

interface ScreenEdge {
  x: number
  y: number
  nx: number
  ny: number
  mx: number
  my: number
}

function boundsOf(points: readonly ScreenPoint[]): SpriteBounds {
  let { x: left, y: top } = points[0]
  let right = left
  let bottom = top
  for (const { x, y } of points) {
    left = Math.min(left, x)
    top = Math.min(top, y)
    right = Math.max(right, x)
    bottom = Math.max(bottom, y)
  }
  return [left, top, right - left, bottom - top]
}

function screenEdges(points: readonly ScreenPoint[]): ScreenEdge[] {
  let area = 0
  let a = points[points.length - 1]
  for (const b of points) {
    area += a.x * b.y - b.x * a.y
    a = b
  }
  if (Math.abs(area) < 0.001) return []
  const orientation = Math.sign(area)
  const edges: ScreenEdge[] = []
  for (const b of points) {
    const dx = b.x - a.x
    const dy = b.y - a.y
    if (dx || dy) {
      edges.push({
        x: a.x,
        y: a.y,
        nx: -dy * orientation,
        ny: dx * orientation,
        mx: Math.abs(dy),
        my: Math.abs(dx)
      })
    }
    a = b
  }
  return edges
}

function relation(
  edges: readonly ScreenEdge[],
  cx: number,
  cy: number,
  halfWidth: number,
  halfHeight: number
): 'outside' | 'covered' | 'overlap' {
  if (!edges.length) return 'outside'
  let covered = true
  for (const edge of edges) {
    const distance = edge.nx * (cx - edge.x) + edge.ny * (cy - edge.y)
    const margin = edge.mx * halfWidth + edge.my * halfHeight
    if (distance < -margin) return 'outside'
    if (distance <= margin) covered = false
  }
  return covered ? 'covered' : 'overlap'
}

function beforeSprite(points: readonly ScreenPoint[], limit: number): ScreenPoint[] {
  const result: ScreenPoint[] = []
  let a = points[points.length - 1]
  for (const b of points) {
    const da = a.depth
    const db = b.depth
    if (da < limit !== db < limit) {
      // Convert the intersection on the world-space edge to its fraction on the projected edge.
      const fraction = ((limit - da) * db) / ((db - da) * limit)
      result.push({
        x: a.x + (b.x - a.x) * fraction,
        y: a.y + (b.y - a.y) * fraction,
        depth: limit
      })
    }
    if (db < limit) result.push(b)
    a = b
  }
  return result
}

export function createFaceOcclusion(
  project: Project,
  surfaces: readonly (readonly WorldPoint[])[],
  viewport?: readonly [width: number, height: number]
): SpriteOcclusion {
  const faces = surfaces.flatMap((corners) => {
    const projected = projectFace(corners, project)
    if (projected.length < 3) return []
    const edges = screenEdges(projected)
    if (!edges.length) return []
    let near = Infinity
    let far = -Infinity
    for (const { depth } of projected) {
      near = Math.min(near, depth)
      far = Math.max(far, depth)
    }
    const [x, y, w, h] = boundsOf(projected)
    return [
      {
        projected,
        edges,
        left: x - edgeOverlap,
        top: y - edgeOverlap,
        right: x + w + edgeOverlap,
        bottom: y + h + edgeOverlap,
        near,
        far
      }
    ]
  })
  // Index the bowl in screen space to keep each sprite's face checks local.
  const cellSize = 32
  const smallSpriteHalf = 5
  // Small sprites can query the cell containing their center, even on a cell boundary.
  const columns = viewport ? Math.ceil(viewport[0] / cellSize) + 2 : 1
  const rows = viewport ? Math.ceil(viewport[1] / cellSize) + 2 : 1
  const cells = viewport ? new Array<typeof faces | undefined>(columns * rows) : undefined
  const emptyCell: typeof faces = []
  const cellIndex = (pixel: number, count: number): number =>
    Math.max(0, Math.min(count - 1, 1 + Math.floor(pixel / cellSize)))
  const nearby = new Set<(typeof faces)[number]>()
  if (cells) {
    for (const face of faces) {
      const left = cellIndex(face.left - smallSpriteHalf, columns)
      const right = cellIndex(face.right + smallSpriteHalf, columns)
      const bottom = cellIndex(face.bottom + smallSpriteHalf, rows)
      for (let row = cellIndex(face.top - smallSpriteHalf, rows); row <= bottom; row++) {
        for (let column = left; column <= right; column++)
          (cells[row * columns + column] ??= []).push(face)
      }
    }
  }
  return ([x, y, w, h], depth) => {
    const halfWidth = w / 2
    const halfHeight = h / 2
    const cx = x + halfWidth
    const cy = y + halfHeight
    const rightEdge = x + w
    const bottomEdge = y + h
    let cutouts: ScreenPoint[][] | undefined
    let candidates: Iterable<(typeof faces)[number]> = faces
    if (cells) {
      if (halfWidth <= smallSpriteHalf && halfHeight <= smallSpriteHalf) {
        candidates = cells[cellIndex(cy, rows) * columns + cellIndex(cx, columns)] ?? emptyCell
      } else {
        const left = cellIndex(x, columns)
        const right = cellIndex(rightEdge, columns)
        const top = cellIndex(y, rows)
        const bottom = cellIndex(bottomEdge, rows)
        candidates = cells[top * columns + left] ?? emptyCell
        if (left !== right || top !== bottom) {
          nearby.clear()
          for (let row = top; row <= bottom; row++) {
            for (let column = left; column <= right; column++) {
              const cell = cells[row * columns + column]
              if (cell) for (const face of cell) nearby.add(face)
            }
          }
          candidates = nearby
        }
      }
    }
    for (const face of candidates) {
      if (
        depth <= face.near ||
        rightEdge <= face.left ||
        x >= face.right ||
        bottomEdge <= face.top ||
        y >= face.bottom
      )
        continue
      let intersection = relation(face.edges, cx, cy, halfWidth, halfHeight)
      if (intersection === 'outside') continue
      // A sprite is a camera-facing plane. Only the part of an opaque
      // surface in front of that plane can hide its pixels.
      let polygon = face.projected
      if (depth < face.far) {
        polygon = beforeSprite(face.projected, depth)
        if (polygon.length < 3) continue
        intersection = relation(screenEdges(polygon), cx, cy, halfWidth, halfHeight)
      }
      if (intersection === 'outside') continue
      if (intersection === 'covered') return null
      cutouts ??= []
      cutouts.push(polygon)
    }
    return cutouts ?? open
  }
}

export function createStageOcclusion(
  project: Project,
  eye: WorldPoint,
  viewport?: readonly [width: number, height: number]
): SpriteOcclusion {
  const surfaces = stagePlatforms.flatMap((box) =>
    visibleBoxFaces(box, eye).map(({ corners }) => corners)
  )
  return createFaceOcclusion(project, surfaces, viewport)
}

export function combineSpriteOcclusion(
  first: SpriteOcclusion,
  second: SpriteOcclusion
): SpriteOcclusion {
  return (rect, depth) => {
    const a = first(rect, depth)
    if (a === null) return null
    const b = second(rect, depth)
    if (b === null || !a.length) return b
    return b.length ? [...a, ...b] : a
  }
}

export function beginStageClip(
  ctx: CanvasRenderingContext2D,
  rect: SpriteBounds,
  cutouts?: StageCutouts
): boolean {
  if (!cutouts?.length) return false
  ctx.save()
  for (const polygon of cutouts) {
    const [x, y, w, h] = boundsOf(polygon)
    const centerX = x + w / 2
    const centerY = y + h / 2
    const spreadX = 1 + edgeOverlap / Math.max(1, w / 2)
    const spreadY = 1 + edgeOverlap / Math.max(1, h / 2)
    // Give the adjacent top and side faces a subpixel overlap at their seam.
    const clip = new Path2D()
    clip.rect(...rect)
    polygon.forEach((point, index) => {
      const px = centerX + (point.x - centerX) * spreadX
      const py = centerY + (point.y - centerY) * spreadY
      if (index === 0) clip.moveTo(px, py)
      else clip.lineTo(px, py)
    })
    clip.closePath()
    ctx.clip(clip, 'evenodd')
  }
  return true
}
