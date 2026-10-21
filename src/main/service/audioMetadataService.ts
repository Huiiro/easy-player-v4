import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { parseFile } from 'music-metadata'
import { writeNativeMetadata } from '../audioEngine'
import { Logger } from './loggerService'
import { logError } from './operationLogger'

/** Read DASH audio that music-metadata cannot parse without changing the source file. */
export async function parseAudioFile(
  filePath: string,
  options?: Parameters<typeof parseFile>[1]
): ReturnType<typeof parseFile> {
  try {
    return await parseFile(filePath, options)
  } catch (error) {
    // Fragment defaults may live in moov/mvex/trex, which the JS parser ignores.
    if (
      !['.m4a', '.mp4'].includes(path.extname(filePath).toLowerCase()) ||
      !(error instanceof Error) ||
      !/^Missing sample(Duration|Size) and no defaultSample(Duration|Size) in track fragment header$/.test(
        error.message
      )
    ) {
      throw error
    }

    Logger.warn(
      '[Metadata] fragment parser failed; reading remuxed copy',
      { filePath },
      logError(error)
    )
    const directory = await fs.mkdtemp(path.join(tmpdir(), 'easy-player-metadata-'))
    try {
      const copyPath = path.join(directory, `audio${path.extname(filePath).toLowerCase()}`)
      await fs.copyFile(filePath, copyPath)
      // The native writer copies compressed packets into a regular MP4 container.
      if (!writeNativeMetadata(copyPath, {})) throw error
      return await parseFile(copyPath, options)
    } catch (fallbackError) {
      Logger.warn('[Metadata] remuxed copy read failed', { filePath }, logError(fallbackError))
      throw error
    } finally {
      await fs.rm(directory, { recursive: true, force: true }).catch((cleanupError) => {
        Logger.warn(
          '[Metadata] temporary copy cleanup failed',
          { directory },
          logError(cleanupError)
        )
      })
    }
  }
}
