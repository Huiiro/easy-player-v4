import { ipcMain } from 'electron'
import { removeThemePackage } from '../service/themePackageService'

export function registerThemeIpcHandlers(): void {
  ipcMain.handle('themes:remove', async (_event, id: string) => {
    try {
      await removeThemePackage(id)
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })
}
