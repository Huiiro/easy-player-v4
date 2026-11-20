import { projectFace, type Project, type ScreenPoint, type WorldPoint } from './stageCamera'

type Context = CanvasRenderingContext2D

export function glow(
  ctx: Context,
  x: number,
  y: number,
  rx: number,
  ry: number,
  color: string,
  opacity: number
): void {
  ctx.save()
  ctx.translate(x, y)
  ctx.scale(rx, ry)
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1)
  gradient.addColorStop(0, `rgb(${color} / ${opacity})`)
  gradient.addColorStop(0.45, `rgb(${color} / ${opacity * 0.37})`)
  gradient.addColorStop(1, `rgb(${color} / 0)`)
  ctx.fillStyle = gradient
  ctx.fillRect(-1, -1, 2, 2)
  ctx.restore()
}

function interpolate(a: WorldPoint, b: WorldPoint, t: number): WorldPoint {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

function drawWallTriangle(
  ctx: Context,
  texture: HTMLCanvasElement,
  [sx, sy, sw, sh]: readonly [number, number, number, number],
  origin: ScreenPoint,
  horizontal: ScreenPoint,
  vertical: ScreenPoint,
  reverse = false
): void {
  ctx.save()
  ctx.transform(
    horizontal.x - origin.x,
    horizontal.y - origin.y,
    vertical.x - origin.x,
    vertical.y - origin.y,
    origin.x,
    origin.y
  )
  // Overlap the shared edge slightly so antialiasing cannot expose the backing.
  ctx.beginPath()
  ctx.moveTo(-0.035, -0.035)
  ctx.lineTo(1.055, -0.035)
  ctx.lineTo(-0.035, 1.055)
  ctx.closePath()
  ctx.clip()
  if (reverse) ctx.transform(-1, 0, 0, -1, 1, 1)
  ctx.drawImage(texture, sx, sy, sw, sh, -0.012, -0.012, 1.024, 1.024)
  ctx.restore()
}

export function drawVideoWall(
  ctx: Context,
  project: Project,
  corners: readonly WorldPoint[],
  texture: HTMLCanvasElement
): void {
  const [topLeft, topRight, bottomRight, bottomLeft] = corners
  const columns = 4
  const rows = 3
  const sw = texture.width / columns
  const sh = texture.height / rows
  const boundary = projectFace(corners, project)
  if (boundary.length < 3) return
  ctx.save()
  ctx.beginPath()
  ctx.moveTo(boundary[0].x, boundary[0].y)
  for (const point of boundary.slice(1)) ctx.lineTo(point.x, point.y)
  ctx.closePath()
  ctx.clip()
  // Two triangles per tile meet at the fourth projected corner as the camera moves.
  for (let column = 0; column < columns; column++) {
    const left = column / columns
    const right = (column + 1) / columns
    const a = interpolate(topLeft, topRight, left)
    const b = interpolate(topLeft, topRight, right)
    const c = interpolate(bottomLeft, bottomRight, left)
    const d = interpolate(bottomLeft, bottomRight, right)
    for (let row = 0; row < rows; row++) {
      const p = project(interpolate(a, c, row / rows))
      const q = project(interpolate(b, d, row / rows))
      const r = project(interpolate(b, d, (row + 1) / rows))
      const s = project(interpolate(a, c, (row + 1) / rows))
      if (!p || !q || !r || !s) continue
      const tile = [column * sw, row * sh, sw, sh] as const
      drawWallTriangle(ctx, texture, tile, p, q, s)
      drawWallTriangle(ctx, texture, tile, r, s, q, true)
    }
  }
  ctx.restore()
}

export function drawWingArtwork(ctx: Context, artwork?: HTMLImageElement): void {
  const { width, height } = ctx.canvas
  ctx.fillStyle = '#090e12'
  ctx.fillRect(0, 0, width, height)
  if (!artwork) return
  const scale = 0.92 * Math.min(width / artwork.naturalWidth, height / artwork.naturalHeight)
  const w = artwork.naturalWidth * scale
  const h = artwork.naturalHeight * scale
  ctx.drawImage(artwork, (width - w) / 2, (height - h) / 2, w, h)
}
