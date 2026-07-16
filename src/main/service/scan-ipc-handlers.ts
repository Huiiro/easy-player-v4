import { BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron'
import { scanMusicDirectory, type ScanResult } from './scanService'

export const IMPORT_LOCAL_MUSIC_CHANNEL = 'library:import-local-folder'
export const SCAN_PROGRESS_EVENT = 'library:scan-progress'

export interface ScanProgress {
  current: number
  total: number
  added: number
  duplicates: number
}

export type ImportLocalMusicResult =
  { cancelled: true } | { cancelled: false; directory: string; result: ScanResult }

export function registerScanIpcHandlers(): void {
  ipcMain.handle(IMPORT_LOCAL_MUSIC_CHANNEL, async (event): Promise<ImportLocalMusicResult> => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: OpenDialogOptions = {
      properties: ['openDirectory']
    }
    const selection = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (selection.canceled || !selection.filePaths[0]) return { cancelled: true }

    const directory = selection.filePaths[0]
    return {
      cancelled: false,
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
    }
  })
}
