import { t } from '../i18n'
import { logError, logOperation, logParams } from '../service/operationLogger'
import { Logger } from '../service/loggerService'
import { ipcMain } from 'electron'
import { readLocalLyrics } from '../service/lyrics/local'
import { readEmbeddedLyrics } from '../service/lyrics/embedded'
import { searchNetworkLyrics } from '../service/lyrics/network'
import type { LyricsSource, LyricSearchRequest } from '../service/lyrics/types'

export type {
  LyricsSource,
  LyricSearchRequest,
  NetworkLyricCandidate
} from '../service/lyrics/types'

export function registerLyricsIpcHandlers(): void {
  ipcMain.handle(
    'lyrics:load-source',
    async (_event, request: { audioPath: string; source: LyricsSource }) => {
      return logOperation('[IPC] lyrics:load-source', logParams(request), async () => {
        try {
          if (!request?.audioPath || request.source === 'network')
            return { success: true, data: null }
          if (request.source === 'local')
            return { success: true, data: readLocalLyrics(request.audioPath) }
          return { success: true, data: await readEmbeddedLyrics(request.audioPath) }
        } catch (error) {
          Logger.error('[Lyrics IPC] load source failed', logParams(request), logError(error))
          return {
            success: false,
            error: error instanceof Error ? error.message : t('lyricsLoadFailed')
          }
        }
      })
    }
  )
  ipcMain.handle('lyrics:search-network', async (_event, request: LyricSearchRequest) => {
    return logOperation(
      '[IPC] lyrics:search-network',
      { titleLength: request?.title?.length, hasArtist: Boolean(request?.artist) },
      async () => {
        try {
          return { success: true, data: await searchNetworkLyrics(request) }
        } catch (error) {
          Logger.error(
            '[Lyrics IPC] network search failed',
            { titleLength: request?.title?.length },
            logError(error)
          )
          return {
            success: false,
            error: error instanceof Error ? error.message : t('lyricsSearchFailed')
          }
        }
      }
    )
  })
}
