import { dialog, ipcMain } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { t } from '../i18n'
import { cacheRemoteSong, syncRemoteSource, testRemoteSource } from '../service/remoteSourceService'
import { Logger } from '../service/loggerService'
import { logError, logOperation } from '../service/operationLogger'
import { getDataPath } from '../utils/pathUtils'

export function registerRemoteSourceIpcHandlers(): void {
  ipcMain.handle('remote-source:test', async (_event, config: unknown) => {
    return logOperation('[IPC] remote-source:test', {}, async () => {
      const value = config as {
        type?: unknown
        baseUrl?: unknown
        user?: unknown
        secret?: unknown
      }
      if (
        (value?.type !== 'navidrome' && value?.type !== 'jellyfin') ||
        typeof value?.baseUrl !== 'string' ||
        typeof value.user !== 'string' ||
        typeof value.secret !== 'string'
      ) {
        return { success: false, error: t('invalidSourceConfig') }
      }
      try {
        return {
          success: true,
          data: await testRemoteSource(
            value as {
              type: 'navidrome' | 'jellyfin'
              baseUrl: string
              user: string
              secret: string
            }
          )
        }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    })
  })
  ipcMain.handle('remote-source:choose-cache-directory', async () => {
    return logOperation(
      '[IPC] remote-source:choose-cache-directory',
      {},
      async () => {
        const result = await dialog.showOpenDialog({
          properties: ['openDirectory', 'createDirectory']
        })
        return result.canceled ? { success: false } : { success: true, data: result.filePaths[0] }
      },
      { cancellationExpected: true }
    )
  })
  ipcMain.handle('remote-source:default-cache-directory', () => ({
    success: true,
    data: join(getDataPath(), 'cache')
  }))
  ipcMain.handle('remote-source:cache-size', async (_event, directory: unknown) => {
    if (typeof directory !== 'string' || !existsSync(directory)) return { success: true, data: 0 }
    const sizeOf = async (target: string): Promise<number> => {
      const entries = await fs.readdir(target, { withFileTypes: true })
      let total = 0
      for (const entry of entries) {
        const child = join(target, entry.name)
        if (entry.isDirectory()) total += await sizeOf(child)
        else if (entry.isFile()) total += (await fs.stat(child)).size
      }
      return total
    }
    try {
      return { success: true, data: await sizeOf(directory) }
    } catch (error) {
      Logger.warn('[Remote] cache size calculation failed', { directory }, logError(error))
      return { success: true, data: 0 }
    }
  })
  ipcMain.handle('remote-source:sync', async (_event, sourceId: unknown) => {
    return logOperation('[IPC] remote-source:sync', { sourceId }, async () => {
      if (!Number.isInteger(sourceId)) return { success: false, error: t('invalidSourceId') }
      try {
        return { success: true, data: await syncRemoteSource(sourceId as number) }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    })
  })
  ipcMain.handle('remote-source:cache-song', async (_event, songId: unknown) => {
    return logOperation('[IPC] remote-source:cache-song', { songId }, async () => {
      if (!Number.isInteger(songId)) return { success: false, error: t('invalidSongId') }
      try {
        return { success: true, data: await cacheRemoteSong(songId as number) }
      } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : String(error) }
      }
    })
  })
}
