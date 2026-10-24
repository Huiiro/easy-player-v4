import type { SourceCallContext } from '../../../src/main/sources/types'
import { isPlaybackOnly } from '../../../src/main/service/playbackMode'
import { cleanNetworkLyric } from '../../../src/main/service/networkLyricNormalizer'
import type {
  LyricSearchRequest,
  ProviderLyricCandidate
} from '../../../src/main/service/lyrics/types'
import { isRelatedTitle, searchKeyword } from '../../../src/main/service/lyrics/utils'
import { decodeQQMusicLyric, normalizeQQMusicTrack, qrcToYrc } from './qrc'

import {
  record,
  text,
  songTitle,
  fetchQQJson,
  searchQQSongs,
  fetchQQTrack,
  validateMid,
  rpcData,
  requireQQSuccess,
  type QQRecord
} from './shared'

async function fetchQQMusicLyric(
  song: QQRecord,
  wordTimed: boolean,
  context?: SourceCallContext,
  fallback?: LyricSearchRequest
): Promise<ProviderLyricCandidate | null> {
  context?.signal.throwIfAborted()
  if (isPlaybackOnly()) return null
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
    const response = await fetchQQJson(
      'https://u.y.qq.com/cgi-bin/musicu.fcg',
      {
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
      },
      context
    )
    result = rpcData(response)
  } else {
    result = await fetchQQJson(
      `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${params}`,
      undefined,
      context
    )
  }
  requireQQSuccess(result)
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
    resourceId: mid,
    title: songTitle(song) || fallback?.title || '',
    artist: artist || fallback?.artist || '',
    album: text(album.name) || text(album.title) || text(song.albumname) || undefined,
    lrc,
    format,
    supportsWordTiming: wordTimed,
    translation: translation.content || undefined,
    translationFormat: translation.content ? translation.format : undefined,
    romanization: romanization.content || undefined,
    romanizationFormat: romanization.content ? romanization.format : undefined
  }
}

export async function searchQQMusicLyrics(
  request: LyricSearchRequest,
  wordTimed: boolean,
  context?: SourceCallContext
): Promise<ProviderLyricCandidate[]> {
  if (isPlaybackOnly() || !request.title.trim()) return []
  context?.signal.throwIfAborted()
  const songs = await searchQQSongs(searchKeyword(request), context)
  context?.signal.throwIfAborted()
  const seen = new Set<string>()
  const uniqueSongs = songs.filter((value) => {
    const song = record(value)
    const mid = text(song.mid) || text(song.songmid)
    const title = songTitle(song)
    if (!isRelatedTitle(title, request.title, request.artist)) return false
    if (!mid || seen.has(mid)) return false
    seen.add(mid)
    return true
  })
  const results = await Promise.allSettled(
    uniqueSongs
      .slice(0, 5)
      .map((value) => fetchQQMusicLyric(record(value), wordTimed, context, request))
  )
  context?.signal.throwIfAborted()
  if (results.length && results.every((result) => result.status === 'rejected'))
    throw (results[0] as PromiseRejectedResult).reason
  return results.flatMap((result) =>
    result.status === 'fulfilled' && result.value ? [result.value] : []
  )
}

export async function getQQMusicLyrics(
  resourceId: string,
  wordTimed: boolean,
  context?: SourceCallContext
): Promise<ProviderLyricCandidate | null> {
  context?.signal.throwIfAborted()
  validateMid(resourceId)
  if (isPlaybackOnly()) return null
  const data = await fetchQQTrack(resourceId, context)
  context?.signal.throwIfAborted()
  return fetchQQMusicLyric(record(data.track_info), wordTimed, context)
}
