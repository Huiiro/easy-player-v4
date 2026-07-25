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
  ipcMain.handle(
    'files:export-library',
    async (event, parts: Array<'songs' | 'playlists' | 'tags' | 'settings'>) => {
      const result = await showSaveDialogFor(event, {
        defaultPath: `easy-player-backup-${Date.now()}.epb`,
        filters: [{ name: 'Easy Player Backup', extensions: ['epb'] }]
      })
      if (result.canceled || !result.filePath) return { success: false, cancelled: true }
      return { success: true, data: exportLibrary(result.filePath, parts) }
    }
  )
  ipcMain.handle('files:import-library', async (event) => {
    const result = await showOpenDialogFor(event, {
      properties: ['openFile'],
      filters: [{ name: 'Easy Player Backup', extensions: ['epb'] }]
    })
    if (result.canceled || !result.filePaths[0]) return { success: false, cancelled: true }
    return {
      success: true,
      data: await importLibrary(result.filePaths[0], (current, total) => {
        if (!event.sender.isDestroyed())
          event.sender.send('files:import-progress', { current, total })
      })
    }
  })
  ipcMain.handle('files:recover-moved-songs', async (event) => {
    const result = await showOpenDialogFor(event, { properties: ['openDirectory'] })
    if (result.canceled || !result.filePaths[0]) return { success: false, cancelled: true }
    return { success: true, data: recoverMovedSongs(result.filePaths[0]) }
  })
}
