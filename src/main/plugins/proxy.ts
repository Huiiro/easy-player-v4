import { session, type Session } from 'electron'
import { randomUUID } from 'node:crypto'
import { getAppSetting, setAppSetting } from '../database/repository/settings'
import { normalizePluginProxy, type PluginProxySettings } from '../../shared/pluginProxy'

const key = 'plugins.proxy'
let settings: PluginProxySettings = { enabled: false, url: '' }
let activeSession: Session | undefined
let pending: Promise<void> = Promise.resolve()

async function createSession(value: PluginProxySettings): Promise<Session> {
  // Separate sessions keep application traffic and requests already in progress unaffected.
  const result = session.fromPartition(`plugin-proxy-${randomUUID()}`, { cache: false })
  await result.setProxy(
    value.enabled
      ? { mode: 'fixed_servers', proxyRules: value.url, proxyBypassRules: '<-loopback>' }
      : { mode: 'direct' }
  )
  return result
}

export async function initializePluginProxy(): Promise<void> {
  const saved = getAppSetting(key)
  if (saved !== null) settings = normalizePluginProxy(saved)
  activeSession = await createSession(settings)
}

export function getPluginProxySettings(): PluginProxySettings {
  return { ...settings }
}

export function getPluginSession(): Session {
  if (!activeSession) throw new Error('Plugin proxy is not initialized')
  return activeSession
}

export function savePluginProxySettings(value: unknown): Promise<void> {
  const next = normalizePluginProxy(value)
  const operation = pending.then(async () => {
    const nextSession = await createSession(next)
    setAppSetting(key, next)
    settings = next
    activeSession = nextSession
  })
  pending = operation.catch(() => {})
  return operation
}

export const pluginFetch: typeof fetch = (input, init) => getPluginSession().fetch(input, init)

export function pluginProxyArguments(): string[] {
  // Explicitly clear environment proxies when disabled, matching the HTTP session.
  return ['--proxy', settings.enabled ? settings.url : '']
}
