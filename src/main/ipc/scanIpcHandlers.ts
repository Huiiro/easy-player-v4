import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { scanMusicDirectory, type ScanResult } from '../service/scanService'

export const SELECT_LOCAL_MUSIC_FOLDER_CHANNEL = 'library:select-local-folder'
export const SCAN_LOCAL_MUSIC_FOLDER_CHANNEL = 'library:scan-local-folder'
export const SCAN_PROGRESS_EVENT = 'library:scan-progress'

export interface ScanProgress {
  current: number
  total: number
  added: number
  duplicates: number
}

export type ScanLocalMusicResult = { directory: string; result: ScanResult }

export function registerScanIpcHandlers(): void {
  ipcMain.handle(SELECT_LOCAL_MUSIC_FOLDER_CHANNEL, async (event): Promise<string | null> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      properties: ['openDirectory']
    }
    const selection = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    return selection.canceled ? null : selection.filePaths[0] || null
  })

  ipcMain.handle(
    SCAN_LOCAL_MUSIC_FOLDER_CHANNEL,
    async (event, directory: string): Promise<ScanLocalMusicResult> => ({
      directory,
      result: await scanMusicDirectory(directory, (current, total, added, duplicates) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send(SCAN_PROGRESS_EVENT, {
            current,
            total,
            added,
            duplicates
          } satisfies ScanProgress)
        }
      })
    })
  )
}
