import { BrowserWindow, dialog, ipcMain } from 'electron'
import { exportLibrary, importLibrary, recoverMovedSongs } from '../service/fileService'

export function registerFileIpcHandlers(): void {
  ipcMain.handle(
    'files:export-library',
    async (event, parts: Array<'songs' | 'playlists' | 'tags' | 'settings'>) => {
      const result = await dialog.showSaveDialog(
        BrowserWindow.fromWebContents(event.sender) ?? undefined,
        {
          defaultPath: `easy-player-backup-${Date.now()}.epb`,
          filters: [{ name: 'Easy Player Backup', extensions: ['epb'] }]
        }
      )
      if (result.canceled || !result.filePath) return { success: false, cancelled: true }
      return { success: true, data: exportLibrary(result.filePath, parts) }
    }
  )
  ipcMain.handle('files:import-library', async (event) => {
    const result = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(event.sender) ?? undefined,
      { properties: ['openFile'], filters: [{ name: 'Easy Player Backup', extensions: ['epb'] }] }
    )
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
    const result = await dialog.showOpenDialog(
      BrowserWindow.fromWebContents(event.sender) ?? undefined,
      { properties: ['openDirectory'] }
    )
    if (result.canceled || !result.filePaths[0]) return { success: false, cancelled: true }
    return { success: true, data: recoverMovedSongs(result.filePaths[0]) }
  })
}
