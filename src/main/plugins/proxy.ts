import { session, type Session } from 'electron'
import { randomUUID } from 'node:crypto'
import { getAppSetting, setAppSetting } from '../database/repository/settings'
import { normalizePluginProxy, type PluginProxySettings } from '../../shared/pluginProxy'

const key = 'plugins.proxy'
let settings: PluginProxySettings = { mode: 'direct', url: '' }
let activeSession: Session | undefined
let pending: Promise<void> = Promise.resolve()

async function createSession(value: PluginProxySettings): Promise<Session> {
  // Separate sessions keep application traffic and requests already in progress unaffected.
  const result = session.fromPartition(`plugin-proxy-${randomUUID()}`, { cache: false })
  await result.setProxy(
    value.mode === 'custom'
      ? { mode: 'fixed_servers', proxyRules: value.url, proxyBypassRules: '<-loopback>' }
      : { mode: value.mode }
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

export function pluginProxyArguments(target?: string): string[] | Promise<string[]> {
  if (settings.mode !== 'system') return ['--proxy', settings.mode === 'custom' ? settings.url : '']
  // Resolve via Chromium so media extraction also honors OS proxy/PAC rules.
  const url = target && /^https?:\/\//i.test(target) ? target : 'https://www.youtube.com/'
  return getPluginSession()
    .resolveProxy(url)
    .then((rules) => {
      const first = rules.split(';')[0].trim()
      if (first === 'DIRECT') return ['--proxy', '']
      const match = /^(PROXY|HTTPS|SOCKS|SOCKS5) ([a-z\d._-]+|\[[a-f\d:.]+\]):(\d+)$/i.exec(first)
      if (!match) throw new Error('Unsupported system proxy rule')
      const scheme = { PROXY: 'http', HTTPS: 'https', SOCKS: 'socks4', SOCKS5: 'socks5' }[
        match[1].toUpperCase()
      ]
      return ['--proxy', `${scheme}://${match[2]}:${match[3]}`]
    })
}
