function windowSizeProgress(current: number, minimum: number, maximum: number): number {
  if (maximum <= minimum) return 1
  return Math.max(0, Math.min(1, (current - minimum) / (maximum - minimum)))
}

export function getAutomaticLyricsMetrics(
  width: number,
  height: number,
  availableWidth: number,
  availableHeight: number
): { fontSize: number; padding: number } {
  const progress = Math.min(
    windowSizeProgress(width, 1280, availableWidth),
    windowSizeProgress(height, 780, availableHeight)
  )
  // Match the player's 0.1x font and spacing steps, up to 1.8x and 2.4x.
  return {
    fontSize: Number(((10 + Math.round(8 * progress)) * 0.24).toFixed(2)),
    padding: 30 + Math.round(14 * progress) * 3
  }
}
