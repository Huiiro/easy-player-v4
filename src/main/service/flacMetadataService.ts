import path from 'path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { SongMetadata } from './metadataService'
import fs from 'fs'
import sharp from 'sharp'

const execFileAsync = promisify(execFile)

export async function writeFlacMetadata(filePath: string, input: SongMetadata): Promise<boolean> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File dose not exist, ${filePath}`)
  }

  const metaflac = getMetaflacPath()

  const tagMap: Record<string, string | undefined> = {
    TITLE: input.title,
    ARTIST: input.artist,
    ALBUM: input.album,
    DATE: input.year?.toString(),
    GENRE: Array.isArray(input.genre) ? input.genre.join('; ') : input.genre,
    TRACKNUMBER: input.trackNumber?.toString(),
    DISCNUMBER: input.discNumber?.toString(),
    ALBUMARTIST: input.albumArtist,
    COMPOSER: input.composer,
    LYRICIST: input.lyricist,
    LYRICS: input.lyrics
  }

  const removeArgs: string[] = []

  for (const key in tagMap) {
    if (tagMap[key] !== undefined) {
      removeArgs.push(`--remove-tag=${key}`)
    }
  }

  if (removeArgs.length > 0) {
    await execFileAsync(metaflac, [...removeArgs, filePath])
  }

  const setArgs: string[] = []

  for (const key in tagMap) {
    const value = tagMap[key]
    if (value !== undefined && value !== '') {
      setArgs.push(`--set-tag=${key}=${value}`)
    }
  }

  if (setArgs.length > 0) {
    await execFileAsync(metaflac, [...setArgs, filePath])
  }

  if (input.coverPath && fs.existsSync(input.coverPath)) {
    const normalizedPath = await normalizeCover(input.coverPath)

    try {
      const metadata = await sharp(normalizedPath).metadata()

      const width = metadata.width || 0
      const height = metadata.height || 0
      const depth = 24
      const colors = 0

      await execFileAsync(metaflac, ['--remove', '--block-type=PICTURE', filePath])
      const pictureSpec = `3|image/jpeg||${width}x${height}x${depth}/${colors}|${normalizedPath}`
      await execFileAsync(metaflac, [`--import-picture-from=${pictureSpec}`, filePath])
    } finally {
      if (fs.existsSync(normalizedPath)) {
        fs.unlinkSync(normalizedPath)
      }
    }
  }
  return true
}

export async function normalizeCover(coverPath: string): Promise<string> {
  const tempPath = path.join(process.cwd(), `temp_cover_${Date.now()}.jpg`)

  await sharp(coverPath)
    .resize({ width: 1000, height: 1000, fit: 'inside' })
    .jpeg({ quality: 85 })
    .toFile(tempPath)

  return tempPath
}

function getMetaflacPath(): string {
  if (process.env.NODE_ENV !== 'production') {
    return path.join(process.cwd(), 'resources/bin/win/Win64/metaflac.exe')
  }

  if (process.platform === 'win32') {
    if (process.arch === 'x64') {
      return path.join(process.resourcesPath, 'bin/win/Win64/metaflac.exe')
    } else {
      return path.join(process.resourcesPath, 'bin/win/Win32/metaflac.exe')
    }
  }

  if (process.platform === 'darwin') {
    return path.join(process.resourcesPath, 'bin/mac/metaflac')
  }

  throw new Error('Read Metaflac fail, Unsupported platform.')
}
