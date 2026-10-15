import { isPlaybackOnly } from '../../playbackMode'
import { cleanNetworkLyric, normalizeKrc } from '../../networkLyricNormalizer'
import type { LyricSearchRequest, NetworkLyricCandidate } from '../types'
import { searchKeyword } from '../utils'

const KUGOU_COOKIE = 'dfid=test;userid=0;token='

export async function searchKugouLyrics(
  request: LyricSearchRequest,
  wordTimed: boolean
): Promise<NetworkLyricCandidate[]> {
  const { default: kugouApi } = await import('kugoumusicapi')
  if (isPlaybackOnly()) return []
  const response = (await kugouApi.search({
    keywords: searchKeyword(request),
    cookie: KUGOU_COOKIE
  })) as unknown as { body?: { data?: { lists?: Array<Record<string, unknown>> } } }
  const songs = response.body?.data?.lists ?? []
  const candidates = await Promise.allSettled(
    songs.slice(0, 4).map(async (song): Promise<NetworkLyricCandidate | null> => {
      const hash = String(song.FileHash ?? '')
      if (!hash) return null
      const matches = (await kugouApi.search_lyric({ hash })) as unknown as {
        body?: { candidates?: Array<{ id?: string | number; accesskey?: string }> }
      }
      const match = matches.body?.candidates?.[0]
      if (!match?.id || !match.accesskey) return null
      const format = wordTimed ? 'krc' : 'lrc'
      let content = ''
      try {
        const lyricResult = (await kugouApi.lyric({
          id: String(match.id),
          accesskey: match.accesskey,
          decode: true,
          fmt: format
        })) as { body?: { decodeContent?: string } }
        content = lyricResult.body?.decodeContent?.trim() ?? ''
      } catch {
        return null
      }
      const hasWordTiming = /^\[\d+,\d+\].*<\d+,\d+,\d+>/m.test(content)
      if (wordTimed && !hasWordTiming) return null
      const normalized = wordTimed ? normalizeKrc(content) : undefined
      const lrc = wordTimed ? normalized?.lrc : cleanNetworkLyric(content, 'lrc')
      if (!lrc) return null
      return {
        id: `kugou:${match.id}:${format}`,
        provider: 'kugou',
        title: String(song.SongName ?? request.title),
        artist: String(song.SingerName ?? request.artist ?? ''),
        album: typeof song.AlbumName === 'string' ? song.AlbumName : undefined,
        lrc,
        format,
        supportsWordTiming: wordTimed,
        translation: normalized?.translation,
        translationFormat: normalized?.translationFormat,
        romanization: normalized?.romanization,
        romanizationFormat: normalized?.romanizationFormat
      }
    })
  )
  return candidates.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : []
  )
}
