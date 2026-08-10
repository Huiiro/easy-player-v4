import { ipcMain } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { parseFile } from 'music-metadata'
import {
  lyric as getNeteaseLyric,
  search as searchNetease
} from '@neteasecloudmusicapienhanced/api'
import kugouApi from 'kugoumusicapi'

export type LyricsSource = 'embedded' | 'local' | 'network'
type LyricFormat = 'lrc' | 'elrc' | 'yrc' | 'ttml' | 'plain'
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
  translation?: string
  romanization?: string
}

const KUGOU_COOKIE = 'dfid=test;userid=0;token='

function searchKeyword(request: LyricSearchRequest): string {
  return [request.title, request.artist, request.album].filter(Boolean).join(' ').trim()
}

function normalizeLyric(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() && !/^\[(?:offset|ti|ar|al|by):/i.test(line))
    .join('\n')
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
  const candidates: Array<NetworkLyricCandidate | null> = await Promise.all(
    songs.slice(0, 6).map(async (song) => {
      const id = song.id as string | number | undefined
      if (id === undefined) return null
      const result = (await getNeteaseLyric({ id })) as unknown as {
        status?: number
        body?: {
          lrc?: { lyric?: string }
          yrc?: { lyric?: string }
          tlyric?: { lyric?: string }
          romalrc?: { lyric?: string }
        }
      }
      const yrc = result.body?.yrc?.lyric?.trim()
      const lrc = yrc || result.body?.lrc?.lyric?.trim()
      if (result.status !== 200 || !lrc) return null
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
        translation: result.body?.tlyric?.lyric?.trim() || undefined,
        romanization: result.body?.romalrc?.lyric?.trim() || undefined
      }
    })
  )
  return candidates.filter((candidate): candidate is NetworkLyricCandidate => candidate !== null)
}

async function searchKugouLyrics(request: LyricSearchRequest): Promise<NetworkLyricCandidate[]> {
  const response = (await kugouApi.search({
    keywords: searchKeyword(request),
    cookie: KUGOU_COOKIE
  })) as unknown as { body?: { data?: { lists?: Array<Record<string, unknown>> } } }
  const songs = response.body?.data?.lists ?? []
  const candidates: Array<NetworkLyricCandidate | null> = await Promise.all(
    songs.slice(0, 4).map(async (song) => {
      const hash = String(song.FileHash ?? '')
      if (!hash) return null
      const matches = (await kugouApi.search_lyric({ hash })) as unknown as {
        body?: { candidates?: Array<{ id?: string | number; accesskey?: string }> }
      }
      const match = matches.body?.candidates?.[0]
      if (!match?.id || !match.accesskey) return null
      const lyricResult = (await kugouApi.lyric({
        id: String(match.id),
        accesskey: match.accesskey,
        decode: true,
        fmt: 'lrc'
      })) as unknown as { body?: { decodeContent?: string } }
      const lrc = normalizeLyric(lyricResult.body?.decodeContent ?? '')
      if (!lrc) return null
      return {
        id: `kugou:${match.id}`,
        provider: 'kugou' as const,
        title: String(song.SongName ?? request.title),
        artist: String(song.SingerName ?? request.artist ?? ''),
        album: typeof song.AlbumName === 'string' ? song.AlbumName : undefined,
        lrc
      }
    })
  )
  return candidates.filter((candidate): candidate is NetworkLyricCandidate => candidate !== null)
}

async function searchNetworkLyrics(request: LyricSearchRequest): Promise<NetworkLyricCandidate[]> {
  if (!request?.title?.trim()) return []
  const results = await Promise.allSettled([
    searchNeteaseLyrics(request),
    searchKugouLyrics(request)
  ])
  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
}

function readLocalLyrics(audioPath: string): LyricLoadPayload | null {
  const directory = dirname(audioPath)
  const stem = basename(audioPath, extname(audioPath))
  const formats: LyricFormat[] = ['elrc', 'yrc', 'ttml', 'lrc']
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
      try {
        if (!request?.audioPath || request.source === 'network')
          return { success: true, data: null }
        if (request.source === 'local')
          return { success: true, data: readLocalLyrics(request.audioPath) }
        const metadata = await parseFile(request.audioPath, { skipCovers: true })
        return { success: true, data: embeddedLyricsToPayload(metadata.common.lyrics) }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unable to load lyrics'
        }
      }
    }
  )
  ipcMain.handle('lyrics:search-network', async (_event, request: LyricSearchRequest) => {
    try {
      return { success: true, data: await searchNetworkLyrics(request) }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unable to search network lyrics'
      }
    }
  })
}
