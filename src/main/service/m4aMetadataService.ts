import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { getFfmpegPath } from '../utils/ffmpegUtils'
import { SongMetadata } from './metadataService'
import { Logger } from './loggerService'
import sharp from 'sharp'

export async function writeM4aMetadata(filePath: string, input: SongMetadata): Promise<boolean> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`)
  }

  // Use os.tmpdir() + random names to avoid Unicode / long-path issues
  // on Windows when appending suffixes to the original path.
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'easy-player-m4a-'))
  const tmpFile = path.join(tmpDir, 'output.m4a')
  let tmpCoverPath: string | null = null

  try {
    const args: string[] = ['-i', filePath]

    if (input.coverPath && fs.existsSync(input.coverPath)) {
      const imageBuffer = await sharp(input.coverPath)
        .resize({ width: 1000, height: 1000, fit: 'inside' })
        .jpeg({ quality: 85 })
        .toBuffer()

      tmpCoverPath = path.join(tmpDir, 'cover.jpg')
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
    args.push('-y')
    args.push(tmpFile)

    // Run ffmpeg with a 2-minute timeout to prevent hanging
    await runFfmpeg(args)

    if (!fs.existsSync(tmpFile)) {
      throw new Error('ffmpeg did not produce an output file')
    }

    // Replace original with the remuxed file
    const originalBackup = filePath + '.bak'
    fs.renameSync(filePath, originalBackup)
    try {
      fs.copyFileSync(tmpFile, filePath)
      fs.unlinkSync(originalBackup)
    } catch (err) {
      // Restore original on failure
      try {
        if (fs.existsSync(originalBackup)) {
          fs.renameSync(originalBackup, filePath)
        }
      } catch {
        // ignore restore failure
      }
      throw err
    }

    return true
  } finally {
    // Always clean up temp directory
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    } catch {
      // ignore cleanup failures
    }
  }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = execFile(
      getFfmpegPath(),
      args,
      { timeout: 120_000 },
      (err, _stdout, stderr) => {
        if (err) {
          Logger.error(
            'M4A Metadata Service: ffmpeg error:',
            err.message,
            'stderr:',
            stderr?.slice(-500) || ''
          )
          return reject(err)
        }
        resolve()
      }
    )

    // Defensive: ensure the process is killed if the outer promise is rejected
    // (e.g. due to timeout) so we never leave a zombie ffmpeg.
    child.on('error', (err) => {
      Logger.error('M4A Metadata Service: ffmpeg spawn error:', err.message)
    })
  })
}
