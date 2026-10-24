import { t } from '../i18n'
import { assertMetadataFileWritable } from './metadataWriteGuard'
import fs from 'fs'
import sharp from 'sharp'
import NodeID3 from 'node-id3'
import { SongMetadata } from './metadataService'

export async function writeMp3Metadata(filePath: string, input: SongMetadata): Promise<boolean> {
  if (!fs.existsSync(filePath)) {
    throw new Error(t('fileMissing', { path: filePath }))
  }

  const tags: NodeID3.Tags = {}

  if (input.title) tags.title = input.title
  if (input.artist) tags.artist = input.artist
  if (input.album) tags.album = input.album
  if (input.year) tags.year = input.year.toString()
  if (input.genre !== undefined) tags.genre = input.genre.trim()

  if (input.trackNumber) tags.trackNumber = input.trackNumber.toString()

  if (input.discNumber) tags.partOfSet = input.discNumber.toString()

  if (input.albumArtist) tags.performerInfo = input.albumArtist

  if (input.composer) tags.composer = input.composer

  if (input.lyricist) tags.textWriter = input.lyricist

  if (input.lyrics) {
    tags.unsynchronisedLyrics = {
      language: 'eng',
      text: input.lyrics
    }
  }

  if (input.coverPath && fs.existsSync(input.coverPath)) {
    const imageBuffer = await normalizeCoverToBuffer(input.coverPath)

    tags.image = {
      mime: 'image/jpeg',
      type: {
        id: 3,
        name: 'front cover'
      },
      description: 'cover',
      imageBuffer
    }
  }

  assertMetadataFileWritable(filePath)
  const result = NodeID3.update(tags, filePath)
  if (result instanceof Error) throw result
  if (result === true && input.genre !== undefined && !input.genre.trim()) {
    await clearLegacyGenre(filePath)
  }
  return result === true
}

async function clearLegacyGenre(filePath: string): Promise<void> {
  // music-metadata falls back to ID3v1 when the ID3v2 genre is removed.
  const file = await fs.promises.open(filePath, 'r+')
  try {
    const { size } = await file.stat()
    if (size < 128) return
    const header = Buffer.alloc(3)
    await file.read(header, 0, 3, size - 128)
    if (header.toString('ascii') === 'TAG') {
      // 255 means unspecified; retain the title, artist and other ID3v1 fields.
      await file.write(Buffer.from([255]), 0, 1, size - 1)
    }
  } finally {
    await file.close()
  }
}

async function normalizeCoverToBuffer(coverPath: string): Promise<Buffer> {
  return await sharp(coverPath)
    .resize({ width: 1000, height: 1000, fit: 'inside' })
    .jpeg({ quality: 85 })
    .toBuffer()
}
