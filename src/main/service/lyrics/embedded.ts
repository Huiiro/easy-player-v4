import { detectLyricFormat } from '../../../shared/lyricFormat'
import { parseAudioFile } from '../audioMetadataService'
import type { LyricLoadPayload } from './types'

function formatTimestamp(timestampMs: number): string {
  const totalSeconds = Math.floor(timestampMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  const fraction = String(timestampMs % 1000)
    .padStart(3, '0')
    .replace(/0$/, '')
  return `${minutes}:${seconds}.${fraction}`
}

function lyricText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function embeddedLyricsToPayload(lyrics: unknown): LyricLoadPayload | null {
  const synchronized: string[] = []
  const textTags: string[] = []
  const tags: unknown[] = Array.isArray(lyrics) ? lyrics : [lyrics]
  for (const value of tags) {
    // ID3 USLT and ULT have text but no syncText, despite the library's type.
    const tag: { text?: unknown; syncText?: unknown } =
      value && typeof value === 'object'
        ? (value as { text?: unknown; syncText?: unknown })
        : { text: value }
    const text = lyricText(tag.text)
    if (text) textTags.push(text)
    if (!Array.isArray(tag.syncText)) continue
    for (const row of tag.syncText as unknown[]) {
      if (!row || typeof row !== 'object') continue
      const { text, timestamp } = row as { text?: unknown; timestamp?: unknown }
      const line = lyricText(text)
      if (
        line &&
        typeof timestamp === 'number' &&
        Number.isSafeInteger(timestamp) &&
        timestamp >= 0
      )
        synchronized.push(`[${formatTimestamp(timestamp)}]${line}`)
    }
  }
  if (synchronized.length) return { content: synchronized.join('\n'), format: 'lrc' }
  for (const content of textTags) {
    const format = detectLyricFormat(content)
    if (format !== 'plain') return { content, format }
  }
  const content = textTags.join('\n')
  return content ? { content, format: 'plain' } : null
}

export async function readEmbeddedLyrics(audioPath: string): Promise<LyricLoadPayload | null> {
  const metadata = await parseAudioFile(audioPath, { skipCovers: true })
  return embeddedLyricsToPayload(metadata.common.lyrics)
}
