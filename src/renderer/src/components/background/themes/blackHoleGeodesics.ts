// Schwarzschild null geodesics, in units where the event horizon Rs = 1.
// u = 1/r, u'' = 1.5 u² - u; the photon sphere is at r = 1.5.
// https://doi.org/10.1038/s41598-021-93595-w
export const CAMERA_RADIUS = 18
export const CRITICAL_IMPACT = Math.sqrt(27) / 2
export const MAX_IMPACT = CAMERA_RADIUS / Math.sqrt(1 - 1 / CAMERA_RADIUS)
export const IMPACT_EPSILON = 0.00002
export const IMPACT_CURVE = 0.01
export const ORBIT_WIDTH = 1024
export const ORBIT_HEIGHT = 384
export const MAX_PHI = Math.PI * 4

export interface OrbitTables {
  // RG32F: inverse radius and its angular derivative; row-major in phi.
  paths: Float32Array
  // RG32F: termination angle, and 1 if the ray escaped to infinity.
  ends: Float32Array
}

export function impactAtColumn(column: number): number {
  const half = ORBIT_WIDTH / 2
  const outer = column >= half
  const t = outer ? (column - half) / (half - 1) : 1 - column / (half - 1)
  const extent = (outer ? MAX_IMPACT - CRITICAL_IMPACT : CRITICAL_IMPACT) - IMPACT_EPSILON
  const distance = IMPACT_EPSILON + IMPACT_CURVE * Math.expm1(t * Math.log1p(extent / IMPACT_CURVE))
  return Math.max(0.0001, CRITICAL_IMPACT + (outer ? distance : -distance))
}

export function advanceOrbit(u: number, v: number, h: number): [number, number] {
  const acceleration = (x: number): number => 1.5 * x * x - x
  const a = acceleration(u)
  const b = acceleration(u + v * h * 0.5)
  const c = acceleration(u + (v + a * h * 0.5) * h * 0.5)
  const d = acceleration(u + (v + b * h * 0.5) * h)
  return [
    u + (h / 6) * (v + 2 * (v + a * h * 0.5) + 2 * (v + b * h * 0.5) + v + c * h),
    v + (h / 6) * (a + 2 * b + 2 * c + d)
  ]
}

export function createOrbitTables(): OrbitTables {
  const paths = new Float32Array(ORBIT_WIDTH * ORBIT_HEIGHT * 2)
  const ends = new Float32Array(ORBIT_WIDTH * 2)
  const delta = MAX_PHI / (ORBIT_HEIGHT - 1)
  for (let column = 0; column < ORBIT_WIDTH; column++) {
    const impact = impactAtColumn(column)
    let u = 1 / CAMERA_RADIUS
    let v = Math.sqrt(Math.max(0, 1 / (impact * impact) - u * u + u * u * u))
    let phi = 0
    let ended = false
    ends[column * 2] = MAX_PHI
    for (let row = 0; row < ORBIT_HEIGHT; row++) {
      const target = row * delta
      while (!ended && phi < target - 1e-10) {
        // RK4 substeps also resolve nearly radial rays without stepping through the horizon.
        const h = Math.min(target - phi, 0.012, 0.025 / Math.max(Math.abs(v), 0.01))
        const [nextU, nextV] = advanceOrbit(u, v, h)
        if (nextU >= 1 || nextU <= 0) {
          const boundary = nextU >= 1 ? 1 : 0
          ends[column * 2] = phi + (h * (boundary - u)) / (nextU - u)
          ends[column * 2 + 1] = boundary === 0 ? 1 : 0
          ended = true
        }
        u = nextU
        v = nextV
        phi += h
      }
      const index = (row * ORBIT_WIDTH + column) * 2
      // Keep the extrapolated endpoint for accurate interpolation of the last segment.
      paths[index] = u
      paths[index + 1] = v
    }
  }
  return { paths, ends }
}
