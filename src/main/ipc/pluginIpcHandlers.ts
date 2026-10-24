import { BrowserWindow, dialog, ipcMain } from 'electron'
import { t } from '../i18n'
import {
  initializePlugins,
  listManagedPlugins,
  setManagedPluginEnabled,
  getOfficialPluginPackages,
  installManagedPlugin,
  importManagedPlugin,
  uninstallManagedPlugin
} from '../plugins/management'

function changed(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || window.webContents.isDestroyed()) continue
    for (const channel of ['plugins:changed', 'network-sources:changed']) {
      try {
        window.webContents.send(channel)
      } catch {
        /* The committed state survives a closing window. */
      }
    }
  }
}
export function registerPluginIpcHandlers(): void {
  initializePlugins()
  const failure = (
    reason: unknown,
    fallback:
      | 'pluginInstallFailed'
      | 'pluginCatalogLoadFailed'
      | 'pluginUninstallFailed' = 'pluginInstallFailed'
  ): { success: false; error: string } => {
    const key = reason instanceof Error ? reason.message : ''
    const messages = [
      'pluginCatalogInvalid',
      'pluginDownloadFailed',
      'pluginPackageInvalid',
      'pluginPackageIntegrity',
      'pluginDowngrade',
      'pluginBusy',
      'pluginUnknown',
      'pluginInvalid'
    ] as const
    const known = messages.find((message) => message === key)
    return { success: false, error: t(known ?? fallback) }
  }
  ipcMain.handle('plugins:catalog', async (_event, refresh: boolean) => {
    try {
      const packages = getOfficialPluginPackages()
      return {
        success: true,
        data: refresh === true ? await packages.refreshCatalog() : packages.listCatalog()
      }
    } catch (reason) {
      return failure(reason, 'pluginCatalogLoadFailed')
    }
  })
  ipcMain.handle('plugins:install', async (_event, id: string) => {
    try {
      await installManagedPlugin(id)
      return { success: true }
    } catch (reason) {
      return failure(reason)
    } finally {
      changed()
    }
  })
  ipcMain.handle('plugins:uninstall', (_event, id: string) => {
    try {
      uninstallManagedPlugin(id)
      return { success: true }
    } catch (reason) {
      return failure(reason, 'pluginUninstallFailed')
    } finally {
      changed()
    }
  })
  ipcMain.handle('plugins:import', async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender)
      const options = {
        properties: ['openFile'] as ['openFile'],
        filters: [{ name: 'Easy Player Plugin', extensions: ['epp'] }]
      }
      const selected = window
        ? await dialog.showOpenDialog(window, options)
        : await dialog.showOpenDialog(options)
      if (selected.canceled || !selected.filePaths[0]) return { success: true, cancelled: true }
      await importManagedPlugin(selected.filePaths[0])
      return { success: true }
    } catch (reason) {
      return failure(reason)
    } finally {
      changed()
    }
  })
  ipcMain.handle('plugins:list', () => {
    try {
      return { success: true, data: listManagedPlugins() }
    } catch {
      return { success: false, error: t('pluginsLoadFailed') }
    }
  })
  ipcMain.handle(
    'plugins:set-enabled',
    (_event, request: { pluginId: string; enabled: boolean }) => {
      try {
        setManagedPluginEnabled(request?.pluginId, request?.enabled)
        return { success: true }
      } catch (reason) {
        return {
          success: false,
          error: reason instanceof Error ? reason.message : t('pluginsSaveFailed')
        }
      } finally {
        changed()
      }
    }
  )
}
