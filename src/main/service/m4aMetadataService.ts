import fs from 'fs'
import { execFile } from 'child_process'
import { getFfmpegPath } from '../utils/ffmpegUtils'
import { SongMetadata } from './metadataService'
import sharp from 'sharp'

export async function writeM4aMetadata(filePath: string, input: SongMetadata): Promise<boolean> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File dose not exist, ${filePath}`)
  }

  const tmpFile = filePath + '.tmp.m4a'
  const args: string[] = ['-i', filePath]

  let tmpCoverPath: string | null = null

  if (input.coverPath && fs.existsSync(input.coverPath)) {
    const imageBuffer = await sharp(input.coverPath)
      .resize({ width: 1000, height: 1000, fit: 'inside' })
      .jpeg({ quality: 85 })
      .toBuffer()

    tmpCoverPath = filePath + '_cover.jpg'
    fs.writeFileSync(tmpCoverPath, imageBuffer)

    args.push('-i', tmpCoverPath)
  }

  args.push('-map', '0:a')

  if (tmpCoverPath) {
    args.push('-map', '1')
    args.push('-disposition:v:0', 'attached_pic')
  }

  if (input.title) args.push('-metadata', `title=${input.title}`)
  if (input.artist) args.push('-metadata', `artist=${input.artist}`)
  if (input.album) args.push('-metadata', `album=${input.album}`)
  if (input.albumArtist) args.push('-metadata', `album_artist=${input.albumArtist}`)
  if (input.year) args.push('-metadata', `date=${input.year}`)
  if (input.genre) {
    args.push(
      '-metadata',
      `genre=${Array.isArray(input.genre) ? input.genre.join('; ') : input.genre}`
    )
  }
  if (input.trackNumber) args.push('-metadata', `track=${input.trackNumber}`)
  if (input.discNumber) args.push('-metadata', `disc=${input.discNumber}`)
  if (input.composer) args.push('-metadata', `composer=${input.composer}`)
  if (input.lyricist) args.push('-metadata', `writer=${input.lyricist}`)
  if (input.lyrics) args.push('-metadata', `lyrics=${input.lyrics}`)

  args.push('-c', 'copy')
  args.push(tmpFile)

  // 执行 ffmpeg
  await new Promise<void>((resolve, reject) => {
    execFile(getFfmpegPath(), args, (err) => {
      if (err) return reject(err)
      resolve()
    })
  })

  fs.renameSync(tmpFile, filePath)

  if (tmpCoverPath && fs.existsSync(tmpCoverPath)) {
    fs.unlinkSync(tmpCoverPath)
  }

  return true
}
