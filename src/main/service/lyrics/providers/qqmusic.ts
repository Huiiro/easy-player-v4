import { isPlaybackOnly } from '../../playbackMode'
import { cleanNetworkLyric } from '../../networkLyricNormalizer'
import type { LyricSearchRequest, NetworkLyricCandidate } from '../types'
import { isRelatedTitle, searchKeyword } from '../utils'
import { decodeQQMusicLyric, normalizeQQMusicTrack, qrcToYrc } from '../qrc'

const headers = {
  Accept: 'application/json,text/plain,*/*',
  Referer: 'https://y.qq.com/',
  Origin: 'https://y.qq.com',
  'User-Agent': 'Mozilla/5.0'
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

async function fetchJson(url: string, body?: unknown): Promise<Record<string, unknown>> {
  if (isPlaybackOnly()) return {}
  const response = await fetch(url, {
    method: body ? 'POST' : 'GET',
    headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(6000)
  })
  if (!response.ok) throw new Error(`QQ Music request failed: ${response.status}`)
  const source = (await response.text()).trim()
  const json = source.replace(/^[\w.$]+\(([\s\S]*)\);?$/, '$1')
  return record(JSON.parse(json))
}

async function searchSongs(query: string): Promise<unknown[]> {
  try {
    const result = await fetchJson('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      comm: { ct: '19', cv: '1859', uin: '0' },
      req_1: {
        module: 'music.search.SearchCgiService',
        method: 'DoSearchForQQMusicDesktop',
        param: { query, page_num: 1, num_per_page: 5, search_type: 0 }
      }
    })
    const response = record(result.req_1)
    const song = record(record(record(response.data).body).song)
    if (
      (result.code === undefined || result.code === 0) &&
      (response.code === undefined || response.code === 0) &&
      Array.isArray(song.list) &&
      song.list.length
    )
      return song.list
  } catch {
    // Older QQ search remains available when the desktop endpoint fails.
  }
  const params = new URLSearchParams({
    ct: '24',
    qqmusic_ver: '1298',
    new_json: '1',
    remoteplace: 'txt.yqq.song',
    t: '0',
    aggr: '1',
    cr: '1',
    catZhida: '1',
    lossless: '0',
    flag_qc: '0',
    p: '1',
    n: '5',
    w: query,
    format: 'json'
  })
  const result = await fetchJson(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${params}`)
  if (result.code !== undefined && result.code !== 0) return []
  const songs = record(record(result.data).song).list
  return Array.isArray(songs) ? songs : []
}

export async function searchQQMusicLyrics(
  request: LyricSearchRequest,
  wordTimed: boolean
): Promise<NetworkLyricCandidate[]> {
  if (isPlaybackOnly() || !request.title.trim()) return []
  const songs = await searchSongs(searchKeyword(request))
  const seen = new Set<string>()
  const uniqueSongs = songs.filter((value) => {
    const song = record(value)
    const mid = text(song.mid) || text(song.songmid)
    const title = text(song.name) || text(song.title) || text(song.songname)
    if (!isRelatedTitle(title, request.title, request.artist)) return false
    if (!mid || seen.has(mid)) return false
    seen.add(mid)
    return true
  })
  const results = await Promise.allSettled(
    uniqueSongs.slice(0, 5).map(async (value): Promise<NetworkLyricCandidate | null> => {
      if (isPlaybackOnly()) return null
      const song = record(value)
      const mid = text(song.mid) || text(song.songmid)
      const params = new URLSearchParams({
        songmid: mid,
        pcachetime: String(Date.now()),
        g_tk: '5381',
        loginUin: '0',
        hostUin: '0',
        format: 'json',
        inCharset: 'utf8',
        outCharset: 'utf-8',
        notice: '0',
        platform: 'yqq',
        needNewCode: '0',
        nobase64: '1'
      })
      let result: Record<string, unknown>
      if (wordTimed) {
        const response = await fetchJson('https://u.y.qq.com/cgi-bin/musicu.fcg', {
          comm: { ct: 19, cv: 1859, uin: 0 },
          req_1: {
            module: 'music.musichallSong.PlayLyricInfo',
            method: 'GetPlayLyricInfo',
            param: {
              songMID: mid,
              songID: Number(song.id ?? song.songid) || 0,
              crypt: 1,
              qrc: 1,
              trans: 1,
              roma: 1,
              lrc_t: 0,
              qrc_t: 0,
              trans_t: 0,
              roma_t: 0
            }
          }
        })
        const payload = record(response.req_1)
        if (
          (response.code !== undefined && response.code !== 0) ||
          (payload.code !== undefined && payload.code !== 0)
        )
          return null
        result = record(payload.data)
      } else {
        result = await fetchJson(
          `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${params}`
        )
      }
      if (result.code !== undefined && result.code !== 0) return null
      const decoded = decodeQQMusicLyric(result.lyric)
      const lrc = wordTimed ? qrcToYrc(decoded) : cleanNetworkLyric(decoded, 'lrc')
      if (!lrc) return null
      const artist = Array.isArray(song.singer)
        ? song.singer
            .map((singer) => text(record(singer).name))
            .filter(Boolean)
            .join(' / ')
        : ''
      const album = record(song.album)
      const translation = normalizeQQMusicTrack(result.trans)
      const romanization = normalizeQQMusicTrack(result.roma)
      const format = wordTimed ? 'yrc' : 'lrc'
      return {
        id: `qqmusic:${mid}:${format}`,
        provider: 'qqmusic',
        title: text(song.name) || text(song.title) || text(song.songname) || request.title,
        artist: artist || request.artist || '',
        album: text(album.name) || text(album.title) || text(song.albumname) || undefined,
        lrc,
        format,
        supportsWordTiming: wordTimed,
        translation: translation.content || undefined,
        translationFormat: translation.content ? translation.format : undefined,
        romanization: romanization.content || undefined,
        romanizationFormat: romanization.content ? romanization.format : undefined
      }
    })
  )
  return results.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : []
  )
}
