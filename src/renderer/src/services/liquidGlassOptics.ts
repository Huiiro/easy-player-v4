import type { PluginThemeGlass } from '../../../../packages/plugin-sdk/src'

export type GlassOptics = Required<Omit<PluginThemeGlass, 'selectors'>>
export function glassHalfVector(angle: number): [number, number, number] {
  const azimuth = (angle * Math.PI) / 180
  const elevation = (50 * Math.PI) / 180
  const x = Math.cos(azimuth) * Math.cos(elevation)
  const y = Math.sin(azimuth) * Math.cos(elevation)
  const z = Math.sin(elevation) + 1
  const length = Math.hypot(x, y, z)
  return [x / length, y / length, z / length]
}
export interface GlassGeometry {
  width: number
  height: number
  /** Top left, top right, bottom right, bottom left, in CSS pixels. */
  radii: [number, number, number, number]
}
export interface GlassMapOptions {
  chromaticTransmission?: boolean
  model?: 'studio'
  blurEdge?: boolean
  reflection?: boolean
}
export function resolveGlassOptics(glass: PluginThemeGlass): GlassOptics {
  return {
    thickness: 8,
    ior: 1.5,
    dispersion: 0.18,
    fresnel: 0.4,
    highlight: 0.65,
    lightAngle: 225,
    shadow: 0.2,
    interactive: false,
    ...glass
  }
}

/** Rounded-box SDF normals, Snell transmission and Schlick Fresnel.
 * Edge incidence and RGB offsets adapted from Charles Yin's MIT-licensed
 * liquid-glass-studio; attribution in docs/themes/liquid-glass/licenses/.
 */
export function sampleGlassOptics(
  x: number,
  y: number,
  geometry: GlassGeometry,
  optics: GlassOptics,
  options: GlassMapOptions = {}
): {
  nx: number
  ny: number
  depth: number
  displacement: number
  fresnel: number
  height: number
  interior: number
} {
  const px = x - geometry.width / 2
  const py = y - geometry.height / 2
  const corner = py < 0 ? (px < 0 ? 0 : 1) : px < 0 ? 3 : 2
  const radius = Math.min(geometry.radii[corner], geometry.width / 2, geometry.height / 2)
  const qx = Math.abs(px) - (geometry.width / 2 - radius)
  const qy = Math.abs(py) - (geometry.height / 2 - radius)
  const ox = Math.max(qx, 0)
  const oy = Math.max(qy, 0)
  const len = Math.hypot(ox, oy)
  const depth = -(len + Math.min(Math.max(qx, qy), 0) - radius)
  const nx = Math.sign(px) * (len > 0 ? ox / len : Number(qx >= qy))
  const ny = Math.sign(py) * (len > 0 ? oy / len : Number(qy > qx))
  // Leave a genuinely flat centre even in shallow chrome such as a 48px header.
  const thickness =
    options.model === 'studio'
      ? optics.thickness
      : Math.min(optics.thickness, Math.min(geometry.width, geometry.height) * 0.2)
  const t = Math.max(0, Math.min(1, depth / thickness))
  // Quarter-circle meniscus: height and normal describe the same curved surface.
  const sinI = options.model === 'studio' ? (1 - t) ** 2 : 1 - t
  const cosI = Math.sqrt(Math.max(0, 1 - sinI * sinI))
  const thetaI = Math.asin(sinI)
  const thetaT = Math.asin(sinI / optics.ior)
  // Ray travel is proportional to the local glass height. At the outer rim the
  // glass has zero height: offset must return to zero instead of jumping abruptly.
  const displacement =
    depth < 0
      ? 0
      : options.model === 'studio'
        ? Math.tan(thetaI - thetaT)
        : Math.min(1, (cosI * Math.tan(thetaI - thetaT)) / 0.25)
  const r0 = ((optics.ior - 1) / (optics.ior + 1)) ** 2
  const fresnel =
    depth < 0 || optics.ior === 1 ? 0 : (r0 + (1 - r0) * (1 - cosI) ** 5) * optics.fresnel
  const height = depth < 0 ? 0 : Math.sqrt(Math.max(0, 1 - sinI * sinI))
  const interior = t * t * (3 - 2 * t)
  return { nx, ny, depth, displacement, fresnel, height, interior }
}
export interface GlassMaps {
  width: number
  height: number
  displacement: Uint8ClampedArray
  reflection: Uint8ClampedArray
  surfaceNormals?: Uint8ClampedArray
  interior?: Uint8ClampedArray
}

/** Geometry only. Actual backdrop pixels stay in Chromium's compositor. */
export function buildGlassMaps(
  geometry: GlassGeometry,
  optics: GlassOptics,
  dpr: number,
  budget: number,
  options: GlassMapOptions = {}
): GlassMaps {
  const scale = Math.min(
    Math.max(1, dpr),
    2,
    2048 / geometry.width,
    2048 / geometry.height,
    Math.sqrt(Math.min(262144, budget) / (geometry.width * geometry.height))
  )
  const width = Math.max(1, Math.floor(geometry.width * scale))
  const height = Math.max(1, Math.floor(geometry.height * scale))
  const bytes = width * height * 4
  const maps: GlassMaps = {
    width,
    height,
    displacement: new Uint8ClampedArray(bytes),
    reflection: new Uint8ClampedArray(bytes),
    surfaceNormals: optics.interactive ? new Uint8ClampedArray(bytes) : undefined,
    interior:
      optics.interactive || (optics.blur > 1 && !options.blurEdge)
        ? new Uint8ClampedArray(bytes)
        : undefined
  }
  const [hx, hy, hz] = glassHalfVector(optics.lightAngle)
  const fillPixel = (bytes: Uint8ClampedArray, pixel: number[]): void => {
    const packed = new Uint32Array(new Uint8Array(pixel).buffer)[0]
    new Uint32Array(bytes.buffer).fill(packed)
  }
  const r0 = ((optics.ior - 1) / (optics.ior + 1)) ** 2
  fillPixel(maps.displacement, [128, 128, 128, 255])
  fillPixel(maps.reflection, [255, 255, 255, Math.round(r0 * optics.fresnel * 255)])
  if (maps.surfaceNormals) fillPixel(maps.surfaceNormals, [128, 128, 255, 255])
  if (maps.interior) maps.interior.fill(255)
  const margin = Math.max(
    ...geometry.radii,
    options.model === 'studio'
      ? optics.thickness
      : Math.min(optics.thickness, Math.min(geometry.width, geometry.height) * 0.2)
  )
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cssX = ((x + 0.5) * geometry.width) / width
      const cssY = ((y + 0.5) * geometry.height) / height
      if (
        cssY > margin &&
        cssY < geometry.height - margin &&
        cssX > margin &&
        cssX < geometry.width - margin
      ) {
        x = Math.max(x, Math.floor(((geometry.width - margin) * width) / geometry.width) - 1)
        continue
      }
      const p = sampleGlassOptics(
        ((x + 0.5) * geometry.width) / width,
        ((y + 0.5) * geometry.height) / height,
        geometry,
        optics,
        options
      )
      const i = (y * width + x) * 4
      // SVG corrects the 128/255 neutral-map quantization bias after displacement.
      // Store the full vector range. Pixel-space SVG primitives keep displacement
      // precision independent of aspect ratio (especially very wide headers).
      maps.displacement[i] = Math.round(127.5 - p.nx * p.displacement * 127.5)
      maps.displacement[i + 1] = Math.round(127.5 - p.ny * p.displacement * 127.5)
      maps.displacement[i + 2] = 128
      maps.displacement[i + 3] = 255
      // The built-in renderer supplies reflection in WebGL. Do not calculate
      // and encode another unused full-size reflection texture on the CPU.
      if (options.reflection === false && !maps.interior && !maps.surfaceNormals) continue
      const sinI = Math.sqrt(Math.max(0, 1 - p.height * p.height))
      const specular =
        optics.interactive || p.depth < 0
          ? 0
          : Math.min(
              1,
              optics.highlight *
                Math.max(0, p.nx * sinI * hx + p.ny * sinI * hy + p.height * hz) ** 96 *
                (1 - p.interior)
            )
      const white = 1 - (1 - p.fresnel) * (1 - specular)
      // Narrow prismatic edge light supplements real RGB background separation.
      // It is a baked visual approximation, not another full-surface GPU pass.
      let prism = p.depth < 0 ? 0 : optics.dispersion * 0.55 * Math.exp(-p.depth / 1.4)
      if (prism < 1 / 510) prism = 0
      const alpha = 1 - (1 - white) * (1 - prism)
      const phase =
        prism > 0
          ? p.depth * 2.4 + Math.atan2(p.ny, p.nx) * 1.5 + (optics.lightAngle * Math.PI) / 180
          : 0
      for (let channel = 0; channel < 3; channel++) {
        const colour = prism > 0 ? 0.5 + 0.5 * Math.cos(phase + (channel * 2 * Math.PI) / 3) : 1
        maps.reflection[i + channel] =
          alpha > 0 ? Math.round((255 * (white * (1 - prism) + colour * prism)) / alpha) : 255
      }
      maps.reflection[i + 3] = Math.round(alpha * 255)
      if (maps.surfaceNormals) {
        maps.surfaceNormals[i] = Math.round(127.5 + p.nx * sinI * 127.5)
        maps.surfaceNormals[i + 1] = Math.round(127.5 + p.ny * sinI * 127.5)
        maps.surfaceNormals[i + 2] = Math.round(127.5 + p.height * 127.5)
        maps.surfaceNormals[i + 3] = 255
      }
      if (maps.interior) {
        maps.interior[i] = maps.interior[i + 1] = maps.interior[i + 2] = 255
        maps.interior[i + 3] = Math.round(p.interior * 255)
      }
    }
  }
  return maps
}
