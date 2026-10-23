export interface Rgba {
  r: number
  g: number
  b: number
  a: number
}
export interface Hsva {
  h: number
  s: number
  v: number
  a: number
}

function linearToSrgb(value: number): number {
  const clamped = Math.max(0, Math.min(1, value))
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055
}

function parseOklch(lightness: number, chroma: number, hue: number, alpha: number): Rgba {
  const hueRadians = (hue * Math.PI) / 180
  const a = chroma * Math.cos(hueRadians)
  const b = chroma * Math.sin(hueRadians)
  const l = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3)
  const m = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3)
  const s = Math.pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3)

  return {
    r: Math.round(linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s) * 255),
    g: Math.round(linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s) * 255),
    b: Math.round(linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s) * 255),
    a: Math.max(0, Math.min(1, alpha))
  }
}

export function parseAnyColor(val: string): Rgba {
  const s = val.trim()
  // rgba / rgb
  const rgbaMatch = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/)
  if (rgbaMatch)
    return {
      r: +rgbaMatch[1],
      g: +rgbaMatch[2],
      b: +rgbaMatch[3],
      a: rgbaMatch[4] !== undefined ? +rgbaMatch[4] : 1
    }
  // hsla / hsl
  const hslMatch = s.match(/hsla?\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*(?:,\s*([\d.]+))?\s*\)/)
  if (hslMatch) {
    const h = +hslMatch[1] / 360,
      ss = +hslMatch[2] / 100,
      l = +hslMatch[3] / 100
    const a = hslMatch[4] !== undefined ? +hslMatch[4] : 1
    const hue2rgb = (p: number, q: number, t: number): number => {
      if (t < 0) t += 1
      if (t > 1) t -= 1
      if (t < 1 / 6) return p + (q - p) * 6 * t
      if (t < 1 / 2) return q
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
      return p
    }
    if (ss === 0) {
      const v = Math.round(l * 255)
      return { r: v, g: v, b: v, a }
    }
    const q = l < 0.5 ? l * (1 + ss) : l + ss - l * ss
    const p = 2 * l - q
    return {
      r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      g: Math.round(hue2rgb(p, q, h) * 255),
      b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
      a
    }
  }
  // hsv (not standard CSS, but used in presets)
  const hsvMatch = s.match(/hsv\(\s*(\d+)\s*,\s*(\d+)%\s*,\s*(\d+)%\s*\)/)
  if (hsvMatch) {
    const h = +hsvMatch[1] / 360,
      ss = +hsvMatch[2] / 100,
      v = +hsvMatch[3] / 100
    const c = v * ss,
      x = c * (1 - Math.abs(((h * 6) % 2) - 1)),
      m = v - c
    let r = 0,
      g = 0,
      b = 0
    if (h * 6 < 1) {
      r = c
      g = x
    } else if (h * 6 < 2) {
      r = x
      g = c
    } else if (h * 6 < 3) {
      g = c
      b = x
    } else if (h * 6 < 4) {
      g = x
      b = c
    } else if (h * 6 < 5) {
      r = x
      b = c
    } else {
      r = c
      b = x
    }
    return {
      r: Math.round((r + m) * 255),
      g: Math.round((g + m) * 255),
      b: Math.round((b + m) * 255),
      a: 1
    }
  }
  // oklch(L C H / A)
  const oklchMatch = s.match(
    /^oklch\(\s*([\d.]+%?)\s+([\d.]+%?)\s+([+-]?[\d.]+)(?:deg)?(?:\s*\/\s*([\d.]+%?))?\s*\)$/i
  )
  if (oklchMatch) {
    const parsePercentage = (value: string, scale = 1): number =>
      value.endsWith('%') ? (parseFloat(value) / 100) * scale : parseFloat(value)
    return parseOklch(
      parsePercentage(oklchMatch[1]),
      parsePercentage(oklchMatch[2], 0.4),
      parseFloat(oklchMatch[3]),
      oklchMatch[4] ? parsePercentage(oklchMatch[4]) : 1
    )
  }
  // hex
  const hx = s.replace('#', '')
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hx))
    return {
      r: parseInt(hx.slice(0, 2), 16),
      g: parseInt(hx.slice(2, 4), 16),
      b: parseInt(hx.slice(4, 6), 16),
      a: hx.length === 8 ? parseInt(hx.slice(6, 8), 16) / 255 : 1
    }
  if (/^[0-9a-f]{3}$/i.test(hx))
    return {
      r: parseInt(hx[0] + hx[0], 16),
      g: parseInt(hx[1] + hx[1], 16),
      b: parseInt(hx[2] + hx[2], 16),
      a: 1
    }
  if (/^[0-9a-f]{4}$/i.test(hx)) {
    return parseAnyColor(
      `#${hx
        .split('')
        .map((digit) => digit + digit)
        .join('')}`
    )
  }
  throw new Error('Invalid color')
}

export function hsvaToRgba(hsva: Hsva): Rgba {
  const h = ((hsva.h % 360) + 360) % 360
  const c = hsva.v * hsva.s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = hsva.v - c
  let r = 0,
    g = 0,
    b = 0
  if (h < 60) {
    r = c
    g = x
  } else if (h < 120) {
    r = x
    g = c
  } else if (h < 180) {
    g = c
    b = x
  } else if (h < 240) {
    g = x
    b = c
  } else if (h < 300) {
    r = x
    b = c
  } else {
    r = c
    b = x
  }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
    a: hsva.a
  }
}

export function rgbaToHex(rgba: Rgba, showAlpha = false): string {
  const hex = [rgba.r, rgba.g, rgba.b]
    .map((v) =>
      Math.round(Math.max(0, Math.min(255, v)))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')
  if (showAlpha && rgba.a < 1)
    return `#${hex}${Math.round(rgba.a * 255)
      .toString(16)
      .padStart(2, '0')}`
  return `#${hex}`
}

export function fromHex(hex: string): Hsva {
  const { r, g, b, a } = parseAnyColor(hex)
  const max = Math.max(r, g, b) / 255,
    min = Math.min(r, g, b) / 255,
    d = max - min
  let h = 0
  if (d > 0) {
    if (max === r / 255) h = 60 * (((g / 255 - b / 255) / d + 6) % 6)
    else if (max === g / 255) h = 60 * ((b / 255 - r / 255) / d + 2)
    else h = 60 * ((r / 255 - g / 255) / d + 4)
  }
  return { h, s: max === 0 ? 0 : d / max, v: max, a }
}
