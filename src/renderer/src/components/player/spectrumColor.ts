type Rgb = [number, number, number]

function parseRgb(value: string): Rgb | null {
  const channels = value.trim().split(/\s+/).map(Number)
  if (channels.length !== 3 || channels.some((channel) => !Number.isFinite(channel))) return null
  return channels.map((channel) => Math.max(0, Math.min(255, channel))) as Rgb
}

function luminance([red, green, blue]: Rgb): number {
  return (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 255
}

export function chooseSpectrumColor(
  palette: { primary: string; secondary: string; tertiary: string },
  backgroundLuminance: number
): string {
  const background = Math.max(0, Math.min(1, backgroundLuminance))
  const primary: Rgb = parseRgb(palette.primary) ?? [77, 136, 220]
  const colors = [primary, parseRgb(palette.secondary), parseRgb(palette.tertiary)].filter(
    (color): color is Rgb => color !== null
  )
  const difference = (color: Rgb): number => Math.abs(luminance(color) - background)
  const best = colors.reduce(
    (selected, color) => (difference(color) > difference(selected) ? color : selected),
    primary
  )
  if (difference(primary) >= 0.38) return primary.map(Math.round).join(' ')
  if (difference(best) >= 0.38) return best.map(Math.round).join(' ')

  const edge = background >= 0.5 ? 0 : 255
  for (let step = 1; step <= 10; step += 1) {
    const amount = step / 10
    const adjusted = primary.map((channel) => channel + (edge - channel) * amount) as Rgb
    if (difference(adjusted) >= 0.38) return adjusted.map(Math.round).join(' ')
  }
  return `${edge} ${edge} ${edge}`
}
