/* eslint @typescript-eslint/explicit-function-return-type: off -- Native Node.js test script. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { performance } from 'node:perf_hooks'
import ts from 'typescript'

// Run with node scripts/check-black-hole.mjs; no extra test runtime required.
const source = await readFile(
  new URL(
    '../src/renderer/src/components/background/themes/blackHoleGeodesics.ts',
    import.meta.url
  ),
  'utf8'
)
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 }
}).outputText
const orbit = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
)
const start = performance.now()
const tables = orbit.createOrbitTables()
console.log(
  `Orbit table: ${(performance.now() - start).toFixed(1)} ms, ${(tables.paths.byteLength / 1024 / 1024).toFixed(2)} MiB`
)
assert(tables.paths.every(Number.isFinite))
assert(tables.ends.every(Number.isFinite))

// A circular null orbit stays at the photon sphere. Independently check the conserved energy.
let state = [2 / 3, 0]
for (let i = 0; i < 100; i++) state = orbit.advanceOrbit(...state, 0.01)
assert(Math.abs(state[0] - 2 / 3) < 1e-10)
let maxEnergyError = 0
let captured = 0,
  escaped = 0,
  winding = 0
for (let column = 1; column < orbit.ORBIT_WIDTH; column++) {
  const impact = orbit.impactAtColumn(column)
  const end = tables.ends[column * 2]
  const isEscaped = tables.ends[column * 2 + 1] === 1
  if (impact < orbit.CRITICAL_IMPACT) {
    assert(!isEscaped, `captured ray escaped at b=${impact}`)
    captured++
  } else if (end < orbit.MAX_PHI - 0.001) {
    assert(isEscaped, `escaping ray captured at b=${impact}`)
    escaped++
  }
  if (end > Math.PI * 3) winding++
  for (let row = 0; row < orbit.ORBIT_HEIGHT; row++) {
    const phi = (row * orbit.MAX_PHI) / (orbit.ORBIT_HEIGHT - 1)
    if (phi >= end - 0.04) break
    const index = (row * orbit.ORBIT_WIDTH + column) * 2
    const u = tables.paths[index],
      v = tables.paths[index + 1]
    const energy = v * v + u * u - u * u * u
    const error = Math.abs(energy * impact * impact - 1)
    maxEnergyError = Math.max(maxEnergyError, error)
  }
}
assert(maxEnergyError < 0.00002, `energy drift: ${maxEnergyError}`)
assert(winding > 5, 'critical rays must support higher-order images')

// Compare the bilinear LUT with independent fine integration at actual disk crossings.
function columnAt(b) {
  const outer = b >= orbit.CRITICAL_IMPACT
  const extent =
    (outer ? orbit.MAX_IMPACT - orbit.CRITICAL_IMPACT : orbit.CRITICAL_IMPACT) -
    orbit.IMPACT_EPSILON
  const distance = Math.max(0, Math.abs(b - orbit.CRITICAL_IMPACT) - orbit.IMPACT_EPSILON)
  const t = Math.log1p(distance / orbit.IMPACT_CURVE) / Math.log1p(extent / orbit.IMPACT_CURVE)
  const half = orbit.ORBIT_WIDTH / 2
  return outer ? half + t * (half - 1) : (1 - t) * (half - 1)
}
function lookup(b, phi) {
  const x = columnAt(b),
    y = (phi / orbit.MAX_PHI) * (orbit.ORBIT_HEIGHT - 1)
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy
  const at = (dx, dy) => tables.paths[((iy + dy) * orbit.ORBIT_WIDTH + ix + dx) * 2]
  return (
    (at(0, 0) * (1 - fx) + at(1, 0) * fx) * (1 - fy) + (at(0, 1) * (1 - fx) + at(1, 1) * fx) * fy
  )
}
let crossingSamples = 0,
  maxRadiusError = 0
for (const b of [0.8, 1.8, 2.4, 2.58, 2.597, 2.598, 2.599, 2.61, 2.7, 3.1, 4.7, 7.3, 10.2]) {
  let u = 1 / orbit.CAMERA_RADIUS
  let v = Math.sqrt(1 / (b * b) - u * u + u * u * u)
  let phi = 0
  for (let crossing = 0.27; crossing < orbit.MAX_PHI; crossing += Math.PI) {
    while (phi < crossing && u > 0 && u < 1) {
      const h = Math.min(0.0005, crossing - phi)
      ;[u, v] = orbit.advanceOrbit(u, v, h)
      phi += h
    }
    if (u <= 0 || u >= 1) break
    const radius = 1 / u
    if (radius >= 3 && radius <= 11.5) {
      maxRadiusError = Math.max(maxRadiusError, Math.abs(1 / lookup(b, crossing) / radius - 1))
      crossingSamples++
    }
  }
}
assert(crossingSamples >= 5)
assert(maxRadiusError < 0.01, `LUT disk radius error: ${maxRadiusError}`)
console.log({ captured, escaped, winding, maxEnergyError, crossingSamples, maxRadiusError })
console.log('Black hole orbit checks passed.')
