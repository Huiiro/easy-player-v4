import { joinMetadataValues } from '../../../src/shared/metadataValues'
import type { SourceTrackDetail, SourceTrackSummary } from '../../../src/shared/sourceMetadata'
import type { ArtworkCandidate, MetadataQuery } from '../../../src/shared/networkSources'
import type { SourceCallContext } from '../../../src/main/sources/types'
import { SourceCallError } from '../../../src/main/sources/errors'
import {
  normalizeSourceGenreName,
  normalizeSourceGenreNames
} from '../../shared/genreNormalization'
import { requireBackgroundWork } from '../../../src/main/service/playbackMode'
import {
  KUGOU_PUBLIC_COOKIE,
  record,
  text,
  positiveInteger,
  trackId,
  trackTitle,
  artistNames,
  bodyOf,
  fetchKugouTrack,
  coverUrl,
  type KugouRecord
} from './shared'

function summary(song: KugouRecord): SourceTrackSummary {
  const title = trackTitle(song)
  if (!title) throw new SourceCallError('INVALID_RESPONSE', 'kugou')
  return {
    resource: { sourceId: 'kugou', resourceType: 'track', resourceId: trackId(song.MixSongID) },
    title,
    artist: artistNames(song.Singers) || text(song.SingerName),
    album: text(song.AlbumName) || undefined,
    durationMs: positiveInteger(song.Duration) ? Number(song.Duration) * 1000 : undefined
  }
}
async function searchSongs(query: string, context?: SourceCallContext): Promise<KugouRecord[]> {
  context?.signal.throwIfAborted()
  requireBackgroundWork()
  if (!query.trim()) return []
  const { default: api } = await import('kugoumusicapi')
  context?.signal.throwIfAborted()
  const body = bodyOf(
    await api.search({
      keywords: query.trim(),
      type: 'song',
      pagesize: 20,
      page: 1,
      cookie: KUGOU_PUBLIC_COOKIE
    })
  )
  context?.signal.throwIfAborted()
  requireBackgroundWork()
  const songs = record(body.data).lists
  if (!Array.isArray(songs)) throw new SourceCallError('INVALID_RESPONSE', 'kugou')
  return songs
    .flatMap((entry) => {
      const song = record(entry)
      return [song, ...(Array.isArray(song.Grp) ? song.Grp.map(record) : [])]
    })
    .slice(0, 60)
}
export async function searchKugouTracks(
  query: string,
  context?: SourceCallContext
): Promise<SourceTrackSummary[]> {
  const songs = await searchSongs(query, context)
  const seen = new Set<string>()
  return songs.flatMap((song) => {
    try {
      const item = summary(song)
      if (seen.has(item.resource.resourceId)) return []
      seen.add(item.resource.resourceId)
      return [item]
    } catch {
      return []
    }
  })
}

/** Only descendants of Kugou's music-style root (3), never language/mood/business tags. */
function genres(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const tags = value
    .map(record)
    .filter(
      (tag) =>
        text(tag.name) &&
        positiveInteger(tag.id) &&
        positiveInteger(tag.pid) &&
        Number(tag.is_publish ?? 1) === 1
    )
  function path(tag: KugouRecord, seen = new Set<KugouRecord>()): KugouRecord[] | undefined {
    if (seen.has(tag) || seen.size >= 12) return undefined
    if (Number(tag.pid) === 3) return [tag]
    const nextSeen = new Set([...seen, tag])
    for (const parent of tags.filter((entry) => String(entry.id) === String(tag.pid))) {
      const ancestors = path(parent, nextSeen)
      if (ancestors) return [...ancestors, tag]
    }
    return undefined
  }
  const paths = tags.map((tag) => path(tag)).filter((item): item is KugouRecord[] => !!item)
  const leaves = paths.filter(
    (branch) =>
      !paths.some(
        (other) => other.length > branch.length && branch.every((tag, i) => tag === other[i])
      )
  )
  const aliases: Record<string, string> = {
    国语流行: 'Cpop',
    日语流行: 'Jpop',
    '当代R&B类 Contemporary R&B': 'Contemporary R&B'
  }
  return joinMetadataValues(
    normalizeSourceGenreNames(
      leaves.map((branch) => {
        const names = branch.map((tag) =>
          normalizeSourceGenreName(aliases[text(tag.name)] ?? text(tag.name))
        )
        return names.filter((name, i) => name !== names[i - 1]).join('-')
      })
    )
  )
}
function releaseDate(value: unknown): string | undefined {
  const date = text(value).match(/^\d{4}-\d{2}-\d{2}(?=$|[ T])/)?.[0]
  if (!date || Number(date.slice(0, 4)) < 1000) return undefined
  const parsed = new Date(date + 'T00:00:00Z')
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : undefined
}
export async function getKugouTrack(
  id: string,
  context?: SourceCallContext
): Promise<SourceTrackDetail> {
  context?.signal.throwIfAborted()
  requireBackgroundWork()
  const song = await fetchKugouTrack(id, context)
  const base = record(song.base),
    album = record(song.album_info),
    audio = record(song.audio_info),
    extra = record(song.extra)
  const albumId = positiveInteger(base.album_id ?? album.album_id)
  let albumDetail: KugouRecord = {}
  if (albumId) {
    // Album artist and artwork are optional enrichments; retain exact-track metadata on failure.
    try {
      context?.signal.throwIfAborted()
      requireBackgroundWork()
      const { default: api } = await import('kugoumusicapi')
      context?.signal.throwIfAborted()
      const body = bodyOf(
        await api.album_detail({ id: String(albumId), cookie: KUGOU_PUBLIC_COOKIE })
      )
      if (Array.isArray(body.data))
        albumDetail =
          body.data.map(record).find((entry) => String(entry.album_id) === String(albumId)) ?? {}
    } catch {
      context?.signal.throwIfAborted()
    }
  }
  context?.signal.throwIfAborted()
  requireBackgroundWork()
  const title = trackTitle(song)
  if (!title) throw new SourceCallError('INVALID_RESPONSE', 'kugou')
  const artist = text(base.author_name) || artistNames(song.authors)
  const albumName =
    text(base.album_name) || text(album.album_name) || text(albumDetail.album_name) || undefined
  const published =
    releaseDate(base.publish_date) ||
    releaseDate(album.publish_date) ||
    releaseDate(albumDetail.publish_date)
  const imageUrl = coverUrl(album.cover) || coverUrl(albumDetail.sizable_cover)
  return {
    resource: { sourceId: 'kugou', resourceType: 'track', resourceId: trackId(id) },
    title,
    artist,
    album: albumName,
    durationMs: positiveInteger(audio.timelength),
    releaseDate: published,
    metadata: {
      title,
      artist: artist || undefined,
      album: albumName,
      albumArtist: text(albumDetail.author_name) || artistNames(albumDetail.authors) || undefined,
      genre: genres(song.tags),
      year: published ? Number(published.slice(0, 4)) : undefined,
      trackNumber: positiveInteger(extra.sort),
      discNumber: positiveInteger(extra.disc)
    },
    artwork: imageUrl
      ? {
          id: String(albumId ?? id),
          resource: {
            sourceId: 'kugou',
            resourceType: albumId ? 'album' : 'track',
            resourceId: String(albumId ?? id)
          },
          title: albumName ?? title,
          artist,
          album: albumName ?? '',
          imageUrl
        }
      : undefined
  }
}
export async function searchKugouArtwork(
  query: MetadataQuery,
  context?: SourceCallContext
): Promise<ArtworkCandidate[]> {
  const songs = await searchSongs(
    [query.title, query.artist, query.album].filter(Boolean).join(' '),
    context
  )
  const seen = new Set<string>()
  return songs
    .flatMap((song): ArtworkCandidate[] => {
      try {
        const item = summary(song)
        const imageUrl =
          coverUrl(song.AlbumImage) ||
          coverUrl(song.Image) ||
          coverUrl(record(song.trans_param).union_cover)
        if (!imageUrl || seen.has(imageUrl)) return []
        const albumId = positiveInteger(song.AlbumID)
        seen.add(imageUrl)
        return [
          {
            id: String(albumId ?? item.resource.resourceId),
            resource: {
              sourceId: 'kugou',
              resourceType: albumId ? 'album' : 'track',
              resourceId: String(albumId ?? item.resource.resourceId)
            },
            title: item.album ?? item.title,
            artist: item.artist,
            album: item.album ?? '',
            imageUrl
          }
        ]
      } catch {
        return []
      }
    })
    .slice(0, 12)
}
