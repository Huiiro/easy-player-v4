export type StageColors = readonly [steel: string, white: string, tungsten: string]

export interface CheerPalette {
  light: string
  core: string
  distantCore: string
  fixtures: StageColors
  shade: (material: string) => string
}

function readHex(hex: string): number[] {
  return [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16))
}

export function createCheerPalette(color: string): CheerPalette {
  const rgb = readHex(color)
  const warm = [255, 224, 164]
  const blend = (amount: number): string =>
    rgb.map((channel, index) => Math.round(channel + (warm[index] - channel) * amount)).join(' ')
  const materials = new Map<string, string>()
  const peak = Math.max(80, ...rgb)
  return {
    light: rgb.join(' '),
    core: blend(0.49),
    distantCore: blend(0.27),
    fixtures: [blend(0.06), blend(0.64), blend(0.38)],
    shade(material) {
      const cached = materials.get(material)
      if (cached) return cached
      const base = readHex(material)
      const level = base[0] * 0.28 + base[1] * 0.52 + base[2] * 0.2
      const channels = base.map((channel, index) =>
        Math.round(channel * 0.25 + level * (0.055 + (0.95 * rgb[index]) / peak))
      )
      const shaded = `rgb(${channels.join(' ')})`
      materials.set(material, shaded)
      return shaded
    }
  }
}
