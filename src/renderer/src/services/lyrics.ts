export type LyricSource = 'embedded' | 'database' | 'local' | 'network'
export interface LyricLine {
  timeMs: number
  text: string
  translation?: string
  chars?: LyricChar[]
}

export interface LyricChar {
  char: string
  start: number
  duration: number
}

export interface NetworkLyricCandidate {
  id: string
  provider: 'netease' | 'kugou'
  title: string
  artist: string
  album?: string
  lrc: string
  translation?: string
}

function parseEnhanced(content: string): Pick<LyricLine, 'text' | 'chars'> {
  const matches = [...content.matchAll(/<(\d{2}:\d{2}\.\d{2,3})>([^<])/g)]
  if (!matches.length) return { text: content }
  const toMs = (value: string): number => {
    const [minutes, seconds] = value.split(':')
    return (Number(minutes) * 60 + Number(seconds)) * 1000
  }
  const chars = matches.map((match) => ({ char: match[2], start: toMs(match[1]), duration: 0 }))
  for (let index = 0; index < chars.length; index += 1)
    chars[index].duration = chars[index + 1]?.start - chars[index].start || 300
  return { text: chars.map((item) => item.char).join(''), chars }
}

export function parseLrc(source: string, translation?: string | null): LyricLine[] {
  const translations = new Map<number, string>()
  for (const line of (translation || '').split(/\r?\n/)) {
    const match = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/)
    if (match) translations.set((Number(match[1]) * 60 + Number(match[2])) * 1000, match[3].trim())
  }
  const result: LyricLine[] = []
  for (const line of source.split(/\r?\n/)) {
    const parsed = parseEnhanced(line.replace(/\[[^\]]+\]/g, '').trim())
    const stamps = [...line.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)]
    for (const stamp of stamps) {
      const timeMs = (Number(stamp[1]) * 60 + Number(stamp[2])) * 1000
      if (parsed.text) result.push({ timeMs, ...parsed, translation: translations.get(timeMs) })
    }
  }
  return result.sort((a, b) => a.timeMs - b.timeMs)
}

export async function resolveLyrics(
  song: {
    id: number
    audio: string
    title?: string
    artist?: string | null
    album?: string | null
  },
  order: LyricSource[],
  forcedSource: LyricSource | 'auto' = 'auto',
  allowAutoNetworkSearch = true
): Promise<{ lines: LyricLine[]; source: LyricSource | null }> {
  const sourceOrder =
    forcedSource === 'auto'
      ? [
          ...order.filter((source) => source !== 'network'),
          ...(allowAutoNetworkSearch && order.includes('network') ? ['network' as const] : [])
        ]
      : [forcedSource]
  for (const source of sourceOrder) {
    let lrc: string | null | undefined
    let translation: string | null | undefined
    if (source === 'database') {
      const response = await window.api.database.command('getSong', { id: song.id })
      const data = response.success
        ? (response.data as { lrc?: string | null; translation?: string | null })
        : null
      lrc = data?.lrc
      translation = data?.translation
    } else if (source === 'network') {
      // Network lookup is intentionally only an automatic fallback. Manual
      // searches are handled by the lyrics manager and require saving first.
      if (forcedSource !== 'auto' || !allowAutoNetworkSearch) continue
      const response = await window.api.lyrics.searchNetwork({
        title: song.title || '',
        artist: song.artist,
        album: song.album
      })
      const candidate = response.success ? response.data?.[0] : null
      if (!candidate) continue
      lrc = candidate.lrc
      translation = candidate.translation
      // Automatic lookup deliberately accepts the first match and caches it.
      await window.api.database.command('updateSongLyrics', { id: song.id, lrc, translation })
    } else {
      const response = await window.api.lyrics.loadSource(song.audio, source)
      lrc = response.success ? response.data : null
    }
    if (!lrc) continue
    const lines = parseLrc(lrc, translation)
    if (lines.length) return { lines, source }
  }
  return { lines: [], source: null }
}
