import { SourceCallError } from '../../../src/main/sources/errors'
import type { SourceCallContext } from '../../../src/main/sources/types'

export const KUGOU_PUBLIC_COOKIE = 'dfid=test;userid=0;token='
export type KugouRecord = Record<string, unknown>
export const record = (value: unknown): KugouRecord =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as KugouRecord) : {}
export const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
export function positiveInteger(value: unknown): number | undefined {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}
export function trackId(value: unknown): string {
  const id = typeof value === 'string' || typeof value === 'number' ? String(value) : ''
  if (!/^\d{1,16}$/.test(id) || !positiveInteger(id))
    throw new SourceCallError('INVALID_REQUEST', 'kugou')
  return String(Number(id))
}
export function artistNames(value: unknown): string {
  if (!Array.isArray(value)) return ''
  return [
    ...new Set(
      value
        .map((entry) => {
          const artist = record(entry)
          return (
            text(artist.name) || text(artist.author_name) || text(record(artist.base).author_name)
          )
        })
        .filter(Boolean)
    )
  ].join(' / ')
}
export function trackTitle(song: KugouRecord): string {
  const base = record(song.base),
    extra = record(song.extra)
  const title =
    text(base.songname) ||
    text(song.SongName) ||
    text(song.OriSongName) ||
    text(extra.ori_audio_name)
  if (!title) return ''
  const suffix = (
    text(song.Suffix) ||
    text(record(song.trans_param).songname_suffix) ||
    text(extra.suffix_audio_name)
  )
    .replace(/^[（(]|[）)]$/g, '')
    .trim()
  return suffix &&
    !title.toLowerCase().endsWith(` ${suffix.toLowerCase()}`) &&
    !title.toLowerCase().endsWith(`(${suffix.toLowerCase()})`) &&
    !title.toLowerCase().endsWith(`（${suffix.toLowerCase()}）`)
    ? `${title} (${suffix})`
    : title
}
export function bodyOf(value: unknown): KugouRecord {
  const response = record(value),
    body = record(response.body)
  if (response.status !== undefined && Number(response.status) !== 200)
    throw Object.assign(new Error('Kugou HTTP failure'), { status: response.status })
  if (!Object.keys(body).length) throw new SourceCallError('INVALID_RESPONSE', 'kugou')
  if (
    (body.status !== undefined && ![1, 200].includes(Number(body.status))) ||
    (body.error_code !== undefined && Number(body.error_code) !== 0) ||
    (body.errcode !== undefined &&
      Number(body.errcode) !== 0 &&
      !(Number(body.status) === 200 && Number(body.errcode) === 200))
  ) {
    const status = [Number(body.status), Number(body.error_code), Number(body.errcode)].find(
      (code) => [401, 403, 404, 429].includes(code)
    )
    if (status) throw Object.assign(new Error('Kugou request rejected'), { status })
    throw new SourceCallError('PROVIDER_ERROR', 'kugou')
  }
  return body
}
export async function fetchKugouTrack(
  id: string,
  context?: SourceCallContext
): Promise<KugouRecord> {
  const safeId = trackId(id)
  context?.signal.throwIfAborted()
  const { default: api } = await import('kugoumusicapi')
  context?.signal.throwIfAborted()
  const body = bodyOf(
    await api.krm_audio({
      album_audio_id: safeId,
      fields: 'base,album_info,authors.base,audio_info,extra,tags',
      cookie: KUGOU_PUBLIC_COOKIE
    })
  )
  context?.signal.throwIfAborted()
  if (!Array.isArray(body.data)) throw new SourceCallError('INVALID_RESPONSE', 'kugou')
  const song = body.data
    .map(record)
    .find((entry) => String(record(entry.base).album_audio_id) === safeId)
  if (!song || (song.__status !== undefined && Number(song.__status) !== 1))
    throw new SourceCallError('RESOURCE_NOT_FOUND', 'kugou')
  return song
}
export function coverUrl(value: unknown): string | undefined {
  const url = text(value)
    .replace(/\{size\}/g, '500')
    .replace(/^http:/i, 'https:')
  if (!url) return undefined
  try {
    const parsed = new URL(url)
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password
      ? url
      : undefined
  } catch {
    return undefined
  }
}
