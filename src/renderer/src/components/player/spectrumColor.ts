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
  const background = Number.isFinite(backgroundLuminance)
    ? Math.max(0, Math.min(1, backgroundLuminance))
    : 0.1
  const primary: Rgb = parseRgb(palette.primary) ?? [77, 136, 220]
  const colors = [primary, parseRgb(palette.secondary), parseRgb(palette.tertiary)].filter(
    (color): color is Rgb => color !== null
  )
  const difference = (color: Rgb): number => Math.abs(luminance(color) - background)
  // Prefer a recognizable cover hue over neutral highlights, while keeping
  // sufficient separation from the background. A small bias stabilizes the primary.
  const score = (color: Rgb): number =>
    difference(color) * 0.45 +
    ((Math.max(...color) - Math.min(...color)) / 255) * 0.55 +
    (color === primary ? 0.035 : 0)
  const contrasting = colors.filter((color) => difference(color) >= 0.38)
  const candidates = contrasting.length ? contrasting : colors
  const best = candidates.reduce((selected, color) =>
    score(color) > score(selected) ? color : selected
  )
  if (contrasting.length) return best.map(Math.round).join(' ')

  const edge = background >= 0.5 ? 0 : 255
  for (let step = 1; step <= 10; step += 1) {
    const amount = step / 10
    const adjusted = best.map((channel) => channel + (edge - channel) * amount) as Rgb
    if (difference(adjusted) >= 0.38) return adjusted.map(Math.round).join(' ')
  }
  return `${edge} ${edge} ${edge}`
}

/** A shared, subtle vertical tint for both continuous bars and dot columns. */
export function spectrumGradientColors(color: string): { bottom: string; top: string } {
  const base = parseRgb(color) ?? [77, 136, 220]
  return {
    bottom: base.map((channel) => Math.round(channel * 0.82)).join(' '),
    top: base.map((channel) => Math.round(channel + (255 - channel) * 0.18)).join(' ')
  }
}
