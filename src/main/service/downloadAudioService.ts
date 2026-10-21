import { promises as fs } from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import { parseFile } from 'music-metadata'
import { writeNativeMetadata } from '../audioEngine'
import { requireBackgroundWork } from './playbackMode'
import { Logger } from './loggerService'
import { logError } from './operationLogger'

/** Finalize a staged M4A before the downloader publishes it. No audio re-encoding. */
export async function finalizeDownloadedAudio(
  filePath: string,
  tags: { title: string; artist?: string },
  coverData?: Buffer
): Promise<void> {
  const coverPath = path.join(path.dirname(filePath), 'cover.jpg')
  let written = false
  try {
    if (coverData) {
      try {
        await sharp(coverData)
          .rotate()
          .resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 90 })
          .toFile(coverPath)
        requireBackgroundWork()
        written = writeNativeMetadata(filePath, { ...tags, coverPath })
        if (!written) throw new Error('Native cover writer unavailable')
      } catch (error) {
        Logger.warn(
          '[Download] cover embedding failed; retrying audio without cover',
          { filePath },
          logError(error)
        )
      }
    }
    if (!written) {
      requireBackgroundWork()
      if (!writeNativeMetadata(filePath, tags))
        throw new Error('Unable to finalize downloaded audio')
    }
    // Deliberately use the plain parser: completed downloads must no longer need the DASH fallback.
    const metadata = await parseFile(filePath, { duration: true })
    if (metadata.format.hasAudio === false || !metadata.format.duration) {
      throw new Error('Finalized download has no readable audio duration')
    }
    Logger.info('[Download] audio finalized', {
      filePath,
      duration: metadata.format.duration,
      coverEmbedded: Boolean(metadata.common.picture?.length)
    })
  } finally {
    await fs.rm(coverPath, { force: true })
  }
}
