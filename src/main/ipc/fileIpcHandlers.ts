import { logOperation } from '../service/operationLogger'
import {
  BrowserWindow,
  dialog,
  ipcMain,
  type OpenDialogOptions,
  type OpenDialogReturnValue,
  type SaveDialogReturnValue,
  type SaveDialogOptions
} from 'electron'
import { exportLibrary, importLibrary, recoverMovedSongs } from '../service/fileService'
import { rm } from 'node:fs/promises'
import { extname, isAbsolute } from 'node:path'
import { importBackgroundMedia, resolveBackgroundMedia } from '../service/backgroundMedia'

function showOpenDialogFor(
  event: Electron.IpcMainInvokeEvent,
  options: OpenDialogOptions
): Promise<OpenDialogReturnValue> {
  const window = BrowserWindow.fromWebContents(event.sender)
  return window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options)
}
function showSaveDialogFor(
  event: Electron.IpcMainInvokeEvent,
  options: SaveDialogOptions
): Promise<SaveDialogReturnValue> {
  const window = BrowserWindow.fromWebContents(event.sender)
  return window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options)
}

export function registerFileIpcHandlers(): void {
  ipcMain.handle('files:remove-background-media', async (_event, mediaUrl: string) => {
    try {
      const target = resolveBackgroundMedia(new URL(mediaUrl))
      if (!target) return { success: false }
      await rm(target, { force: true })
      return { success: true }
    } catch {
      return { success: false }
    }
  })
  ipcMain.handle('files:import-background-media', async (_event, source: string) => {
    try {
      return { success: true, data: await importBackgroundMedia(source) }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle(
    'files:export-library',
    async (event, parts: Array<'songs' | 'playlists' | 'tags' | 'settings'>) => {
      return logOperation('[IPC] files:export-library', { parts }, async () => {
        const result = await showSaveDialogFor(event, {
          defaultPath: `easy_player_backup_${Date.now()}.epb`,
          filters: [{ name: 'EasyPlayer Backup', extensions: ['epb'] }]
        })
        if (result.canceled || !result.filePath) return { success: false, cancelled: true }
        return { success: true, data: exportLibrary(result.filePath, parts) }
      })
    }
  )
  ipcMain.handle('files:import-library', async (event, filePath?: unknown) => {
    return logOperation('[IPC] files:import-library', {}, async () => {
      if (filePath === undefined) {
        const result = await showOpenDialogFor(event, {
          properties: ['openFile'],
          filters: [{ name: 'EasyPlayer Backup', extensions: ['epb'] }]
        })
        if (result.canceled || !result.filePaths[0]) return { success: false, cancelled: true }
        filePath = result.filePaths[0]
      }
      if (
        typeof filePath !== 'string' ||
        !isAbsolute(filePath) ||
        extname(filePath).toLowerCase() !== '.epb'
      )
        return { success: false }
      return {
        success: true,
        data: await importLibrary(filePath, (current, total) => {
          if (!event.sender.isDestroyed())
            event.sender.send('files:import-progress', { current, total })
        })
      }
    })
  })
  ipcMain.handle('files:recover-moved-songs', async (event) => {
    return logOperation('[IPC] files:recover-moved-songs', {}, async () => {
      const result = await showOpenDialogFor(event, { properties: ['openDirectory'] })
      if (result.canceled || !result.filePaths[0]) return { success: false, cancelled: true }
      return { success: true, data: await recoverMovedSongs(result.filePaths[0]) }
    })
  })
}
