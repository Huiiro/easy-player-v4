import { t } from '../i18n'
import { assertMetadataFileWritable } from './metadataWriteGuard'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import sharp from 'sharp'
import { getSong } from '../database/repository'
import { getDatabase } from '../database'
import { getDataPath } from '../utils/pathUtils'
import { readMetadata, writeMetadata, type SongMetadata } from './metadataService'
import {
  SOURCE_METADATA_FIELDS,
  type SourceMetadataPatch,
  type SourceMetadataSnapshot,
  type ApplySourceMetadataRequest
} from '../../shared/sourceMetadata'

const writers = new Map<number, Promise<unknown>>()
async function withWriteLock<T>(id: number, action: () => Promise<T>): Promise<T> {
  const previous = writers.get(id) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(action)
  writers.set(id, current)
  try {
    return await current
  } finally {
    if (writers.get(id) === current) writers.delete(id)
  }
}
async function saveCoverDataUrl(dataUrl: string): Promise<string> {
  const match = /^data:image\/(?:jpeg|jpg|png|webp|gif);base64,([a-z0-9+/=]+)$/i.exec(dataUrl)
  if (!match || dataUrl.length > 28_000_000) throw new Error(t('invalidCoverData'))
  const buffer = await sharp(Buffer.from(match[1], 'base64'), { limitInputPixels: 40_000_000 })
    .rotate()
    .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 90 })
    .toBuffer()
  const directory = join(getDataPath(), 'covers')
  mkdirSync(directory, { recursive: true })
  const file = join(directory, 'metadata-' + randomUUID() + '.jpg')
  writeFileSync(file, buffer)
  return file
}

export async function writeSongMetadata(
  songId: number,
  input: SongMetadata
): Promise<{ success: boolean; error?: string }> {
  return withWriteLock(songId, () => writeSongMetadataUnlocked(songId, { ...input }))
}
async function writeSongMetadataUnlocked(
  songId: number,
  metadata: SongMetadata
): Promise<{ success: boolean; error?: string }> {
  if (!Number.isInteger(songId)) {
    return { success: false, error: t('invalidSongId') }
  }
  const song = getSong(songId)
  if (!song || !existsSync(song.audio)) {
    return { success: false, error: t('songFileNotFound') }
  }
  if (song.sourceId) {
    return { success: false, error: t('remoteUnsupported') }
  }

  assertMetadataFileWritable(song.audio)
  const temporaryCover = metadata.coverDataUrl
    ? await saveCoverDataUrl(metadata.coverDataUrl)
    : null
  if (temporaryCover) metadata.coverPath = temporaryCover
  let result: boolean
  try {
    // Cover conversion can yield while the user starts playing this file.
    assertMetadataFileWritable(song.audio)
    result = await writeMetadata(song.audio, song.format || '', metadata)
  } finally {
    if (temporaryCover && existsSync(temporaryCover)) unlinkSync(temporaryCover)
  }
  if (!result) return { success: false, error: t('metadataWriteFailed') }

  // Re-read file to sync database with updated metadata
  const updatedMeta = await readMetadata(song.audio)
  const db = getDatabase()

  const updates: string[] = []
  const values: unknown[] = []

  if ('title' in metadata && updatedMeta.title !== undefined && updatedMeta.title !== song.title) {
    updates.push('title = ?')
    values.push(updatedMeta.title)
  }
  if (
    'artist' in metadata &&
    updatedMeta.artist !== undefined &&
    updatedMeta.artist !== song.artist
  ) {
    updates.push('artist = ?')
    values.push(updatedMeta.artist)
  }
  if ('album' in metadata && updatedMeta.album !== undefined && updatedMeta.album !== song.album) {
    updates.push('album = ?')
    values.push(updatedMeta.album)
  }
  if ('year' in metadata && updatedMeta.year !== undefined && updatedMeta.year !== song.year) {
    updates.push('year = ?')
    values.push(updatedMeta.year)
  }
  if ('genre' in metadata && (updatedMeta.genre || null) !== song.genre) {
    updates.push('genre = ?')
    values.push(updatedMeta.genre || null)
  }

  for (const [field, column] of [
    ['trackNumber', 'track_no'],
    ['discNumber', 'disk_no']
  ] as const) {
    if (field in metadata) {
      updates.push(column + ' = ?')
      values.push(updatedMeta[field] ?? null)
    }
  }
  if ('lyrics' in metadata) {
    updates.push(
      'lrc = ?',
      'lyric_format = NULL',
      'translation = NULL',
      'translation_format = NULL',
      'romanization = NULL',
      'romanization_format = NULL'
    )
    values.push(updatedMeta.lyrics || null)
  }
  // Handle cover art: if metadata was written with a cover, re-read and extract it
  if (metadata.coverPath || metadata.cover) {
    const picture = updatedMeta.cover
    if (picture) {
      const uuid = randomUUID()
      const coverDir = join(getDataPath(), 'covers')
      const coverPath = join(coverDir, `${uuid}.jpg`)
      mkdirSync(coverDir, { recursive: true })
      writeFileSync(coverPath, picture)

      updates.push(
        'cover = ?',
        'cover_analysis_path = NULL',
        'cover_primary = NULL',
        'cover_secondary = NULL',
        'cover_lyrics_dark = NULL',
        'cover_analysis_version = NULL'
      )
      values.push(coverPath)
    }
  }

  if (updates.length)
    db.prepare('UPDATE song SET ' + updates.join(', ') + ' WHERE id = ?').run(...values, songId)

  return { success: true }
}

export function validateSourcePatch(input: SourceMetadataPatch): SourceMetadataPatch {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error(t('sourceMetadataInvalid'))
  const allowed: readonly string[] = [...SOURCE_METADATA_FIELDS, 'lyrics', 'coverDataUrl']
  const patch: Record<string, string | number> = {}
  for (const [key, value] of Object.entries(input)) {
    if (!allowed.includes(key)) throw new Error(t('sourceMetadataInvalid'))
    if (['year', 'trackNumber', 'discNumber'].includes(key)) {
      if (
        typeof value !== 'number' ||
        !Number.isSafeInteger(value) ||
        value <= 0 ||
        (key === 'year' && (value < 1000 || value > 9999))
      )
        throw new Error(t('sourceMetadataInvalid'))
    } else if (
      typeof value !== 'string' ||
      !value.trim() ||
      value.length > (key === 'coverDataUrl' ? 28_000_000 : key === 'lyrics' ? 1_000_000 : 10_000)
    )
      throw new Error(t('sourceMetadataInvalid'))
    patch[key] = value
  }
  if (!Object.keys(patch).length) throw new Error(t('sourceMetadataEmpty'))
  return patch as SourceMetadataPatch
}

export async function getSourceMetadataSnapshot(songId: number): Promise<SourceMetadataSnapshot> {
  if (!Number.isInteger(songId)) throw new Error(t('sourceMetadataInvalid'))
  const song = getSong(songId)
  if (!song || !existsSync(song.audio)) throw new Error(t('songFileNotFound'))
  if (song.sourceId) throw new Error(t('remoteUnsupported'))
  const file = await readMetadata(song.audio)
  const metadata: SourceMetadataPatch = Object.fromEntries(
    [...SOURCE_METADATA_FIELDS, 'lyrics' as const].map((key) => [key, file[key] ?? undefined])
  )
  const hasCover = Boolean(file.cover?.length)
  const stat = statSync(song.audio)
  const fileVersion = [
    song.audio,
    stat.size,
    stat.mtimeMs,
    file.cover ? createHash('sha256').update(file.cover).digest('hex') : null
  ]
  const revision = createHash('sha256')
    .update(JSON.stringify({ metadata, hasCover, fileVersion }))
    .digest('hex')
  return { metadata, hasCover, revision }
}

export async function applySourceMetadata(
  request: ApplySourceMetadataRequest
): Promise<{ success: boolean; error?: string }> {
  if (!request || !Number.isInteger(request.songId)) throw new Error(t('sourceMetadataInvalid'))
  const patch = validateSourcePatch(request.patch)
  return withWriteLock(request.songId, async () => {
    const snapshot = await getSourceMetadataSnapshot(request.songId)
    if (!request.expectedRevision || request.expectedRevision !== snapshot.revision)
      throw new Error(t('sourceMetadataConflict'))
    return writeSongMetadataUnlocked(request.songId, { ...patch })
  })
}

/** Read the file tags used by both the editor and subsequent reloads. */
export async function readSongMetadataForEditing(songId: number): Promise<SongMetadata> {
  const song = getSong(songId)
  if (!song || !existsSync(song.audio)) throw new Error(t('songFileNotFound'))
  if (song.sourceId) throw new Error(t('remoteUnsupported'))
  return readMetadata(song.audio)
}

export async function reloadSongMetadata(songId: number): Promise<void> {
  return withWriteLock(songId, async () => {
    const song = getSong(songId)
    if (!song || !existsSync(song.audio)) throw new Error(t('songFileNotFound'))
    if (song.sourceId) throw new Error(t('remoteUnsupported'))
    const metadata = await readMetadata(song.audio)
    let cover: string | null = null
    if (metadata.cover) {
      const directory = join(getDataPath(), 'covers')
      mkdirSync(directory, { recursive: true })
      cover = join(directory, randomUUID() + '.jpg')
      writeFileSync(cover, metadata.cover)
    }
    const fileName = basename(song.audio, extname(song.audio))
    const values = {
      title: metadata.title || fileName,
      artist: metadata.artist || null,
      album: metadata.album || null,
      year: metadata.year ?? null,
      genre: metadata.genre || null,
      cover,
      track_no: metadata.trackNumber ?? null,
      disk_no: metadata.discNumber ?? null,
      duration: Math.floor(metadata.duration || 0),
      bitrate: metadata.bitrate ? Math.round(metadata.bitrate / 1000) : null,
      sample_rate: metadata.sampleRate ?? null,
      bit_depth: metadata.bitsPerSample ?? null,
      channels: metadata.channels ?? null,
      format: metadata.container || metadata.codec || extname(song.audio).slice(1) || null,
      file_name: fileName,
      file_size: statSync(song.audio).size,
      song_status: 1
    }
    const columns = Object.keys(values)
    getDatabase()
      .prepare(
        'UPDATE song SET ' + columns.map((column) => column + ' = ?').join(', ') + ' WHERE id = ?'
      )
      .run(...Object.values(values), songId)
  })
}
