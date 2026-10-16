import { logOperation } from '../service/operationLogger'
import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import path from 'node:path'
import { scanMusicDirectory, SUPPORTED_EXTENSIONS, type ScanResult } from '../service/scanService'
import { t } from '../i18n'

export const SELECT_LOCAL_MUSIC_FOLDER_CHANNEL = 'library:select-local-folder'
export const SCAN_LOCAL_MUSIC_FOLDER_CHANNEL = 'library:scan-local-folder'
export const IMPORT_LOCAL_MUSIC_FILE_CHANNEL = 'library:import-local-file'
export const SCAN_PROGRESS_EVENT = 'library:scan-progress'

export interface ScanProgress {
  current: number
  total: number
  added: number
  duplicates: number
}

export type ScanLocalMusicResult = { directory: string; result: ScanResult }

export function registerScanIpcHandlers(): void {
  ipcMain.handle(
    IMPORT_LOCAL_MUSIC_FILE_CHANNEL,
    async (event, ignoreShortSongs = true): Promise<ScanLocalMusicResult | null> => {
      return logOperation('[IPC] library:import-local-file', {}, async () => {
        const window = BrowserWindow.fromWebContents(event.sender)
        const options: OpenDialogOptions = {
          properties: ['openFile'],
          filters: [
            { name: t('audioFiles'), extensions: SUPPORTED_EXTENSIONS.map((ext) => ext.slice(1)) }
          ]
        }
        const selection = window
          ? await dialog.showOpenDialog(window, options)
          : await dialog.showOpenDialog(options)
        const file = selection.filePaths[0]
        if (selection.canceled || !file) return null
        const directory = path.dirname(file)
        return {
          directory,
          result: await scanMusicDirectory(directory, undefined, [file], ignoreShortSongs !== false)
        }
      })
    }
  )

  ipcMain.handle(SELECT_LOCAL_MUSIC_FOLDER_CHANNEL, async (event): Promise<string | null> => {
    return logOperation('[IPC] library:select-local-folder', {}, async () => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const options: OpenDialogOptions = {
        properties: ['openDirectory']
      }
      const selection = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      return selection.canceled ? null : selection.filePaths[0] || null
    })
  })

  ipcMain.handle(
    SCAN_LOCAL_MUSIC_FOLDER_CHANNEL,
    async (event, directory: string, ignoreShortSongs = true): Promise<ScanLocalMusicResult> => {
      return logOperation('[IPC] library:scan-local-folder', { directory }, async () => {
        return {
          directory,
          result: await scanMusicDirectory(
            directory,
            (current, total, added, duplicates) => {
              if (!event.sender.isDestroyed()) {
                event.sender.send(SCAN_PROGRESS_EVENT, {
                  current,
                  total,
                  added,
                  duplicates
                } satisfies ScanProgress)
              }
            },
            undefined,
            ignoreShortSongs !== false
          )
        }
      })
    }
  )
}
