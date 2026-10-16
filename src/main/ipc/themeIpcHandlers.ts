import { ipcMain } from 'electron'
import {
  importThemePackage,
  exportThemePackage,
  removeThemePackage
} from '../service/themePackageService'

export function registerThemeIpcHandlers(): void {
  ipcMain.handle('themes:import', async (_event, data: Uint8Array) => {
    try {
      return { success: true, data: await importThemePackage(data) }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
  ipcMain.handle('themes:export', async (_event, id: string) => {
    try {
      return { success: true, data: await exportThemePackage(id) }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
  ipcMain.handle('themes:remove', async (_event, id: string) => {
    try {
      await removeThemePackage(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}
