import { Worker } from 'node:worker_threads'
import { join } from 'node:path'
import type Database from 'better-sqlite3'
import { isPlaybackOnly, onPlaybackModeChanged } from '../service/playbackMode'
import { Logger } from '../service/loggerService'
import { buildBasicSearchTerms } from './searchTokens'
import type { SearchFields, SearchTerms } from './searchTokens'
import {
  commitSearchTerms,
  pendingSearchRows,
  queueOutdatedSearchIndexes,
  readSearchIndexCounts
} from './searchIndexStore'
import type { SearchIndexStatus } from '../../shared/searchIndex'

type WorkerResult = { requestId: number; terms: SearchTerms; complete: boolean; error?: string }

export function startSearchIndexService(
  db: Database.Database,
  onChanged: () => void,
  onStatusChanged: (status: SearchIndexStatus) => void = () => {}
): { stop: () => void; getStatus: () => SearchIndexStatus } {
  queueOutdatedSearchIndexes(db)
  let stopped = false
  let worker: Worker | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let requestId = 0
  let pending:
    { resolve: (result: WorkerResult) => void; reject: (error: Error) => void } | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let loggedFailure = false
  let currentTitle: string | null = null
  let failed = false
  let revision = 0
  let lastPublished = ''
  let lastPublishedAt = 0

  const changeCount = db.prepare('SELECT total_changes() AS changes')
  let cachedCounts: ReturnType<typeof readSearchIndexCounts> | undefined
  let lastChanges = -1
  let lastDataVersion: unknown
  function getCounts(): ReturnType<typeof readSearchIndexCounts> {
    const { changes } = changeCount.get() as { changes: number }
    const dataVersion = db.pragma('data_version', { simple: true })
    if (
      !cachedCounts ||
      changes !== lastChanges ||
      dataVersion !== lastDataVersion ||
      (cachedCounts.nextRetryAt !== null && cachedCounts.nextRetryAt <= Date.now())
    ) {
      cachedCounts = readSearchIndexCounts(db)
      lastChanges = changes
      lastDataVersion = dataVersion
    }
    return cachedCounts
  }

  function getStatus(): SearchIndexStatus {
    // Large-library counts stay cached until a DB write or a retry deadline.
    const counts = getCounts()
    const phase: SearchIndexStatus['phase'] = !counts.pending
      ? 'ready'
      : isPlaybackOnly()
        ? 'paused'
        : failed
          ? 'error'
          : currentTitle !== null
            ? 'indexing'
            : counts.ready
              ? 'queued'
              : 'retrying'
    return {
      phase,
      total: counts.total,
      completed: Math.max(0, counts.total - counts.pending),
      indexed: counts.indexed,
      pending: counts.pending,
      retrying: counts.retrying,
      nextRetryAt: counts.nextRetryAt,
      currentTitle,
      revision
    }
  }

  function publish(force = false): void {
    if (stopped || (!force && Date.now() - lastPublishedAt < 250)) return
    const status = getStatus()
    const serialized = JSON.stringify({ ...status, revision: 0 })
    if (serialized === lastPublished) return
    lastPublished = serialized
    lastPublishedAt = Date.now()
    onStatusChanged({ ...status, revision: ++revision })
  }
  const offPlaybackMode = onPlaybackModeChanged(() => publish(true))

  function fail(error: Error): void {
    if (timeout) clearTimeout(timeout)
    timeout = undefined
    pending?.reject(error)
    pending = undefined
    const previous = worker
    worker = undefined
    void previous?.terminate()
  }

  function convert(fields: SearchFields): Promise<WorkerResult> {
    if (!worker) {
      worker = new Worker(join(__dirname, 'searchWorker.js'))
      const active = worker
      worker.on('message', (result: WorkerResult) => {
        if (worker !== active || result.requestId !== requestId) return
        if (timeout) clearTimeout(timeout)
        timeout = undefined
        const task = pending
        pending = undefined
        if (result.error) task?.reject(new Error(result.error))
        else task?.resolve(result)
      })
      worker.on('error', (error) => {
        if (worker === active) fail(error)
      })
      worker.on('exit', (code) => {
        if (worker === active) fail(new Error(`Search worker exited (${code})`))
      })
    }
    return new Promise((resolve, reject) => {
      pending = { resolve, reject }
      timeout = setTimeout(() => fail(new Error('Search conversion timed out')), 60_000)
      worker!.postMessage({ requestId: ++requestId, fields })
    })
  }

  async function run(): Promise<void> {
    if (stopped) return
    let changed = false
    try {
      publish(true)
      if (!isPlaybackOnly()) {
        let firstInBatch = true
        for (const row of pendingSearchRows(db)) {
          if (stopped || isPlaybackOnly()) break
          currentTitle = row.title
          failed = false
          publish(firstInBatch)
          firstInBatch = false
          const fields: SearchFields = {
            title: row.title,
            artist: row.artist,
            album: row.album,
            fileName: row.fileName
          }
          let result: WorkerResult
          try {
            result = await convert(fields)
          } catch (error) {
            if (!loggedFailure && !stopped)
              Logger.warn('[Search] worker conversion failed', String(error))
            loggedFailure = true
            result = { requestId, terms: buildBasicSearchTerms(fields), complete: false }
          }
          if (stopped) return
          if (!result.complete && !loggedFailure) {
            Logger.warn(
              '[Search] Japanese readings unavailable; basic terms saved, retry scheduled'
            )
            loggedFailure = true
          }
          changed = commitSearchTerms(db, row, result.terms, result.complete) || changed
          currentTitle = null
        }
      }
      if (changed && !stopped) onChanged()
    } catch (error) {
      failed = true
      if (!stopped) Logger.warn('[Search] index batch failed', String(error))
    } finally {
      if (!stopped) {
        currentTitle = null
        publish(true)
        timer = setTimeout(() => void run(), 1000)
        timer.unref()
      }
    }
  }
  timer = setTimeout(() => void run(), 1000)
  timer.unref()
  publish(true)
  function stop(): void {
    stopped = true
    offPlaybackMode()
    if (timer) clearTimeout(timer)
    fail(new Error('Search indexing stopped'))
  }
  return { stop, getStatus: () => ({ ...getStatus(), revision: ++revision }) }
}
