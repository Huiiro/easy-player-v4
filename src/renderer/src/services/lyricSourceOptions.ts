import { isLyricFormat, parseLyrics, type LyricFormat, type LyricSource } from './lyrics'
import type { LibrarySong } from '@/types/library'

function hasUsableLyrics(content: string, format?: LyricFormat): boolean {
  try {
    return parseLyrics({ content, format, source: 'database' }).lines.length > 0
  } catch {
    return false
  }
}
export async function loadLyricSourceOptions(
  song: LibrarySong,
  preferWordTimed: boolean
): Promise<Array<{ source: LyricSource; content: string; format?: LyricFormat }>> {
  const [embedded, local, database, network] = await Promise.all([
    window.api.lyrics.loadSource(song.audio, 'embedded'),
    window.api.lyrics.loadSource(song.audio, 'local'),
    window.api.database.command('getSong', { id: song.id }),
    window.api.lyrics.searchNetwork({
      title: song.title,
      artist: song.artist,
      album: song.album,
      preferWordTimed: preferWordTimed
    })
  ])
  const databaseSong = database.success
    ? (database.data as { lrc?: string | null; lyricFormat?: unknown })
    : null
  const networkCandidate = network.success ? network.data?.[0] : null
  const candidates = [
    {
      source: 'embedded' as const,
      content: embedded.success ? embedded.data?.content || '' : '',
      format: embedded.success ? embedded.data?.format : undefined
    },
    {
      source: 'database' as const,
      content: databaseSong?.lrc || '',
      format: isLyricFormat(databaseSong?.lyricFormat) ? databaseSong.lyricFormat : undefined
    },
    {
      source: 'local' as const,
      content: local.success ? local.data?.content || '' : '',
      format: local.success ? local.data?.format : undefined
    },
    {
      source: 'network' as const,
      content: networkCandidate?.lrc || '',
      format: networkCandidate?.format
    }
  ]
  return candidates.filter((item) => hasUsableLyrics(item.content, item.format))
}
