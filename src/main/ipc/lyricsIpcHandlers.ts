import { t } from '../i18n'
import { isPlaybackOnly } from '../service/playbackMode'
import { logError, logOperation, logParams } from '../service/operationLogger'
import { Logger } from '../service/loggerService'
import { ipcMain } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { parseFile } from 'music-metadata'
import { cleanNetworkLyric, normalizeKrc } from '../service/networkLyricNormalizer'

export type LyricsSource = 'embedded' | 'local' | 'network'
type LyricFormat = 'lrc' | 'elrc' | 'yrc' | 'krc' | 'ttml' | 'plain'
interface LyricLoadPayload {
  content: string
  format: LyricFormat
  path?: string
}
export interface LyricSearchRequest {
  title: string
  artist?: string | null
  album?: string | null
  preferWordTimed?: boolean
}
export interface NetworkLyricCandidate {
  id: string
  provider: 'netease' | 'kugou'
  title: string
  artist: string
  album?: string
  lrc: string
  format?: LyricFormat
  supportsWordTiming: boolean
  translation?: string
  translationFormat?: LyricFormat
  romanization?: string
  romanizationFormat?: LyricFormat
}

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

const KUGOU_COOKIE = 'dfid=test;userid=0;token='

function searchKeyword(request: LyricSearchRequest): string {
  return [request.title, request.artist, request.album].filter(Boolean).join(' ').trim()
}

function normalizeMatchText(value?: string | null): string {
  return (value || '').toLowerCase().replace(/[\s\p{P}\p{S}_]+/gu, '')
}

function matchScore(actual: string | undefined, expected: string | null | undefined): number {
  const left = normalizeMatchText(actual)
  const right = normalizeMatchText(expected)
  if (!left || !right) return 0
  if (left === right) return 1
  if (left.includes(right) || right.includes(left)) return 0.8
  const common = [...new Set(left)].filter((character) => right.includes(character)).length
  return common / Math.max(left.length, right.length)
}

function rankCandidates(
  candidates: NetworkLyricCandidate[],
  request: LyricSearchRequest
): NetworkLyricCandidate[] {
  const score = (candidate: NetworkLyricCandidate): number =>
    matchScore(candidate.title, request.title) * 0.7 +
    matchScore(candidate.artist, request.artist) * 0.2 +
    matchScore(candidate.album, request.album) * 0.1
  return candidates.sort((left, right) => {
    return score(right) - score(left)
  })
}

async function searchNeteaseLyrics(
  request: LyricSearchRequest,
  wordTimed: boolean
): Promise<NetworkLyricCandidate[]> {
  const {
    search: searchNetease,
    lyric: getNeteaseLyric,
    lyric_new: getNeteaseLyricNew
  } = await import('@neteasecloudmusicapienhanced/api')
  if (isPlaybackOnly()) return []
  const response = (await searchNetease({
    keywords: searchKeyword(request),
    limit: 8
  })) as unknown as {
    status?: number
    body?: { result?: { songs?: Array<Record<string, unknown>> } }
  }
  if (response.status !== 200) return []
  const songs = response.body?.result?.songs ?? []
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
      const artists = Array.isArray(song.artists)
        ? song.artists
            .map((artist) => String((artist as { name?: string }).name ?? ''))
            .filter(Boolean)
            .join(' / ')
        : ''
      const album = (song.album as { name?: string } | undefined)?.name
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

async function searchKugouLyrics(
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

async function searchNetworkLyrics(request: LyricSearchRequest): Promise<NetworkLyricCandidate[]> {
  if (isPlaybackOnly()) return []
  if (!request?.title?.trim()) return []
  const searchFormat = async (wordTimed: boolean): Promise<NetworkLyricCandidate[]> => {
    const results = await Promise.allSettled([
      searchNeteaseLyrics(request, wordTimed),
      searchKugouLyrics(request, wordTimed)
    ])
    return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
  }
  const preferred = await searchFormat(request.preferWordTimed !== false)
  return rankCandidates(
    preferred.length ? preferred : await searchFormat(request.preferWordTimed === false),
    request
  )
}

function readLocalLyrics(audioPath: string): LyricLoadPayload | null {
  const directory = dirname(audioPath)
  const stem = basename(audioPath, extname(audioPath))
  const formats: LyricFormat[] = ['elrc', 'yrc', 'krc', 'ttml', 'lrc']
  for (const name of [stem, 'lyrics']) {
    for (const format of formats) {
      const path = join(directory, `${name}.${format}`)
      if (existsSync(path)) return { content: readFileSync(path, 'utf8'), format, path }
    }
  }
  return null
}

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

export function registerLyricsIpcHandlers(): void {
  ipcMain.handle(
    'lyrics:load-source',
    async (_event, request: { audioPath: string; source: LyricsSource }) => {
      return logOperation('[IPC] lyrics:load-source', logParams(request), async () => {
        try {
          if (!request?.audioPath || request.source === 'network')
            return { success: true, data: null }
          if (request.source === 'local')
            return { success: true, data: readLocalLyrics(request.audioPath) }
          const metadata = await parseFile(request.audioPath, { skipCovers: true })
          return { success: true, data: embeddedLyricsToPayload(metadata.common.lyrics) }
        } catch (error) {
          Logger.error('[Lyrics IPC] load source failed', logParams(request), logError(error))
          return {
            success: false,
            error: error instanceof Error ? error.message : t('lyricsLoadFailed')
          }
        }
      })
    }
  )
  ipcMain.handle('lyrics:search-network', async (_event, request: LyricSearchRequest) => {
    return logOperation(
      '[IPC] lyrics:search-network',
      { titleLength: request?.title?.length, hasArtist: Boolean(request?.artist) },
      async () => {
        try {
          return { success: true, data: await searchNetworkLyrics(request) }
        } catch (error) {
          Logger.error(
            '[Lyrics IPC] network search failed',
            { titleLength: request?.title?.length },
            logError(error)
          )
          return {
            success: false,
            error: error instanceof Error ? error.message : t('lyricsSearchFailed')
          }
        }
      }
    )
  })
}
