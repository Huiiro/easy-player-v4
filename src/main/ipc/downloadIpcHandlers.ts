import { t } from '../i18n'
import { requireBackgroundWork } from '../service/playbackMode'
import { logOperation, logParams, logUrl } from '../service/operationLogger'
import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { existsSync } from 'node:fs'
import { listDownloadTasks } from '../database/repository'
import { startMediaDownload, type DownloadRequest } from '../service/mediaDownloadService'
import { searchSourceMedia, parseSourceMedia } from '../sources/download'
import { fetchMediaImage } from '../service/mediaDownloadRuntime'

export function registerDownloadIpcHandlers(): void {
  ipcMain.handle('media-download:choose-directory', async (event) => {
    return logOperation('[IPC] media-download:choose-directory', {}, async () => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const result = window
        ? await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
        : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    })
  })
  ipcMain.handle('media-download:history', () => listDownloadTasks())
  ipcMain.handle('media-download:thumbnail', async (_event, url: string) => {
    return logOperation('[IPC] media-download:thumbnail', { url: logUrl(url) }, async () => {
      let hostname = ''
      try {
        hostname = new URL(url).hostname
      } catch {
        throw new Error(t('invalidDownloadCoverUrl'))
      }
      if (!/(^|\.)hdslb\.com$/i.test(hostname)) throw new Error(t('coverSourceUnsupported'))
      return fetchMediaImage(url, { Referer: 'https://www.bilibili.com/' })
    })
  })
  ipcMain.handle('media-download:show-in-folder', (_event, filePath: string) => {
    return logOperation('[IPC] media-download:show-in-folder', { filePath }, () => {
      if (!filePath || !existsSync(filePath))
        return { success: false, error: t('downloadFileRemoved') }
      shell.showItemInFolder(filePath)
      return { success: true }
    })
  })
  ipcMain.handle(
    'media-download:search',
    async (
      _event,
      request: {
        platform: string
        query: string
      }
    ) => {
      return logOperation(
        '[IPC] media-download:search',
        { platform: request?.platform, queryLength: request?.query?.length },
        async () => {
          const query = request.query.trim()
          if (!query) throw new Error(t('searchQueryRequired'))
          requireBackgroundWork()
          return searchSourceMedia(request.platform, query)
        }
      )
    }
  )
  ipcMain.handle('media-download:parse', async (_event, request: { url: string }) => {
    return logOperation('[IPC] media-download:parse', { url: logUrl(request?.url) }, async () => {
      const url = request.url.trim()
      if (!/^https?:\/\//i.test(url)) throw new Error(t('videoUrlInvalid'))
      requireBackgroundWork()
      return parseSourceMedia(url)
    })
  })
  ipcMain.handle('media-download:start', (event, request: DownloadRequest) => {
    return logOperation(
      '[IPC] media-download:start',
      { ...logParams(request), url: logUrl(request?.url) },
      () => {
        return startMediaDownload(event.sender, request)
      }
    )
  })
}
