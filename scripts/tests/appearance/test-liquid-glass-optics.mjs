/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone JavaScript numerical assertions. */
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

mkdirSync('build', { recursive: true })
const directory = mkdtempSync(path.resolve('build/glass-optics-'))
const filename = path.join(directory, 'optics.cjs')
await build({
  entryPoints: ['src/renderer/src/services/liquidGlassOptics.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: filename
})
const { resolveGlassOptics, sampleGlassOptics, buildGlassMaps } = createRequire(import.meta.url)(
  filename
)
const profileFile = path.join(directory, 'profile.cjs')
await build({
  entryPoints: ['src/renderer/src/services/liquidGlassProfile.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: profileFile
})
const { studioBlurSamples, STUDIO_BLUR_WEIGHTS, STUDIO_BLUR_RADIUS } = createRequire(
  import.meta.url
)(profileFile)
const signal = Array.from({ length: 128 }, (_, i) => Math.sin(i * 7.1) * 0.5 + 0.5)
const linear = (x) => {
  const i = Math.floor(x),
    f = x - i
  const read = (n) => signal[Math.max(0, Math.min(signal.length - 1, n))]
  return read(i) * (1 - f) + read(i + 1) * f
}
for (const radius of [0, 1, 24, STUDIO_BLUR_RADIUS, 200]) {
  const raw =
    radius === 0
      ? [1]
      : Array.from({ length: radius + 1 }, (_, i) => Math.exp(-0.5 * (i / (radius / 3)) ** 2))
  const mass = raw[0] + 2 * raw.slice(1).reduce((a, b) => a + b, 0)
  const kernel = radius === STUDIO_BLUR_RADIUS ? STUDIO_BLUR_WEIGHTS : raw.map((w) => w / mass)
  for (const scale of [0.25, 0.625, 0.873, 1, 1.00001]) {
    const samples = studioBlurSamples(scale, radius)
    assert(
      Math.abs(samples.weights[0] + 2 * samples.weights.slice(1).reduce((a, b) => a + b, 0) - 1) <
        1e-12
    )
    for (const centre of [0, 1, 17, 64, 126, 127]) {
      let expected = linear(centre) * kernel[0]
      for (let i = 1; i <= radius; i++)
        expected += (linear(centre + i * scale) + linear(centre - i * scale)) * kernel[i]
      let actual = linear(centre) * samples.weights[0]
      for (let i = 1; i < samples.weights.length; i++)
        actual +=
          (linear(centre + samples.offsets[i]) + linear(centre - samples.offsets[i])) *
          samples.weights[i]
      assert(
        Math.abs(actual - expected) < 1e-12,
        'Bilinear pairing preserves original Gaussian, DPR spacing and clamped boundaries'
      )
    }
  }
}
const optics = resolveGlassOptics({
  selectors: ['.ep-footer'],
  blur: 8,
  refraction: 34,
  saturation: 1.2
})
const geometry = { width: 400, height: 200, radii: [24, 24, 24, 24] }
const sample = (x, y, settings = optics) => sampleGlassOptics(x, y, geometry, settings)
const centre = sample(200, 100)
assert.equal(centre.displacement, 0)
assert.equal(centre.height, 1)
assert.equal(centre.interior, 1)
assert(Math.abs(centre.fresnel - 0.04 * optics.fresnel) < 1e-10)
assert(sample(1, 100).fresnel > sample(8, 100).fresnel)
assert(sample(1, 100).displacement > sample(8, 100).displacement)
assert.equal(sample(1, 100).nx, -sample(399, 100).nx)
assert.equal(sample(200, 1).ny, -sample(200, 199).ny)
assert.equal(sample(0, 0).fresnel, 0, 'Outside rounded corners must not reflect')
assert.equal(sample(1, 100, { ...optics, ior: 1 }).displacement, 0)
assert.equal(sample(1, 100, { ...optics, ior: 1 }).fresnel, 0)
assert.equal(
  sample(0, 100).displacement,
  0,
  'The zero-height outer rim cannot have a discontinuous sampling jump'
)
assert(
  sample(1e-8, 100).displacement < 0.001,
  'Refraction must converge continuously at the outer rim'
)
assert.equal(optics.interactive, false, 'Lighting is fixed unless explicitly enabled')
// Built-in mode follows the Studio incidence curve; the imported theme retains
// its original meniscus. Compare an actual ray against Snell's law, including
// shallow panels where the old 20%-of-height clamp changed the preset thickness.
const studioOptics = { ...optics, thickness: 20, ior: 1.4 }
const studioGeometry = { width: 400, height: 48, radii: [12, 12, 12, 12] }
for (const depth of [0.5, 2, 10, 15, 20, 24]) {
  const ray = sampleGlassOptics(200, depth, studioGeometry, studioOptics, { model: 'studio' })
  const sinI = Math.max(0, 1 - depth / 20) ** 2
  const expected = Math.tan(Math.asin(sinI) - Math.asin(sinI / 1.4))
  assert(Math.abs(ray.displacement - expected) < 1e-10, 'Studio Snell profile matches the demo')
}
assert.equal(
  buildGlassMaps(geometry, studioOptics, 1, 262144, { model: 'studio', blurEdge: true }).interior,
  undefined
)
assert.equal(sample(1, 100, { ...optics, fresnel: 0 }).fresnel, 0)
assert(
  sample(5, 100, { ...optics, ior: 1.8 }).displacement >
    sample(5, 100, { ...optics, ior: 1.3 }).displacement
)
for (const ior of [1, 1.01, 1.5, 2.5])
  for (let x = 0; x <= 200; x++) {
    for (const n of Object.values(sample(x, 100, { ...optics, ior }))) assert(Number.isFinite(n))
  }
const wide = { width: 2000, height: 80, radii: [20, 20, 20, 20] }
assert.equal(
  sampleGlassOptics(1000, 20, wide, optics).displacement,
  0,
  'A shallow header retains a flat optical centre'
)
const wideMaps = buildGlassMaps(wide, optics, 1, 262144)
const edgeIndex = (40 * wideMaps.width + 1) * 4
const expected = sampleGlassOptics(1.5, 40.5, wide, optics)
const decoded = (wideMaps.displacement[edgeIndex] / 255 - 0.5 - 1 / 510) * 14
assert(
  Math.abs(decoded - (-expected.nx * expected.displacement * 14) / 2) < 0.03,
  'Wide header displacement must retain subpixel precision'
)
for (const dpr of [1, 2, 3]) {
  const maps = buildGlassMaps(wide, optics, dpr, 32768)
  assert(maps.width <= 2048 && maps.height <= 2048)
  assert(maps.width * maps.height <= 32768)
  const i = (Math.floor(maps.height / 2) * maps.width + Math.floor(maps.width / 2)) * 4
  assert.equal(maps.displacement[i], 128)
  assert.equal(maps.displacement[i + 1], 128)
  assert.equal(maps.interior[i + 3], 255)
}
const coloured = buildGlassMaps(
  { width: 128, height: 96, radii: [16, 16, 16, 16] },
  { ...optics, blur: 0.5, dispersion: 1, fresnel: 0, highlight: 0 },
  1,
  262144
)
const rim = 48 * 128 * 4
assert(
  Math.max(...coloured.reflection.slice(rim, rim + 3)) -
    Math.min(...coloured.reflection.slice(rim, rim + 3)) >
    30,
  'The rim must carry chromatic light even on a uniform backdrop'
)
const flat = (48 * 128 + 64) * 4
assert.equal(
  coloured.reflection[flat + 3],
  0,
  'Chromatic enhancement must not tint the flat centre'
)
assert.equal(
  coloured.surfaceNormals,
  undefined,
  'Fixed lighting must not allocate a live normal texture'
)
assert.equal(coloured.interior, undefined, 'Clear glass must not allocate a heavy blur mask')
console.log(
  'Liquid Glass optics: Snell, Fresnel angle dependence, normals, IOR, neutral centre, DPR and map budgets passed'
)
