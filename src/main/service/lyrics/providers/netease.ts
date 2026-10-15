import { isPlaybackOnly } from '../../playbackMode'
import { cleanNetworkLyric } from '../../networkLyricNormalizer'
import type { LyricSearchRequest, NetworkLyricCandidate } from '../types'
import { isRelatedTitle } from '../utils'

interface NeteaseLyricResponse {
  status?: number
  body?: {
    lrc?: { lyric?: string }
    yrc?: { lyric?: string }
    tlyric?: { lyric?: string }
    ytlrc?: { lyric?: string }
    romalrc?: { lyric?: string }
    yromalrc?: { lyric?: string }
  }
}

export async function searchNeteaseLyrics(
  request: LyricSearchRequest,
  wordTimed: boolean
): Promise<NetworkLyricCandidate[]> {
  if (isPlaybackOnly()) return []
  const api = await import('@neteasecloudmusicapienhanced/api')
  const {
    search: searchNetease,
    lyric: getNeteaseLyric,
    lyric_new: getNeteaseLyricNew
  } = api.default ?? api
  if (isPlaybackOnly()) return []
  const response = (await searchNetease({
    keywords: [request.title, request.artist].filter(Boolean).join(' ').trim(),
    limit: 8
  })) as unknown as {
    status?: number
    body?: { result?: { songs?: Array<Record<string, unknown>> } }
  }
  if (response.status !== 200) return []
  const songs = (response.body?.result?.songs ?? []).filter(
    (song) =>
      typeof song.name === 'string' && isRelatedTitle(song.name, request.title, request.artist)
  )
  const candidates = await Promise.allSettled(
    songs.slice(0, 6).map(async (song): Promise<NetworkLyricCandidate | null> => {
      const id = song.id as string | number | undefined
      if (id === undefined) return null
      let result: NeteaseLyricResponse
      try {
        result = (await getNeteaseLyricNew({ id })) as NeteaseLyricResponse
        const hasYrc = /^\[\d+,\d+\].*\(\d+,\d+,\d+\)/m.test(result.body?.yrc?.lyric ?? '')
        const hasLrc = /^\[\d+:\d/m.test(result.body?.lrc?.lyric ?? '')
        if (result.status !== 200 || (!hasYrc && !hasLrc))
          result = (await getNeteaseLyric({ id })) as NeteaseLyricResponse
      } catch {
        result = (await getNeteaseLyric({ id })) as NeteaseLyricResponse
      }
      const yrcText = result.body?.yrc?.lyric?.trim()
      const yrc = yrcText && /^\[\d+,\d+\].*\(\d+,\d+,\d+\)/m.test(yrcText) ? yrcText : undefined
      const format = wordTimed ? 'yrc' : 'lrc'
      const lrc = cleanNetworkLyric(wordTimed ? yrc || '' : result.body?.lrc?.lyric || '', format)
      if (result.status !== 200 || !lrc) return null
      const songArtists = song.artists ?? song.ar
      const artists = Array.isArray(songArtists)
        ? songArtists
            .map((artist) => String((artist as { name?: string }).name ?? ''))
            .filter(Boolean)
            .join(' / ')
        : ''
      const album = ((song.album ?? song.al) as { name?: string } | undefined)?.name
      const translation = cleanNetworkLyric(
        (wordTimed
          ? result.body?.ytlrc?.lyric || result.body?.tlyric?.lyric
          : result.body?.tlyric?.lyric || result.body?.ytlrc?.lyric) || '',
        'lrc'
      )
      const romanization = cleanNetworkLyric(
        (wordTimed
          ? result.body?.yromalrc?.lyric || result.body?.romalrc?.lyric
          : result.body?.romalrc?.lyric || result.body?.yromalrc?.lyric) || '',
        'lrc'
      )
      return {
        id: `netease:${id}:${format}`,
        provider: 'netease',
        title: String(song.name ?? request.title),
        artist: artists || request.artist || '',
        album,
        lrc,
        format,
        supportsWordTiming: wordTimed,
        translation: translation || undefined,
        translationFormat: translation ? 'lrc' : undefined,
        romanization: romanization || undefined,
        romanizationFormat: romanization ? 'lrc' : undefined
      }
    })
  )
  return candidates.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : []
  )
}
