import { t } from '../i18n'
import { cancelSourceCalls } from './runtime'
import { getAppSetting, setAppSetting } from '../database/repository/settings'
import { getNetworkSources } from './index'
import type { NetworkSourceInfo } from '../../shared/networkSources'

const settingKey = 'network-sources.disabled'
function savedDisabled(): Set<string> {
  const value = getAppSetting(settingKey)
  return new Set(
    Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : []
  )
}

/** Run after the library is initialized. No schema change or online request is needed. */
export function initializeSourceSettings(): void {
  const disabled = savedDisabled()
  const registry = getNetworkSources()
  for (const source of registry.listDescriptors())
    registry.setEnabled(source.id, !disabled.has(source.id))
}
export function listManagedSources(): NetworkSourceInfo[] {
  return getNetworkSources().listDescriptors()
}
export function setManagedSourceEnabled(id: string, enabled: boolean): void {
  if (typeof id !== 'string' || typeof enabled !== 'boolean')
    throw new Error(t('networkSourceInvalid'))
  const registry = getNetworkSources()
  if (!registry.knows(id)) throw new Error(t('networkSourceUnknown'))
  const descriptor = registry.listDescriptors().find((source) => source.id === id)
  if (enabled && descriptor?.pluginState && descriptor.pluginState !== 'active')
    throw new Error(t('pluginSourceInactive'))
  const disabled = savedDisabled()
  if (enabled) disabled.delete(id)
  else disabled.add(id)
  // Keep the active state intact if persistence fails.
  setAppSetting(settingKey, [...disabled].sort())
  registry.setEnabled(id, enabled)
  if (!enabled) cancelSourceCalls(id)
}
