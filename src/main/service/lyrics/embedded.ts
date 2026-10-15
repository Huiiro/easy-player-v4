import { parseFile } from 'music-metadata'
import type { LyricLoadPayload } from './types'

function formatTimestamp(timestampMs: number): string {
  const totalSeconds = Math.max(0, timestampMs) / 1000
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = (totalSeconds % 60).toFixed(2).padStart(5, '0')
  return `${minutes}:${seconds}`
}

function embeddedLyricsToPayload(
  lyrics: Awaited<ReturnType<typeof parseFile>>['common']['lyrics']
): LyricLoadPayload | null {
  if (!lyrics?.length) return null
  const synchronized = lyrics.flatMap((tag) =>
    tag.syncText
      .filter((item) => item.text?.trim() && typeof item.timestamp === 'number')
      .map((item) => `[${formatTimestamp(item.timestamp!)}]${item.text.trim()}`)
  )
  if (synchronized.length) return { content: synchronized.join('\n'), format: 'lrc' }
  const content = lyrics
    .map((tag) => tag.text?.trim())
    .filter(Boolean)
    .join('\n')
  return content ? { content, format: 'plain' } : null
}

export async function readEmbeddedLyrics(audioPath: string): Promise<LyricLoadPayload | null> {
  const metadata = await parseFile(audioPath, { skipCovers: true })
  return embeddedLyricsToPayload(metadata.common.lyrics)
}
