import { createHash, randomUUID } from 'node:crypto'
import { access, lstat, readdir, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import sharp from 'sharp'
import { getCoverPath } from '../utils/pathUtils'
import { getNetworkSources } from './index'
import { invokeSource, type SourceCallOptions } from './runtime'
import { fetchArtworkDataUrl } from './artworkFetch'
import { SourceCallError } from './errors'

export const normalizeArtistName = (name: string): string =>
  name.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ')

// Failed matches are retried later; successful portraits remain available offline.
const misses = new Map<string, number>()
const pending = new Map<string, Promise<{ path: string | null }>>()
// One artist uses one source at a time, including the portrait download.
const MAX_ACTIVE_ARTISTS = 2
let active = 0
const queue: (() => void)[] = []
let cacheController = new AbortController()
let clearing: Promise<{ files: number }> | undefined

async function withArtistSlot<T>(signal: AbortSignal, task: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  await new Promise<void>((done, reject) => {
    const enter = (): void => {
      signal.removeEventListener('abort', abort)
      active++
      done()
    }
    const abort = (): void => {
      const index = queue.indexOf(enter)
      if (index >= 0) queue.splice(index, 1)
      reject(signal.reason)
    }
    if (active < MAX_ACTIVE_ARTISTS) enter()
    else {
      queue.push(enter)
      signal.addEventListener('abort', abort, { once: true })
    }
  })
  try {
    signal.throwIfAborted()
    return await task()
  } finally {
    active--
    queue.shift()?.()
  }
}

export function clearArtistArtworkCache(): Promise<{ files: number }> {
  if (clearing) return clearing
  const work = (async () => {
    cacheController.abort(new SourceCallError('CANCELLED'))
    // Wait for writes and their temporary-file cleanup before removing files.
    await Promise.allSettled([...pending.values()])
    misses.clear()
    const directory = resolve(getCoverPath('artists'))
    if (dirname(directory) !== resolve(getCoverPath())) throw new Error('Invalid artist cache path')
    let files = 0
    try {
      const stat = await lstat(directory)
      if (!stat.isDirectory() || stat.isSymbolicLink())
        throw new Error('Invalid artist cache directory')
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !/^[a-f0-9]{64}\.jpg(?:\.[a-f0-9-]{36}\.tmp)?$/.test(entry.name))
          continue
        const target = resolve(directory, entry.name)
        if (dirname(target) !== directory) throw new Error('Invalid artist cache file')
        await unlink(target)
        files++
      }
    } catch (reason) {
      if ((reason as NodeJS.ErrnoException).code !== 'ENOENT') throw reason
    }
    return { files }
  })()
  clearing = work
  void work
    .finally(() => {
      cacheController = new AbortController()
      clearing = undefined
    })
    .catch(() => {})
  return work
}

export async function resolveArtistArtwork(
  name: string,
  options: SourceCallOptions = {}
): Promise<{ path: string | null }> {
  if (typeof name !== 'string' || name.length > 500 || !name.trim())
    throw new SourceCallError('INVALID_REQUEST')
  if (name.startsWith('__easy_player_unknown_') || clearing) return { path: null }
  const signal = options.signal
    ? AbortSignal.any([options.signal, cacheController.signal])
    : cacheController.signal
  options = { ...options, signal }
  const key = normalizeArtistName(name)
  const path = getCoverPath('artists', createHash('sha256').update(key).digest('hex') + '.jpg')
  signal.throwIfAborted()
  try {
    await access(path)
    signal.throwIfAborted()
    return { path }
  } catch {
    signal.throwIfAborted()
  }
  const existing = pending.get(key)
  if (existing) return existing
  const work = withArtistSlot(signal, async () => {
    const sources = getNetworkSources()
      .list()
      .filter((source) => source.artistArtwork)
    const missKey = key + ':' + sources.map((source) => source.id + '@' + source.version).join(',')
    if ((misses.get(missKey) ?? 0) > Date.now()) return { path: null }
    let failed = false
    let fulfilled = false
    let firstError: unknown
    for (const source of sources) {
      signal.throwIfAborted()
      let candidates
      try {
        candidates = await invokeSource(
          source.id,
          'artistArtwork.search',
          (entry, context) => entry.artistArtwork!.search(name.trim(), context),
          options
        )
        fulfilled = true
      } catch (reason) {
        signal.throwIfAborted()
        if (reason instanceof SourceCallError && reason.code === 'BACKGROUND_PAUSED') throw reason
        failed = true
        firstError ??= reason
        continue
      }
      for (const candidate of candidates.slice(0, 20)) {
        if (
          !candidate ||
          typeof candidate.name !== 'string' ||
          normalizeArtistName(candidate.name) !== key ||
          candidate.resource?.resourceType !== 'artist'
        )
          continue
        try {
          const data = await fetchArtworkDataUrl(candidate.imageUrl, options)
          const image = await sharp(Buffer.from(data.slice(data.indexOf(',') + 1), 'base64'), {
            limitInputPixels: 40000000
          })
            .resize(512, 512, { fit: 'cover' })
            .jpeg({ quality: 88 })
            .toBuffer()
          signal.throwIfAborted()
          await mkdir(getCoverPath('artists'), { recursive: true })
          const temporary = path + '.' + randomUUID() + '.tmp'
          try {
            await writeFile(temporary, image)
            signal.throwIfAborted()
            await rename(temporary, path)
          } finally {
            await unlink(temporary).catch(() => {})
          }
          return { path }
        } catch (reason) {
          failed = true
          signal.throwIfAborted()
          if (reason instanceof SourceCallError && reason.code === 'BACKGROUND_PAUSED') throw reason
        }
      }
    }
    if (!fulfilled && firstError) throw firstError
    if (sources.length && !failed) {
      if (misses.size >= 2000) misses.clear()
      misses.set(missKey, Date.now() + 5 * 60 * 1000)
    }
    return { path: null }
  })
  pending.set(key, work)
  try {
    return await work
  } finally {
    if (pending.get(key) === work) pending.delete(key)
  }
}
