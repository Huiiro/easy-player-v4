import type { SourceCallContext } from '../../../src/main/sources/types'
import { isPlaybackOnly } from '../../../src/main/service/playbackMode'
import { cleanNetworkLyric } from '../../../src/main/service/networkLyricNormalizer'
import type {
  LyricSearchRequest,
  ProviderLyricCandidate
} from '../../../src/main/service/lyrics/types'
import { isRelatedTitle } from '../../../src/main/service/lyrics/utils'

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
  wordTimed: boolean,
  context?: SourceCallContext
): Promise<ProviderLyricCandidate[]> {
  context?.signal.throwIfAborted()
  if (isPlaybackOnly()) return []
  const api = await import('@neteasecloudmusicapienhanced/api')
  const { search: searchNetease } = api.default ?? api
  context?.signal.throwIfAborted()
  if (isPlaybackOnly()) return []
  const response = (await searchNetease({
    keywords: [request.title, request.artist].filter(Boolean).join(' ').trim(),
    limit: 8
  })) as unknown as {
    status?: number
    body?: { result?: { songs?: Array<Record<string, unknown>> } }
  }
  if (response.status !== 200)
    throw Object.assign(new Error('NetEase lyrics search failed'), { status: response.status })
  const songs = (response.body?.result?.songs ?? []).filter(
    (song) =>
      typeof song.name === 'string' && isRelatedTitle(song.name, request.title, request.artist)
  )
  context?.signal.throwIfAborted()
  const candidates = await Promise.allSettled(
    songs.slice(0, 6).map(async (song): Promise<ProviderLyricCandidate | null> => {
      const id = song.id as string | number | undefined
      if (id === undefined) return null
      return fetchNeteaseLyric(song, id, wordTimed, context)
    })
  )
  context?.signal.throwIfAborted()
  if (candidates.length && candidates.every((result) => result.status === 'rejected'))
    throw (candidates[0] as PromiseRejectedResult).reason
  return candidates.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : []
  )
}

async function fetchNeteaseLyric(
  song: Record<string, unknown>,
  id: string | number,
  wordTimed: boolean,
  context?: SourceCallContext
): Promise<ProviderLyricCandidate | null> {
  context?.signal.throwIfAborted()
  if (isPlaybackOnly()) return null
  const api = await import('@neteasecloudmusicapienhanced/api')
  const { lyric: getNeteaseLyric, lyric_new: getNeteaseLyricNew } = api.default ?? api
  context?.signal.throwIfAborted()
  let result: NeteaseLyricResponse
  try {
    result = (await getNeteaseLyricNew({ id })) as NeteaseLyricResponse
    context?.signal.throwIfAborted()
    const hasYrc = /^\[\d+,\d+\].*\(\d+,\d+,\d+\)/m.test(result.body?.yrc?.lyric ?? '')
    const hasLrc = /^\[\d+:\d/m.test(result.body?.lrc?.lyric ?? '')
    if (result.status !== 200 || (!hasYrc && !hasLrc)) {
      context?.signal.throwIfAborted()
      result = (await getNeteaseLyric({ id })) as NeteaseLyricResponse
    }
  } catch {
    context?.signal.throwIfAborted()
    result = (await getNeteaseLyric({ id })) as NeteaseLyricResponse
  }
  context?.signal.throwIfAborted()
  const yrcText = result.body?.yrc?.lyric?.trim()
  const yrc = yrcText && /^\[\d+,\d+\].*\(\d+,\d+,\d+\)/m.test(yrcText) ? yrcText : undefined
  const format = wordTimed ? 'yrc' : 'lrc'
  const lrc = cleanNetworkLyric(wordTimed ? yrc || '' : result.body?.lrc?.lyric || '', format)
  if (result.status !== 200)
    throw Object.assign(new Error('NetEase lyric request failed'), { status: result.status })
  if (!lrc) return null
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
    resourceId: String(id),
    title: String(song.name ?? ''),
    artist: artists || '',
    album,
    lrc,
    format,
    supportsWordTiming: wordTimed,
    translation: translation || undefined,
    translationFormat: translation ? 'lrc' : undefined,
    romanization: romanization || undefined,
    romanizationFormat: romanization ? 'lrc' : undefined
  }
}
export async function getNeteaseLyrics(
  resourceId: string,
  wordTimed: boolean,
  context?: SourceCallContext
): Promise<ProviderLyricCandidate | null> {
  if (!/^\d+$/.test(resourceId)) throw new Error('Invalid NetEase track ID')
  return fetchNeteaseLyric({}, resourceId, wordTimed, context)
}
