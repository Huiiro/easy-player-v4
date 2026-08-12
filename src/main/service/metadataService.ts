import path from 'path'
import { parseFile } from 'music-metadata'
import { writeMp3Metadata } from './mp3MetadataService'
import { Logger } from './loggerService'
import { writeNativeMetadata } from '../audioEngine'

export interface SongMetadata {
  // 基础信息
  title?: string
  artist?: string
  artists?: string[]
  album?: string
  albumArtist?: string

  // 编号信息
  trackNumber?: number | null
  trackTotal?: number | null
  discNumber?: number | null
  discTotal?: number | null

  // 分类
  genre?: string
  year?: number

  // 创作信息
  composer?: string
  lyricist?: string

  // 内容
  lyrics?: string
  comment?: string | null

  // 封面
  cover?: Buffer | null
  coverPath?: string
  coverDataUrl?: string
  coverMimeType?: string

  // 技术参数
  duration?: number
  bitrate?: number
  sampleRate?: number
  bitsPerSample?: number
  channels?: number
  codec?: string
  container?: string
}

export async function writeMetadata(
  filePath: string,
  fileType: string,
  input: SongMetadata
): Promise<boolean> {
  if (fileType in ['MPEG', 'FLAC', 'M4A', 'AAC', 'UNKNOWN']) {
    return dispatchMetadata(filePath, fileType, input)
  }
  const metadata = await parseFile(filePath).catch(() => null)
  const codec = metadata?.format.codec || ''
  const audioType = getAudioType(filePath, codec)
  return dispatchMetadata(filePath, audioType, input)
}

export async function readMetadata(filePath: string): Promise<SongMetadata> {
  let metadata
  try {
    metadata = await parseFile(filePath)
  } catch (err) {
    Logger.error('MetadataService: parse Metadata fail: ', err)
    const ext = filePath.split('.').pop()?.toLowerCase()
    if (ext === 'm4a' || ext === 'aac') {
      if (!writeNativeMetadata(filePath, {})) throw err
      metadata = await parseFile(filePath)
    } else {
      Logger.error('MetadataService: parse Metadata fail: Unsupported file extension.')
      throw err
    }
  }
  const picture = metadata.common.picture?.[0]

  return {
    title: metadata.common.title,
    artist: metadata.common.artist,
    artists: metadata.common.artists,
    album: metadata.common.album,
    albumArtist: metadata.common.albumartist,

    trackNumber: metadata.common.track?.no,
    trackTotal: metadata.common.track?.of,
    discNumber: metadata.common.disk?.no,
    discTotal: metadata.common.disk?.of,

    genre: metadata.common.genre?.[0],
    year: metadata.common.year,

    composer: metadata.common.composer?.[0],
    lyricist: metadata.common.lyricist?.[0],

    lyrics: getRawLyricsWithTimestamp(metadata),

    duration: metadata.format.duration,
    bitrate: metadata.format.bitrate,
    sampleRate: metadata.format.sampleRate,
    bitsPerSample: metadata.format.bitsPerSample,
    channels: metadata.format.numberOfChannels,
    codec: metadata.format.codec,
    container: metadata.format.container,

    cover: picture?.data ?? null,
    coverMimeType: picture?.format
  }
}

function getAudioType(
  filePath: string,
  codec?: string
): 'MPEG' | 'FLAC' | 'M4A' | 'AAC' | 'UNKNOWN' {
  if (codec) {
    if (codec.toLowerCase() === 'mp3') return 'MPEG'
    if (codec.toLowerCase() === 'flac') return 'FLAC'
    if (codec.toLowerCase() === 'm4a') return 'M4A'
    if (codec.toLowerCase() === 'aac') return 'AAC'
  }

  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.mp3') return 'MPEG'
  if (ext === '.flac') return 'FLAC'
  if (ext === '.m4a') return 'M4A'
  if (ext === '.aac') return 'AAC'

  return 'UNKNOWN'
}

function getRawLyricsWithTimestamp(meta: any): string {
  return (
    meta.native['ID3v2.3']?.find((tag) => tag.id === 'USLT')?.value?.text ||
    meta.native['ID3v2.4']?.find((tag) => tag.id === 'USLT')?.value?.text ||
    meta.native['vorbis']?.find((tag) => tag.id.toUpperCase() === 'LYRICS')?.value ||
    meta.native['vorbis']?.find((tag) => tag.id.toUpperCase() === 'UNSYNCEDLYRICS')?.value ||
    meta.common.lyrics?.[0]?.text || // fallback
    ''
  )
}

async function dispatchMetadata(
  filePath: string,
  format: string,
  input: SongMetadata
): Promise<boolean> {
  try {
    if (format === 'FLAC' || format === 'M4A' || format === 'AAC') {
      return writeNativeMetadata(filePath, input)
    }
    if (format === 'MPEG') {
      return await writeMp3Metadata(filePath, input)
    }
    return false
  } catch (err) {
    Logger.error(
      `MetadataService: file: ${filePath}, format: ${format}, dispatchMetadata fail: ${err}`
    )
    return false
  }
}
