import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, extname, resolve } from 'node:path'
import { getAppSetting, setAppSetting } from '../database/repository/settings'
import { getBackgroundPath } from '../utils/pathUtils'

const imageTypes = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.gif', 'image/gif'],
  ['.bmp', 'image/bmp'],
  ['.avif', 'image/avif'],
  ['.svg', 'image/svg+xml']
])
const uiPreferencesKey = 'pinia.ui.preferences.v1'

export function backgroundImageType(file: string): string | undefined {
  return imageTypes.get(extname(file).toLowerCase())
}

function backgroundUrl(name: string): string {
  return `easy-player-media://background?name=${encodeURIComponent(name)}`
}

export function resolveBackgroundMedia(url: URL): string | null {
  if (url.protocol !== 'easy-player-media:' || url.hostname !== 'background') return null
  const legacyPath = url.searchParams.get('path')
  const name = url.searchParams.get('name') ?? (legacyPath ? basename(legacyPath) : '')
  const extension = extname(name).toLowerCase()
  if (
    !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\.[a-z0-9]+$/i.test(name) ||
    (!imageTypes.has(extension) && extension !== '.mp4')
  )
    return null
  const target = getBackgroundPath(name)
  // Older video settings used an absolute path. Resolve it only within this profile.
  if (!url.searchParams.has('name') && (extension !== '.mp4' || resolve(legacyPath!) !== target))
    return null
  return target
}

export async function importBackgroundMedia(source: string): Promise<{ url: string }> {
  const extension = typeof source === 'string' ? extname(source).toLowerCase() : ''
  if (!imageTypes.has(extension) && extension !== '.mp4')
    throw new Error('Unsupported background format.')
  const info = await stat(source)
  if (!info.isFile() || !info.size) throw new Error('Invalid background file.')
  if (extension === '.mp4' && info.size > 2 * 1024 ** 3)
    throw new Error('The video must be smaller than 2 GB.')
  const name = randomUUID() + extension
  await mkdir(getBackgroundPath(), { recursive: true })
  await copyFile(source, getBackgroundPath(name), constants.COPYFILE_EXCL)
  return { url: backgroundUrl(name) }
}

export async function migrateInlineBackground(): Promise<void> {
  const persisted = getAppSetting(uiPreferencesKey)
  if (typeof persisted !== 'string') return
  const preferences = JSON.parse(persisted)
  const url = preferences?.customBg?.url
  if (typeof url !== 'string' || !url.startsWith('data:')) return
  const comma = url.indexOf(',')
  if (comma < 0) return
  const mime = /^data:(image\/[a-z0-9.+-]+);base64$/i.exec(url.slice(0, comma))?.[1].toLowerCase()
  // Some Windows file pickers report an empty MIME type for otherwise supported files.
  const header = url.slice(0, comma)
  const extension =
    [...imageTypes].find(([, type]) => type === mime)?.[0] ??
    (mime || header.toLowerCase() === 'data:application/octet-stream;base64'
      ? extname(String(preferences.customBg.path ?? '')).toLowerCase()
      : undefined)
  if (!extension || !imageTypes.has(extension)) return
  const content = Buffer.from(url.slice(comma + 1), 'base64')
  if (!content.length) return
  const name = randomUUID() + extension
  const target = getBackgroundPath(name)
  await mkdir(getBackgroundPath(), { recursive: true })
  try {
    await writeFile(target, content, { flag: 'wx' })
    preferences.customBg.url = backgroundUrl(name)
    setAppSetting(uiPreferencesKey, JSON.stringify(preferences))
  } catch (error) {
    await rm(target, { force: true }).catch(() => undefined)
    throw error
  }
}
