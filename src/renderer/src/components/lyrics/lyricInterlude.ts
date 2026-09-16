import type { LyricLine } from '@/services/lyrics'

/** Display-only gaps. Never invent an ending for ordinary untimed/LRC text. */
export function withLyricInterludes(lines: LyricLine[]): LyricLine[] {
  if (!lines.length || lines.every((line) => line.untimed)) return lines
  const result: LyricLine[] = []
  if (lines[0].timeMs >= 3000 && lines[0].text.trim()) {
    result.push({ timeMs: 0, endMs: lines[0].timeMs, text: '' })
  }
  lines.forEach((line, index) => {
    result.push(line)
    const next = lines[index + 1]
    if (
      next &&
      line.text.trim() &&
      next.text.trim() &&
      line.endMs !== undefined &&
      next.timeMs - line.endMs >= 3000
    ) {
      result.push({ timeMs: line.endMs, endMs: next.timeMs, text: '' })
    }
  })
  return result
}
