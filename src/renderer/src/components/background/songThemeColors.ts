type Rgb = [number, number, number]

export class SystemThemeColorAnalyzer {
  private static readonly cache = new Map<string, string>()

  static getCachedSystemThemeColor(cover: string): string | null {
    return this.cache.get(cover) ?? null
  }

  static getSystemThemeColor(image: HTMLImageElement, cover: string): string | null {
    try {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 32
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) return null
      context.drawImage(image, 0, 0, 32, 32)
      const color = extractSystemThemeColor(context.getImageData(0, 0, 32, 32).data)
      if (color) {
        this.cache.set(cover, color)
        if (this.cache.size > 20) this.cache.delete(this.cache.keys().next().value!)
      }
      return color
    } catch {
      return null
    }
  }
}

/** Dominant coverage, including black, rather than averaging black and white artwork. */
export function extractSystemThemeColor(data: Uint8ClampedArray): string | null {
  const all = new Map<string, { sum: Rgb; weight: number }>()
  const chromatic = new Map<string, { sum: Rgb; weight: number }>()
  let visible = 0
  let colored = 0
  for (let i = 0; i < data.length; i += 4) {
    const weight = data[i + 3] / 255
    if (weight < 0.1) continue
    const rgb: Rgb = [data[i], data[i + 1], data[i + 2]]
    const key = rgb.map((channel) => Math.floor(channel / 32)).join('-')
    const add = (map: typeof all): void => {
      const bin = map.get(key) ?? { sum: [0, 0, 0] as Rgb, weight: 0 }
      rgb.forEach((channel, index) => (bin.sum[index] += channel * weight))
      bin.weight += weight
      map.set(key, bin)
    }
    visible += weight
    add(all)
    if (Math.max(...rgb) - Math.min(...rgb) >= 24) {
      colored += weight
      add(chromatic)
    }
  }
  const bins = colored > visible * 0.12 ? chromatic : all
  const dominant = [...bins.values()].sort((a, b) => b.weight - a.weight)[0]
  return dominant ? dominant.sum.map((sum) => Math.round(sum / dominant.weight)).join(' ') : null
}

function luminance(rgb: Rgb): number {
  const linear = rgb.map((channel) => {
    const s = channel / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722
}

export function primarySurfaceColors(color: string): { text: string; hover: string } {
  let channels = color
    .replace(/^rgb\(|\)$/g, '')
    .trim()
    .split(/\s+/)
    .map(Number)
  if (channels.length !== 3 || !channels.every(Number.isFinite)) {
    // Theme presets can use CSS colors such as oklch. Resolve once when themes change.
    const context = document.createElement('canvas').getContext('2d')
    if (!context) return { text: '#ffffff', hover: color }
    context.fillStyle = '#101416'
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
    channels = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3)
  }
  const rgb = channels.map((channel) => Math.max(0, Math.min(255, channel))) as Rgb
  const lightText = 1.05 / (luminance(rgb) + 0.05) >= (luminance(rgb) + 0.05) / 0.05
  // Shade towards black with white text, towards white with black text. Hover
  // therefore improves contrast instead of crossing the foreground threshold.
  return {
    text: lightText ? '#ffffff' : '#000000',
    hover: `rgb(${rgb.map((channel) => Math.round(lightText ? channel * 0.88 : channel + (255 - channel) * 0.12)).join(' ')})`
  }
}

/** Keep accents visible on dark surfaces and safe with the dark on-primary text. */
export function accessibleSongAccent(color: string): string {
  const channels = color
    .replace(/^rgb\(|\)$/g, '')
    .trim()
    .split(/\s+/)
    .map(Number)
  if (channels.length !== 3 || !channels.every(Number.isFinite)) return color
  const rgb = channels.map((channel) => Math.max(0, Math.min(255, channel))) as Rgb
  let low = 0
  let high = 1
  if (luminance(rgb) < 0.3) {
    for (let i = 0; i < 12; i++) {
      const blend = (low + high) / 2
      const candidate = rgb.map((channel) => channel + (255 - channel) * blend) as Rgb
      if (luminance(candidate) < 0.3) low = blend
      else high = blend
    }
    return `rgb(${rgb.map((channel) => Math.ceil(channel + (255 - channel) * high)).join(' ')})`
  }
  return `rgb(${rgb.join(' ')})`
}
