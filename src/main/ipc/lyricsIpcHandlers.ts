import { t } from '../i18n'
import { logError, logOperation, logParams } from '../service/operationLogger'
import { Logger } from '../service/loggerService'
import { ipcMain } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { parseFile } from 'music-metadata'
import {
  lyric as getNeteaseLyric,
  lyric_new as getNeteaseLyricNew,
  search as searchNetease
} from '@neteasecloudmusicapienhanced/api'
import kugouApi from 'kugoumusicapi'
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
  return candidates.sort((left, right) => {
    const score = (candidate: NetworkLyricCandidate): number =>
      matchScore(candidate.title, request.title) * 0.7 +
      matchScore(candidate.artist, request.artist) * 0.2 +
      matchScore(candidate.album, request.album) * 0.1
    return (
      score(right) -
      score(left) +
      (Number(right.format === 'yrc' || right.format === 'krc') -
        Number(left.format === 'yrc' || left.format === 'krc')) *
        0.01
    )
  })
}

async function searchNeteaseLyrics(request: LyricSearchRequest): Promise<NetworkLyricCandidate[]> {
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
      const lrc = cleanNetworkLyric(yrc || result.body?.lrc?.lyric || '', yrc ? 'yrc' : 'lrc')
      if (result.status !== 200 || !lrc) return null
      const translation = cleanNetworkLyric(
        (yrc && result.body?.ytlrc?.lyric?.trim()) || result.body?.tlyric?.lyric || '',
        'lrc'
      )
      const romanization = cleanNetworkLyric(
        (yrc && result.body?.yromalrc?.lyric?.trim()) || result.body?.romalrc?.lyric || '',
        'lrc'
      )
      const artists = Array.isArray(song.artists)
        ? song.artists
            .map((artist) => String((artist as { name?: string }).name ?? ''))
            .filter(Boolean)
            .join(' / ')
        : ''
      const album = (song.album as { name?: string } | undefined)?.name
      return {
        id: `netease:${id}`,
        provider: 'netease' as const,
        title: String(song.name ?? request.title),
        artist: artists || request.artist || '',
        album,
        lrc,
        format: yrc ? 'yrc' : 'lrc',
        supportsWordTiming: Boolean(yrc),
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

async function searchKugouLyrics(request: LyricSearchRequest): Promise<NetworkLyricCandidate[]> {
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
      let krc = ''
      try {
        const krcResult = (await kugouApi.lyric({
          id: String(match.id),
          accesskey: match.accesskey,
          decode: true,
          fmt: 'krc'
        })) as { body?: { decodeContent?: string } }
        krc = krcResult.body?.decodeContent?.trim() ?? ''
      } catch {
        // The normal LRC endpoint can still succeed for this lyric candidate.
      }
      const hasWordTiming = /^\[\d+,\d+\].*<\d+,\d+,\d+>/m.test(krc)
      const normalized = hasWordTiming ? normalizeKrc(krc) : undefined
      const lrc = hasWordTiming
        ? normalized!.lrc
        : cleanNetworkLyric(
            (
              (await kugouApi.lyric({
                id: String(match.id),
                accesskey: match.accesskey,
                decode: true,
                fmt: 'lrc'
              })) as { body?: { decodeContent?: string } }
            ).body?.decodeContent ?? '',
            'lrc'
          )
      if (!lrc) return null
      return {
        id: `kugou:${match.id}`,
        provider: 'kugou' as const,
        title: String(song.SongName ?? request.title),
        artist: String(song.SingerName ?? request.artist ?? ''),
        album: typeof song.AlbumName === 'string' ? song.AlbumName : undefined,
        lrc,
        format: hasWordTiming ? 'krc' : 'lrc',
        supportsWordTiming: hasWordTiming,
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
  if (!request?.title?.trim()) return []
  const results = await Promise.allSettled([
    searchNeteaseLyrics(request),
    searchKugouLyrics(request)
  ])
  return rankCandidates(
    results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])),
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
