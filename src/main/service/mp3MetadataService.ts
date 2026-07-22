import fs from 'fs'
import sharp from 'sharp'
import NodeID3 from 'node-id3'
import { SongMetadata } from './metadataService'

export async function writeMp3Metadata(filePath: string, input: SongMetadata): Promise<boolean> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File dose not exist, ${filePath}`)
  }

  const tags: NodeID3.Tags = {}

  if (input.title) tags.title = input.title
  if (input.artist) tags.artist = input.artist
  if (input.album) tags.album = input.album
  if (input.year) tags.year = input.year.toString()
  if (input.genre) tags.genre = Array.isArray(input.genre) ? input.genre.join('; ') : input.genre

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

  NodeID3.update(tags, filePath)

  return true
}

async function normalizeCoverToBuffer(coverPath: string): Promise<Buffer> {
  return await sharp(coverPath)
    .resize({ width: 1000, height: 1000, fit: 'inside' })
    .jpeg({ quality: 85 })
    .toBuffer()
}
