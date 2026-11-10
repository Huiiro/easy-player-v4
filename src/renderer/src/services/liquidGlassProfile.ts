/** Gaussian kernel from liquid-glass-studio/src/utils/index.ts (MIT, Charles Yin).
 * Explicit array typing keeps the upstream calculation compatible with strict TS.
 */
function computeGaussianKernelByRadius(radius: number): number[] {
  const sigma = radius / 3
  const kernel: number[] = []
  let sum = 0
  for (let i = 0; i <= radius; i++) {
    const weight = Math.exp((-0.5 * (i * i)) / (sigma * sigma))
    kernel.push(weight)
    sum += i === 0 ? weight : weight * 2
  }
  return kernel.map((weight) => weight / sum)
}

/** Current optical preset, initialized from upstream Controls.tsx.
 * Geometry follows each real UI panel instead of the demo's two floating shapes.
 */
export const STUDIO_PRESET = Object.freeze({
  refThickness: 24,
  refDistance: 0.08,
  refFactor: 1.6,
  refDispersion: 4,
  refFresnelRange: 30,
  refFresnelHardness: 10,
  refFresnelFactor: 0,
  glareRange: 28,
  glareHardness: 10,
  glareFactor: 20,
  glareConvergence: 60,
  glareOppositeFactor: 80,
  glareAngle: -45,
  blurRadius: 30,
  blurEdge: true,
  tint: Object.freeze({ r: 255, g: 255, b: 255, a: 0 }),
  shadowExpand: 20,
  shadowFactor: 15,
  shadowPosition: Object.freeze({ x: 0, y: -10 })
})

/** Same sampling radius and normalized kernel as the upstream online demo. */
export const STUDIO_BLUR_RADIUS = STUDIO_PRESET.blurRadius
export const STUDIO_BLUR_WEIGHTS = computeGaussianKernelByRadius(STUDIO_BLUR_RADIUS)

/** Reconstruct the same linearly sampled kernel on the actual framebuffer grid,
 * then combine adjacent texels into weighted bilinear reads. This also preserves
 * physical-pixel blur spacing when the framebuffer DPR is capped.
 */
export function studioBlurSamples(
  scale: number,
  radius: number = STUDIO_BLUR_RADIUS
): { weights: number[]; offsets: number[] } {
  radius = Number.isFinite(radius)
    ? Math.max(0, Math.min(200, Math.round(radius)))
    : STUDIO_BLUR_RADIUS
  if (radius === 0) return { weights: [1], offsets: [0] }
  const kernel =
    radius === STUDIO_BLUR_RADIUS ? STUDIO_BLUR_WEIGHTS : computeGaussianKernelByRadius(radius)
  const grid = Array<number>(Math.ceil(radius * scale) + 1).fill(0)
  grid[0] = kernel[0]
  for (let i = 1; i <= radius; i++) {
    const offset = i * scale
    const lower = Math.floor(offset)
    const fraction = offset - lower
    const weight = kernel[i]
    grid[lower] += weight * (1 - fraction) * (lower === 0 ? 2 : 1)
    if (fraction > 0) grid[lower + 1] += weight * fraction
  }
  const weights = [grid[0]],
    offsets = [0]
  for (let i = 1; i < grid.length; i += 2) {
    const next = grid[i + 1] ?? 0
    const weight = grid[i] + next
    weights.push(weight)
    offsets.push(i + (weight > 0 ? next / weight : 0))
  }
  return { weights, offsets }
}

/** Upstream radius is in render pixels; SVG stdDeviation is in CSS pixels. */
export function studioBlurSigma(radius: number, dpr: number): number {
  return Math.max(0, radius) / (3 * (Number.isFinite(dpr) && dpr > 0 ? dpr : 1))
}
