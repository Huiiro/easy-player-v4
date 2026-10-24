import { t } from '../i18n'
import { getAppSetting, setAppSetting } from '../database/repository/settings'
import { Logger } from '../service/loggerService'
import { configurePluginHost, getPluginManager } from './runtime'
import type { PluginInfo } from '../../shared/plugins'
import { app } from 'electron'
import { join } from 'node:path'
import seedCatalog from '../../../resources/plugins/catalog.json'
import { OfficialPluginPackages } from './packages'
import { officialPluginBridge } from './bridge'
import { extractMediaInfo } from '../service/mediaDownloadRuntime'
import { initializeSourceSettings } from '../sources/management'
import type { OfficialPluginCatalog } from '../../shared/plugins'

let packages: OfficialPluginPackages | undefined
export function getOfficialPluginPackages(): OfficialPluginPackages {
  if (!packages)
    packages = new OfficialPluginPackages(
      join(app.getPath('userData'), 'plugins'),
      getPluginManager(),
      officialPluginBridge,
      seedCatalog as OfficialPluginCatalog,
      fetch,
      (id) => Logger.error('[Plugin]', { pluginId: id, message: 'PACKAGE_LOAD_FAILED' })
    )
  return packages
}

const key = 'plugins.disabled'
function disabledPlugins(): Set<string> {
  const saved = getAppSetting(key)
  return new Set(
    Array.isArray(saved) ? saved.filter((id): id is string => typeof id === 'string') : []
  )
}
export function initializePlugins(): void {
  configurePluginHost({
    readSetting: getAppSetting,
    writeSetting: setAppSetting,
    log: (pluginId, level, message) => Logger[level]('[Plugin]', { pluginId, message }),
    fetch: (url, init) => fetch(url, init),
    mediaInfo: extractMediaInfo
  })
  const disabled = disabledPlugins()
  const manager = getPluginManager()
  getOfficialPluginPackages().initialize()
  for (const plugin of manager.list()) {
    if (disabled.has(plugin.id)) manager.deactivate(plugin.id)
    else if (plugin.state !== 'active') {
      try {
        manager.activate(plugin.id)
      } catch {
        /* Each failed plugin stays retryable. */
      }
    }
  }
}
export async function installManagedPlugin(id: string): Promise<void> {
  if (typeof id !== 'string') throw new Error('pluginInvalid')
  await getOfficialPluginPackages().install(id, !disabledPlugins().has(id))
  initializeSourceSettings()
}
export async function importManagedPlugin(filename: string): Promise<void> {
  const disabled = disabledPlugins()
  await getOfficialPluginPackages().installFile(filename, (id) => !disabled.has(id))
  initializeSourceSettings()
}
export function uninstallManagedPlugin(id: string): void {
  if (typeof id !== 'string') throw new Error('pluginInvalid')
  getOfficialPluginPackages().uninstall(id)
}
export function listManagedPlugins(): PluginInfo[] {
  return getPluginManager().list()
}
export function setManagedPluginEnabled(id: string, enabled: boolean): void {
  if (typeof id !== 'string' || typeof enabled !== 'boolean') throw new Error(t('pluginInvalid'))
  if (packages?.isBusy(id)) throw new Error(t('pluginBusy'))
  const manager = getPluginManager(),
    current = manager.get(id)
  if (!current) throw new Error(t('pluginUnknown'))
  const disabled = disabledPlugins()
  if (!enabled) {
    disabled.add(id)
    // Persistence failure leaves the active plugin and its requests intact.
    setAppSetting(key, [...disabled].sort())
    manager.deactivate(id)
    return
  }
  try {
    manager.activate(id)
  } catch {
    throw new Error(t('pluginActivationFailed'))
  }
  disabled.delete(id)
  try {
    setAppSetting(key, [...disabled].sort())
  } catch {
    if (current.state !== 'active') manager.deactivate(id)
    throw new Error(t('pluginsSaveFailed'))
  }
}
