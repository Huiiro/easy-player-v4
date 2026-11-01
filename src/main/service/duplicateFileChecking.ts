import { lstat } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { isPlaybackOnly, waitForBackgroundWork } from './playbackMode'
import type { DuplicateFileProgress, DuplicateFileSong } from '../../shared/duplicateFiles'

export const FILE_CHECK_CONCURRENCY = 8

/** Bounded metadata I/O. Preserve input order so scheduling cannot invalidate report caches. */
export async function checkDuplicateFileStates(
  songs: readonly DuplicateFileSong[],
  progress: (value: DuplicateFileProgress) => void,
  externalSignal?: AbortSignal,
  options: { concurrency?: number; stat?: (file: string) => Promise<Stats> } = {}
): Promise<{
  files: Array<{ song: DuplicateFileSong; stat: Stats }>
  skipped: Array<{ path: string; reason: 'unavailable' | 'sidecar' }>
  slowFiles: Array<{ path: string; elapsedMs: number }>
  concurrency: number
}> {
  const controller = new AbortController()
  const signal = controller.signal
  const forwardAbort = (): void => controller.abort(externalSignal?.reason)
  if (externalSignal?.aborted) forwardAbort()
  else externalSignal?.addEventListener('abort', forwardAbort, { once: true })
  const concurrency = Math.min(
    16,
    Math.max(1, Math.floor(options.concurrency || FILE_CHECK_CONCURRENCY))
  )
  const statFile = options.stat ?? lstat
  const results = new Array<{ song: DuplicateFileSong; stat: Stats }>(songs.length)
  const skipped = new Array<{ path: string; reason: 'unavailable' | 'sidecar' }>(songs.length)
  const seen = new Set<string>()
  const active = new Map<number, string>()
  const slowFiles: Array<{ path: string; elapsedMs: number }> = []
  let next = 0
  let completed = 0
  let failed = false
  let failure: unknown
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastProgressAt = 0
  const emit = (force = false): void => {
    if (signal?.aborted || failed) return
    const now = performance.now()
    if (!force && now - lastProgressAt < 100) return
    lastProgressAt = now
    progress({
      phase: 'checking',
      current: completed,
      total: songs.length,
      currentPath: active.values().next().value,
      activeChecks: active.size,
      waitingForPlayback: isPlaybackOnly?.() === true
    })
  }
  const heartbeat = (): void => {
    try {
      emit(true)
    } catch (error) {
      failed = true
      failure = error
      controller.abort(error)
    }
    if (!signal.aborted && !failed) timer = setTimeout(heartbeat, 1000)
  }
  const worker = async (): Promise<void> => {
    try {
      while (!failed) {
        signal?.throwIfAborted()
        await waitForBackgroundWork(signal)
        signal?.throwIfAborted()
        if (failed) return
        const index = next++
        if (index >= songs.length) return
        const song = songs[index]
        const resolved = path.resolve(song.audio)
        const key = process.platform === 'win32' ? resolved.toLowerCase() : resolved
        if (!seen.has(key)) {
          seen.add(key)
          if (
            resolved.split(/[\\/]/).some((part) => part.toLowerCase() === '__macosx') ||
            path.basename(resolved).startsWith('._')
          ) {
            skipped[index] = { path: song.audio, reason: 'sidecar' }
            completed++
            emit(completed === songs.length)
            continue
          }
          active.set(index, song.audio)
          emit()
          const startedAt = performance.now()
          try {
            const stat = await statFile(song.audio)
            signal?.throwIfAborted()
            if (failed) return
            if (!stat.isFile() || stat.size === 0) throw new Error('Unavailable audio file')
            results[index] = { song, stat }
          } catch {
            signal?.throwIfAborted()
            if (failed) return
            skipped[index] = { path: song.audio, reason: 'unavailable' }
          } finally {
            active.delete(index)
            const elapsedMs = performance.now() - startedAt
            if (elapsedMs >= 1000) {
              slowFiles.push({ path: song.audio, elapsedMs })
              slowFiles.sort((a, b) => b.elapsedMs - a.elapsedMs)
              slowFiles.length = Math.min(slowFiles.length, 5)
            }
          }
        }
        completed++
        emit(completed === songs.length)
      }
    } catch (error) {
      if (!failed) {
        failed = true
        failure = error
        controller.abort(error)
      }
    }
  }
  try {
    signal?.throwIfAborted()
    emit(true)
    timer = setTimeout(heartbeat, 1000)
    await Promise.allSettled(Array.from({ length: Math.min(concurrency, songs.length) }, worker))
    if (failed) throw failure
    signal?.throwIfAborted()
    return {
      files: results.filter(Boolean),
      skipped: skipped.filter(Boolean),
      slowFiles,
      concurrency
    }
  } finally {
    clearTimeout(timer)
    externalSignal?.removeEventListener('abort', forwardAbort)
  }
}
