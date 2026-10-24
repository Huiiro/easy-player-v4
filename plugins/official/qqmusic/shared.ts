import type { SourceCallContext } from '../../../src/main/sources/types'
import { SourceCallError } from '../../../src/main/sources/errors'
import { isPlaybackOnly } from '../../../src/main/service/playbackMode'

export type QQRecord = Record<string, unknown>
export const record = (value: unknown): QQRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as QQRecord) : {}
export const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
export const songTitle = (song: QQRecord): string =>
  text(song.title) || text(song.name) || text(song.songname)
export const singerNames = (singers: unknown): string =>
  Array.isArray(singers)
    ? [...new Set(singers.map((singer) => text(record(singer).name)).filter(Boolean))].join(' / ')
    : ''
export function positiveInteger(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}
export function validateMid(mid: unknown): string {
  if (typeof mid !== 'string' || !/^[a-zA-Z0-9]{14}$/.test(mid))
    throw new SourceCallError('INVALID_REQUEST', 'qqmusic')
  return mid
}
const headers = {
  Accept: 'application/json,text/plain,*/*',
  Referer: 'https://y.qq.com/',
  Origin: 'https://y.qq.com',
  'User-Agent': 'Mozilla/5.0'
}
export async function fetchQQJson(
  url: string,
  body?: unknown,
  context?: SourceCallContext
): Promise<QQRecord> {
  context?.signal.throwIfAborted()
  if (isPlaybackOnly()) throw new SourceCallError('BACKGROUND_PAUSED', 'qqmusic')
  const init: RequestInit = {
    method: body ? 'POST' : 'GET',
    headers: body ? { ...headers, 'Content-Type': 'application/json' } : headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: context
      ? AbortSignal.any([context.signal, AbortSignal.timeout(6000)])
      : AbortSignal.timeout(6000)
  }
  const response = await (context?.host
    ? context.host.network.fetch(url, init, context)
    : fetch(url, init))
  if (!response.ok)
    throw Object.assign(new Error('QQ Music HTTP failure'), { status: response.status })
  const source = (await response.text()).trim()
  context?.signal.throwIfAborted()
  const result: unknown = JSON.parse(source.replace(/^[\w.$]+\(([\s\S]*)\);?$/, '$1'))
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new SourceCallError('INVALID_RESPONSE', 'qqmusic')
  return result as QQRecord
}
export function requireQQSuccess(result: QQRecord): void {
  if (result.code === undefined || Number(result.code) === 0) return
  const code = Number(result.code)
  if ([401, 403, 404, 429].includes(code))
    throw Object.assign(new Error('QQ Music request rejected'), { status: code })
  throw new SourceCallError('PROVIDER_ERROR', 'qqmusic')
}
export function rpcData(result: QQRecord): QQRecord {
  requireQQSuccess(result)
  const response = record(result.req_1)
  requireQQSuccess(response)
  if (!response.data || typeof response.data !== 'object' || Array.isArray(response.data))
    throw new SourceCallError('INVALID_RESPONSE', 'qqmusic')
  return record(response.data)
}
export function qqRpc(
  module: string,
  method: string,
  param: QQRecord,
  context?: SourceCallContext
): Promise<QQRecord> {
  return fetchQQJson(
    'https://u.y.qq.com/cgi-bin/musicu.fcg',
    {
      comm: { ct: 24, cv: 0, uin: '0' },
      req_1: { module, method, param }
    },
    context
  ).then(rpcData)
}
export async function searchQQSongs(
  query: string,
  context?: SourceCallContext,
  limit = 5
): Promise<unknown[]> {
  context?.signal.throwIfAborted()
  if (!query.trim()) return []
  try {
    const result = await fetchQQJson(
      'https://u.y.qq.com/cgi-bin/musicu.fcg',
      {
        comm: { ct: '19', cv: '1859', uin: '0' },
        req_1: {
          module: 'music.search.SearchCgiService',
          method: 'DoSearchForQQMusicDesktop',
          param: { query, page_num: 1, num_per_page: limit, search_type: 0 }
        }
      },
      context
    )
    const songs = record(record(rpcData(result).body).song).list
    if (!Array.isArray(songs)) throw new SourceCallError('INVALID_RESPONSE', 'qqmusic')
    return songs
  } catch (reason) {
    context?.signal.throwIfAborted()
    // Do not retry an explicit denial or rate limit against a second endpoint.
    if ([401, 403, 429].includes(Number(record(reason).status))) throw reason
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
    n: String(limit),
    w: query,
    format: 'json'
  })
  const result = await fetchQQJson(
    `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${params}`,
    undefined,
    context
  )
  requireQQSuccess(result)
  const songs = record(record(result.data).song).list
  if (!Array.isArray(songs)) throw new SourceCallError('INVALID_RESPONSE', 'qqmusic')
  return songs
}
export async function fetchQQTrack(mid: string, context?: SourceCallContext): Promise<QQRecord> {
  const safeMid = validateMid(mid)
  const data = await qqRpc(
    'music.pf_song_detail_svr',
    'get_song_detail_yqq',
    { song_mid: safeMid },
    context
  )
  context?.signal.throwIfAborted()
  const track = record(data.track_info)
  if (!Object.keys(track).length) throw new SourceCallError('INVALID_RESPONSE', 'qqmusic')
  if (track.mid !== safeMid) throw new SourceCallError('RESOURCE_NOT_FOUND', 'qqmusic')
  if (!songTitle(track)) throw new SourceCallError('INVALID_RESPONSE', 'qqmusic')
  return data
}
export function albumCover(album: QQRecord): string | undefined {
  const mid = text(album.mid) || text(album.albummid)
  if (!/^[a-zA-Z0-9]{14}$/.test(mid)) return undefined
  const pmid = text(album.pmid)
  const imageId = new RegExp('^' + mid + '(?:_\\d+)?$').test(pmid) ? pmid : mid
  return `https://y.gtimg.cn/music/photo_new/T002R500x500M000${imageId}.jpg`
}
