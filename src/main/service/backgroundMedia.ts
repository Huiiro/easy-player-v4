import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, mkdir, readFile, readdir, rm, stat } from 'node:fs/promises'
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
const pendingRetirements = new Map<string, ReturnType<typeof setTimeout>>()
type BackgroundPreferences = { customBg?: { url?: string } }

export function backgroundImageType(file: string): string | undefined {
  return imageTypes.get(extname(file).toLowerCase())
}

function videoUrl(file: string): string {
  return `easy-player-media://background?path=${encodeURIComponent(file)}`
}

async function inlineImage(file: string, mime: string): Promise<string> {
  const contents = await readFile(file)
  if (!contents.length) throw new Error('Invalid background file.')
  return `data:${mime};base64,${contents.toString('base64')}`
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
  const mime = imageTypes.get(extension)
  if (!mime && extension !== '.mp4') throw new Error('Unsupported background format.')
  const info = await stat(source)
  if (!info.isFile() || !info.size) throw new Error('Invalid background file.')
  // Earlier releases read images directly from the persisted preferences.
  if (mime) return { url: await inlineImage(source, mime) }
  if (info.size > 2 * 1024 ** 3) throw new Error('The video must be smaller than 2 GB.')
  const target = getBackgroundPath(`${randomUUID()}.mp4`)
  await mkdir(getBackgroundPath(), { recursive: true })
  await copyFile(source, target, constants.COPYFILE_EXCL)
  return { url: videoUrl(target) }
}

function readBackgroundPreferences(): BackgroundPreferences | null {
  const persisted = getAppSetting(uiPreferencesKey)
  return typeof persisted === 'string' ? JSON.parse(persisted) : null
}

function resolveStoredBackground(url: unknown): string | null {
  return typeof url === 'string' && url.startsWith('easy-player-media://background?')
    ? resolveBackgroundMedia(new URL(url))
    : null
}

export async function restoreBackgroundCompatibility(): Promise<void> {
  const preferences = readBackgroundPreferences()
  const background = preferences?.customBg
  const url = background?.url
  const target = resolveStoredBackground(url)
  if (!background || !target || !url || !new URL(url).searchParams.has('name')) return
  const mime = backgroundImageType(target)
  background.url = mime ? await inlineImage(target, mime) : videoUrl(target)
  setAppSetting(uiPreferencesKey, JSON.stringify(preferences))
}

export function retireBackgroundMedia(url: string): boolean {
  const target = resolveStoredBackground(url)
  if (!target) return false
  if (!pendingRetirements.has(target)) {
    // Run in the main process so closing the settings renderer cannot cancel retirement.
    const timer = setTimeout(() => {
      pendingRetirements.delete(target)
      void removeUnusedBackground(target).catch(() => undefined)
    }, 1500)
    timer.unref()
    pendingRetirements.set(target, timer)
  }
  return true
}

async function removeUnusedBackground(file: string): Promise<void> {
  if (resolveStoredBackground(readBackgroundPreferences()?.customBg?.url) !== file)
    await rm(file, { force: true })
}

export async function pruneBackgroundMedia(): Promise<void> {
  const current = resolveStoredBackground(readBackgroundPreferences()?.customBg?.url)
  const entries = await readdir(getBackgroundPath(), { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const url = new URL('easy-player-media://background')
    url.searchParams.set('name', entry.name)
    const file = resolveBackgroundMedia(url)
    if (!file || file === current) continue
    const timer = pendingRetirements.get(file)
    if (timer) clearTimeout(timer)
    pendingRetirements.delete(file)
    // A playing video may still be open on Windows. Retry at the next startup.
    await rm(file, { force: true }).catch(() => undefined)
  }
}
