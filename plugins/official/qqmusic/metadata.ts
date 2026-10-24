import type { SourceTrackSummary, SourceTrackDetail } from '../../../src/shared/sourceMetadata'
import type { MetadataQuery, ArtworkCandidate } from '../../../src/shared/networkSources'
import type { SourceCallContext } from '../../../src/main/sources/types'
import { SourceCallError } from '../../../src/main/sources/errors'
import { joinMetadataValues } from '../../../src/shared/metadataValues'
import { normalizeSourceGenreNames } from '../../shared/genreNormalization'
import {
  record,
  text,
  songTitle,
  singerNames,
  positiveInteger,
  validateMid,
  searchQQSongs,
  fetchQQTrack,
  qqRpc,
  albumCover,
  type QQRecord
} from './shared'

function summary(song: QQRecord): SourceTrackSummary {
  const title = songTitle(song)
  if (!title) throw new SourceCallError('INVALID_RESPONSE', 'qqmusic')
  return {
    resource: {
      sourceId: 'qqmusic',
      resourceType: 'track',
      resourceId: validateMid(song.mid ?? song.songmid)
    },
    title,
    artist: singerNames(song.singer),
    album: text(record(song.album).name) || text(song.albumname) || undefined,
    durationMs: positiveInteger(song.interval) ? Number(song.interval) * 1000 : undefined
  }
}
async function searchSongs(query: string, context?: SourceCallContext): Promise<QQRecord[]> {
  const songs = await searchQQSongs(query, context, 20)
  context?.signal.throwIfAborted()
  return songs
    .flatMap((value) => {
      const song = record(value)
      return [song, ...(Array.isArray(song.grp) ? song.grp.map(record) : [])]
    })
    .slice(0, 60)
}
export async function searchQQMusicTracks(
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
function releaseDate(value: unknown): string | undefined {
  const date = text(value).match(/^\d{4}-\d{2}-\d{2}(?=$|[ T])/)?.[0]
  if (!date || Number(date.slice(0, 4)) < 1000) return undefined
  const parsed = new Date(date + 'T00:00:00Z')
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : undefined
}
export async function getQQMusicTrack(
  mid: string,
  context?: SourceCallContext
): Promise<SourceTrackDetail> {
  const data = await fetchQQTrack(mid, context)
  const song = record(data.track_info),
    album = record(song.album),
    info = record(data.info)
  const item = summary(song)
  let albumDetail: QQRecord = {}
  const albumMid = text(album.mid)
  if (/^[a-zA-Z0-9]{14}$/.test(albumMid)) {
    // Album artist is optional; never substitute a different album or the track singer.
    try {
      const result = await qqRpc(
        'music.musichallAlbum.AlbumInfoServer',
        'GetAlbumDetail',
        { albumMId: albumMid },
        context
      )
      if (record(result.basicInfo).albumMid === albumMid) albumDetail = result
    } catch {
      context?.signal.throwIfAborted()
    }
  }
  context?.signal.throwIfAborted()
  const pubInfo = record(info.pub_time).content
  const published =
    releaseDate(song.time_public) ||
    releaseDate(album.time_public) ||
    (Array.isArray(pubInfo)
      ? pubInfo.map((entry) => releaseDate(record(entry).value)).find(Boolean)
      : undefined) ||
    releaseDate(record(albumDetail.basicInfo).publishDate)
  const genreInfo = record(info.genre).content
  // Numeric song.genre is a platform enum; only the explicit song-genre labels are portable.
  const genre = Array.isArray(genreInfo)
    ? joinMetadataValues(
        normalizeSourceGenreNames(genreInfo.map((entry) => text(record(entry).value)))
      )
    : undefined
  const imageUrl = albumCover(album)
  const discIndex = song.index_cd
  const discNumber =
    (typeof discIndex === 'number' || (typeof discIndex === 'string' && /^\d+$/.test(discIndex))) &&
    Number.isSafeInteger(Number(discIndex)) &&
    Number(discIndex) >= 0 &&
    Number(discIndex) < Number.MAX_SAFE_INTEGER
      ? Number(discIndex) + 1
      : undefined
  return {
    ...item,
    releaseDate: published,
    metadata: {
      title: item.title,
      artist: item.artist || undefined,
      album: item.album,
      albumArtist: singerNames(record(albumDetail.singer).singerList) || undefined,
      genre,
      year: published ? Number(published.slice(0, 4)) : undefined,
      trackNumber: positiveInteger(song.index_album),
      discNumber
    },
    artwork: imageUrl
      ? {
          id: albumMid,
          resource: { sourceId: 'qqmusic', resourceType: 'album', resourceId: albumMid },
          title: item.album ?? item.title,
          artist: item.artist,
          album: item.album ?? '',
          imageUrl
        }
      : undefined
  }
}
export async function searchQQMusicArtwork(
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
        const item = summary(song),
          album = record(song.album)
        const imageUrl = albumCover({ ...album, mid: album.mid ?? song.albummid })
        if (!imageUrl || seen.has(imageUrl)) return []
        seen.add(imageUrl)
        const albumMid = text(album.mid) || text(song.albummid)
        return [
          {
            id: albumMid,
            resource: { sourceId: 'qqmusic', resourceType: 'album', resourceId: albumMid },
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
