export function normalizeRhythmVisualIntensity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0.6
  if (value < 0.4) return 0.2
  if (value < 0.8) return 0.6
  return 1
}
