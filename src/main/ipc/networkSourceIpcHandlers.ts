import { ipcMain, BrowserWindow } from 'electron'
import { t } from '../i18n'
import {
  initializeSourceSettings,
  listManagedSources,
  setManagedSourceEnabled
} from '../sources/management'
import { Logger } from '../service/loggerService'
import { logError } from '../service/operationLogger'

export function registerNetworkSourceIpcHandlers(): void {
  initializeSourceSettings()
  ipcMain.handle('network-sources:list', () => {
    try {
      return { success: true, data: listManagedSources() }
    } catch (error) {
      Logger.error('[Network sources] list failed', logError(error))
      return { success: false, error: t('networkSourcesLoadFailed') }
    }
  })
  ipcMain.handle(
    'network-sources:set-enabled',
    (_event, request: { sourceId: string; enabled: boolean }) => {
      try {
        setManagedSourceEnabled(request?.sourceId, request?.enabled)
      } catch (error) {
        Logger.error(
          '[Network sources] update failed',
          { sourceId: request?.sourceId },
          logError(error)
        )
        return {
          success: false,
          error: error instanceof Error ? error.message : t('networkSourcesSaveFailed')
        }
      }
      // A closed window must not turn a successful persisted change into a failed response.
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
          try {
            window.webContents.send('network-sources:changed')
          } catch (error) {
            Logger.debug('[Network sources] changed notification failed', logError(error))
          }
        }
      }
      return { success: true }
    }
  )
}
