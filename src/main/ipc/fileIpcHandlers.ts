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
import { copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { extname, join, relative, resolve, isAbsolute } from 'node:path'
import { getDataPath } from '../utils/pathUtils'

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
  ipcMain.handle('files:remove-background-video', async (_event, mediaUrl: string) => {
    try {
      const url = new URL(mediaUrl)
      if (url.protocol !== 'easy-player-media:' || url.hostname !== 'background')
        return { success: false }
      const directory = resolve(getDataPath(), 'backgrounds')
      const target = resolve(url.searchParams.get('path') || '')
      const relativePath = relative(directory, target)
      if (
        relativePath.startsWith('..') ||
        isAbsolute(relativePath) ||
        !/^[0-9a-f-]{36}\.mp4$/i.test(relativePath)
      )
        return { success: false }
      await rm(target, { force: true })
      return { success: true }
    } catch {
      return { success: false }
    }
  })
  ipcMain.handle('files:import-background-video', async (_event, source: string) => {
    if (typeof source !== 'string' || extname(source).toLowerCase() !== '.mp4')
      return { success: false, error: 'Only MP4 files are supported.' }
    try {
      const info = await stat(source)
      if (!info.isFile() || info.size === 0 || info.size > 2 * 1024 ** 3)
        return { success: false, error: 'The video must be smaller than 2 GB.' }
      const directory = join(getDataPath(), 'backgrounds')
      await mkdir(directory, { recursive: true })
      const target = join(directory, `${randomUUID()}.mp4`)
      await copyFile(source, target)
      return {
        success: true,
        data: { url: `easy-player-media://background?path=${encodeURIComponent(target)}` }
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    }
  })
  ipcMain.handle(
    'files:export-library',
    async (event, parts: Array<'songs' | 'playlists' | 'tags' | 'settings'>) => {
      return logOperation('[IPC] files:export-library', { parts }, async () => {
        const result = await showSaveDialogFor(event, {
          defaultPath: `easy-player-backup-${Date.now()}.epb`,
          filters: [{ name: 'Easy Player Backup', extensions: ['epb'] }]
        })
        if (result.canceled || !result.filePath) return { success: false, cancelled: true }
        return { success: true, data: exportLibrary(result.filePath, parts) }
      })
    }
  )
  ipcMain.handle('files:import-library', async (event) => {
    return logOperation('[IPC] files:import-library', {}, async () => {
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
  })
  ipcMain.handle('files:recover-moved-songs', async (event) => {
    return logOperation('[IPC] files:recover-moved-songs', {}, async () => {
      const result = await showOpenDialogFor(event, { properties: ['openDirectory'] })
      if (result.canceled || !result.filePaths[0]) return { success: false, cancelled: true }
      return { success: true, data: await recoverMovedSongs(result.filePaths[0]) }
    })
  })
}
