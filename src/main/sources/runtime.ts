import { setTimeout, clearTimeout } from 'node:timers'
import { getNetworkSources } from './index'
import { isPlaybackOnly, onPlaybackModeChanged } from '../service/playbackMode'
import { SourceCallError, normalizeSourceError, sourceFailure } from './errors'
import type { NetworkSource, SourceCallContext } from './types'
import type { NetworkSourceCapability, SourceFailure } from '../../shared/networkSources'
import { leaseDownloadCall } from '../plugins/callLeases'

export type SourceOperation =
  | 'lyrics.search'
  | 'lyrics.get'
  | 'artwork.search'
  | 'metadata.search'
  | 'metadata.get'
  | 'download.search'
  | 'download.parse'
  | 'download.resolve'
export interface SourceCallOptions {
  signal?: AbortSignal
  timeoutMs?: number
}
interface CallLog {
  id: number
  sourceId?: string
  operation: string
  elapsedMs: number
  status: 'success' | 'failed' | 'cancelled'
  failure?: SourceFailure
}
let logCall: (entry: CallLog) => void = () => {}
let nextId = 0
const active = new Set<{ sourceId?: string; operation: string; controller: AbortController }>()
export function setSourceCallLogger(logger: (entry: CallLog) => void): void {
  logCall = logger
}
export function cancelSourceCalls(sourceId: string): void {
  for (const call of active) {
    // An accepted download task owns its resolution; disabling a source does not cancel that task.
    if (call.sourceId === sourceId && call.operation !== 'download.resolve')
      call.controller.abort(new SourceCallError('SOURCE_DISABLED', sourceId, call.operation))
  }
}
const timeouts: Record<string, number> = {
  'lyrics.search': 20000,
  'lyrics.get': 15000,
  'artwork.search': 15000,
  'metadata.search': 15000,
  'metadata.get': 25000,
  'download.search': 60000,
  'download.parse': 60000,
  'download.resolve': 30000,
  'artwork.fetch': 20000
}
async function execute<T>(
  sourceId: string | undefined,
  operation: string,
  task: (context: SourceCallContext) => Promise<T>,
  options: SourceCallOptions
): Promise<T> {
  const id = ++nextId,
    started = Date.now()
  const controller = new AbortController()
  const call = { sourceId, operation, controller }
  let timer: ReturnType<typeof setTimeout> | undefined
  let unsubscribe: (() => void) | undefined
  let onAbort: (() => void) | undefined
  const parentAbort = (): void => {
    const reason = options.signal?.reason
    controller.abort(
      reason?.name === 'SourceCallError'
        ? reason
        : new SourceCallError('CANCELLED', sourceId, operation)
    )
  }
  let failure: SourceFailure | undefined
  try {
    if (options.signal?.aborted) {
      parentAbort()
      controller.signal.throwIfAborted()
    }
    if (isPlaybackOnly()) throw new SourceCallError('BACKGROUND_PAUSED', sourceId, operation)
    const timeoutMs =
      options.timeoutMs !== undefined && Number.isFinite(options.timeoutMs)
        ? Math.max(1, Math.min(120000, options.timeoutMs))
        : (timeouts[operation] ?? 20000)
    active.add(call)
    options.signal?.addEventListener('abort', parentAbort, { once: true })
    unsubscribe = onPlaybackModeChanged((enabled) => {
      if (enabled) controller.abort(new SourceCallError('BACKGROUND_PAUSED', sourceId, operation))
    })
    timer = setTimeout(
      () => controller.abort(new SourceCallError('TIMEOUT', sourceId, operation)),
      timeoutMs
    )
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(controller.signal.reason)
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    const work = Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return task({ signal: controller.signal, deadline: started + timeoutMs, sourceId, operation })
    })
    // Both branches retain rejection handlers, including SDK promises that settle after cancellation.
    const result = await Promise.race([work, aborted])
    controller.signal.throwIfAborted()
    return result
  } catch (reason) {
    const error = normalizeSourceError(
      controller.signal.aborted ? controller.signal.reason : reason,
      sourceId,
      operation
    )
    failure = sourceFailure(error)
    throw error
  } finally {
    if (timer) clearTimeout(timer)
    unsubscribe?.()
    options.signal?.removeEventListener('abort', parentAbort)
    if (onAbort) controller.signal.removeEventListener('abort', onAbort)
    active.delete(call)
    try {
      logCall({
        id,
        sourceId,
        operation,
        elapsedMs: Date.now() - started,
        status: failure ? (failure.code === 'CANCELLED' ? 'cancelled' : 'failed') : 'success',
        failure
      })
    } catch {
      /* Logging must not change a completed call. */
    }
  }
}
function validateResult(operation: SourceOperation, value: unknown): void {
  const object = value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
  if (
    [
      'lyrics.search',
      'artwork.search',
      'metadata.search',
      'download.search',
      'download.parse'
    ].includes(operation)
  ) {
    if (!Array.isArray(value)) throw new SourceCallError('INVALID_RESPONSE')
  } else if (operation === 'metadata.get') {
    if (!object || !object.metadata || typeof object.metadata !== 'object')
      throw new SourceCallError('INVALID_RESPONSE')
  } else if (operation === 'lyrics.get') {
    if (value !== null && (!object || typeof object.lrc !== 'string'))
      throw new SourceCallError('INVALID_RESPONSE')
  } else if (!object || !['http', 'yt-dlp'].includes(String(object.transport)))
    throw new SourceCallError('INVALID_RESPONSE')
}
export function invokeSource<T>(
  sourceId: string,
  operation: SourceOperation,
  task: (source: NetworkSource, context: SourceCallContext) => Promise<T>,
  options: SourceCallOptions = {}
): Promise<T> {
  const registry = getNetworkSources()
  const owner = registry.ownerOf(sourceId)
  const accepted =
    operation === 'download.resolve' && registry.isEnabled(sourceId)
      ? registry.get(sourceId)
      : undefined
  const signals = [
    options.signal,
    ...(operation === 'download.resolve' ? [] : [owner?.signal])
  ].filter((signal): signal is AbortSignal => !!signal)
  const signal = signals.length ? AbortSignal.any(signals) : undefined
  return execute(
    sourceId,
    operation,
    async (context) => {
      const source = accepted ?? registry.requireEnabled(sourceId)
      context.host = owner?.host
      const release =
        owner && operation === 'download.resolve'
          ? leaseDownloadCall(context, owner.pluginId)
          : undefined
      try {
        const [capability, method] = operation.split('.')
        const implementation = source[capability as NetworkSourceCapability] as unknown as
          Record<string, unknown> | undefined
        if (typeof implementation?.[method] !== 'function')
          throw new SourceCallError('UNSUPPORTED_CAPABILITY', sourceId, operation)
        const result = await task(source, context)
        context.signal.throwIfAborted()
        validateResult(operation, result)
        return result
      } finally {
        release?.()
      }
    },
    { ...options, signal }
  )
}
export function invokeArtworkFetch<T>(
  task: (context: SourceCallContext) => Promise<T>,
  options: SourceCallOptions = {}
): Promise<T> {
  return execute(undefined, 'artwork.fetch', task, options)
}
