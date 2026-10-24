import { joinMetadataValues } from '../../../src/shared/metadataValues'
import type { SourceTrackDetail, SourceTrackSummary } from '../../../src/shared/sourceMetadata'
import type { SourceCallContext } from '../../../src/main/sources/types'
import { normalizeSourceGenreNames } from '../../shared/genreNormalization'
import { requireBackgroundWork } from '../../../src/main/service/playbackMode'

type RecordValue = Record<string, unknown>
const record = (value: unknown): RecordValue =>
  value && typeof value === 'object' ? (value as RecordValue) : {}
const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const positiveInteger = (value: unknown): number | undefined => {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : undefined
}
function resourceId(value: unknown): string {
  const id = String(value ?? '')
  if (!/^\d+$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) <= 0)
    throw new Error('Invalid NetEase track ID')
  return id
}
function artistNames(value: unknown): string {
  return Array.isArray(value)
    ? value
        .map((artist) => text(record(artist).name))
        .filter(Boolean)
        .join(' / ')
    : ''
}
/** The encyclopedia also returns mood/business tags; only its songTag section is genre data. */
function wikiGenres(body: unknown): string | undefined {
  const records = (value: unknown): RecordValue[] => (Array.isArray(value) ? value.map(record) : [])
  const names = records(record(record(body).data).blocks)
    .filter((block) => block.code === 'SONG_PLAY_ABOUT_SONG_BASIC')
    .flatMap((block) => records(block.creatives))
    .filter((creative) => creative.creativeType === 'songTag')
    .flatMap((creative) => records(creative.resources))
    .filter((resource) => resource.resourceType === 'melody_style' && resource.valid !== false)
    .map((resource) => text(record(record(resource.uiElement).mainTitle).title))
  return joinMetadataValues(normalizeSourceGenreNames(names))
}
function summary(value: unknown): SourceTrackSummary {
  const song = record(value)
  return {
    resource: { sourceId: 'netease', resourceType: 'track', resourceId: resourceId(song.id) },
    title: text(song.name),
    artist: artistNames(song.ar ?? song.artists),
    album: text(record(song.al ?? song.album).name) || undefined,
    durationMs: positiveInteger(song.dt ?? song.duration)
  }
}
export async function searchNeteaseTracks(
  query: string,
  context?: SourceCallContext
): Promise<SourceTrackSummary[]> {
  context?.signal.throwIfAborted()
  requireBackgroundWork()
  if (!query.trim()) return []
  const api = await import('@neteasecloudmusicapienhanced/api')
  context?.signal.throwIfAborted()
  const response = await (api.default ?? api).search({ keywords: query.trim(), type: 1, limit: 20 })
  context?.signal.throwIfAborted()
  requireBackgroundWork()
  if (response.status !== 200)
    throw Object.assign(new Error('NetEase track search failed'), { status: response.status })
  const songs = record(record(response.body).result).songs
  return (Array.isArray(songs) ? songs : []).flatMap((song) => {
    try {
      const item = summary(song)
      return item.title ? [item] : []
    } catch {
      return []
    }
  })
}
export async function getNeteaseTrack(
  id: string,
  context?: SourceCallContext
): Promise<SourceTrackDetail> {
  context?.signal.throwIfAborted()
  requireBackgroundWork()
  const safeId = resourceId(id)
  const api = await import('@neteasecloudmusicapienhanced/api')
  const sdk = api.default ?? api
  context?.signal.throwIfAborted()
  const response = await sdk.song_detail({ ids: safeId })
  context?.signal.throwIfAborted()
  requireBackgroundWork()
  const song = response.body.songs?.find((value) => String(value.id) === safeId)
  if (response.status !== 200 || !song)
    throw Object.assign(new Error('NetEase track detail unavailable'), {
      status: response.status !== 200 ? response.status : 404
    })
  const item = summary(song)
  const album = record(song.al)
  // Both enrichments are optional and run in parallel after resolving the exact track.
  const [albumResult, wikiResult] = await Promise.allSettled([
    Promise.resolve().then(() => {
      context?.signal.throwIfAborted()
      return album.id ? sdk.album({ id: resourceId(album.id) }) : undefined
    }),
    Promise.resolve().then(() => {
      context?.signal.throwIfAborted()
      return sdk.song_wiki_summary({ id: safeId })
    })
  ])
  const albumDetail =
    albumResult.status === 'fulfilled' && albumResult.value?.status === 200
      ? record(record(albumResult.value.body).album)
      : {}
  const genre =
    wikiResult.status === 'fulfilled' &&
    wikiResult.value.status === 200 &&
    wikiResult.value.body.code === 200
      ? wikiGenres(wikiResult.value.body)
      : undefined
  context?.signal.throwIfAborted()
  requireBackgroundWork()
  const published = positiveInteger(song.publishTime) ?? positiveInteger(albumDetail.publishTime)
  const date = published ? new Date(published) : undefined
  const releaseDate =
    date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : undefined
  const imageUrl = text(album.picUrl) || text(albumDetail.picUrl)
  return {
    ...item,
    metadata: {
      title: item.title,
      artist: item.artist || undefined,
      album: item.album,
      albumArtist:
        artistNames(albumDetail.artists) || text(record(albumDetail.artist).name) || undefined,
      genre,
      year: releaseDate ? Number(releaseDate.slice(0, 4)) : undefined,
      trackNumber: positiveInteger(song.no),
      discNumber: /^\d+$/.test(String(song.cd)) ? positiveInteger(song.cd) : undefined
    },
    releaseDate,
    artwork: /^https?:\/\//i.test(imageUrl)
      ? {
          id: String(album.id ?? safeId),
          title: item.album ?? item.title,
          artist: item.artist,
          album: item.album ?? '',
          imageUrl: imageUrl.replace(/^http:/i, 'https:'),
          resource: {
            sourceId: 'netease',
            resourceType: 'album',
            resourceId: String(album.id ?? safeId)
          }
        }
      : undefined
  }
}
