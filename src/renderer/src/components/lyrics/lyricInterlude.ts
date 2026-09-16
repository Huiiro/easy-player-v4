import type { LyricLine } from '@/services/lyrics'

/** Display-only gaps. Never invent an ending for ordinary untimed/LRC text. */
export function withLyricInterludes(lines: LyricLine[]): LyricLine[] {
  if (!lines.length || lines.every((line) => line.untimed)) return lines
  // Source timestamp-only rows are timing markers, not visible lyric rows.
  // Generate AM-style interludes below from the gap between actual text lines.
  const visibleLines = lines.filter((line) => line.text.trim())
  const result: LyricLine[] = []
  if (!visibleLines.length) return result
  if (visibleLines[0].timeMs > 3000 && visibleLines[0].text.trim()) {
    result.push({ timeMs: 0, endMs: visibleLines[0].timeMs, text: '' })
  }
  visibleLines.forEach((line, index) => {
    result.push(line)
    const next = visibleLines[index + 1]
    if (
      next &&
      line.text.trim() &&
      next.text.trim() &&
      line.endMs !== undefined &&
      next.timeMs - line.endMs > 3000
    ) {
      result.push({ timeMs: line.endMs, endMs: next.timeMs, text: '' })
    }
  })
  return result
}
