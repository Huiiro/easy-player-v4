import { performance } from 'node:perf_hooks'
import { types } from 'node:util'
import { Logger } from './loggerService'

type LogContext = Record<string, unknown>
interface OperationOptions {
  quiet?: boolean
  successLevel?: 'debug' | 'info'
  warnOnFalse?: boolean
  cancellationExpected?: boolean
}
let nextOperationId = 1

/** Keep credentials and signed URL queries out of diagnostic context. */
export function logUrl(value: string): string {
  try {
    const url = new URL(value)
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return '[invalid URL]'
  }
}

function redactUrls(value: string): string {
  return value.replace(/https?:\/\/[^\s"'<>]+/g, logUrl)
}

export function logError(error: unknown): unknown {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: redactUrls(error.message),
      stack: error.stack ? redactUrls(error.stack) : undefined,
      code: (error as NodeJS.ErrnoException).code
    }
  }
  return typeof error === 'string' ? redactUrls(error) : 'Non-Error exception'
}

/** Summarize known IPC fields; never serialize settings, metadata or credentials. */
export function logParams(value: unknown): LogContext {
  if (!value || typeof value !== 'object') return { parameterType: typeof value }
  const params = value as Record<string, unknown>
  const summary: LogContext = {}
  for (const key of [
    'id',
    'songId',
    'sourceId',
    'playlistId',
    'tagId',
    'folderId',
    'key',
    'backend',
    'deviceId',
    'filePath',
    'audioPath',
    'directory',
    'positionMs',
    'volume',
    'db',
    'enabled',
    'included',
    'deleteLocalFiles',
    'page',
    'pageSize',
    'limit',
    'platform',
    'type',
    'quality',
    'source',
    'provider'
  ]) {
    const item = params[key]
    if (typeof item === 'string') summary[key] = item.slice(0, 512)
    else if (typeof item === 'number' || typeof item === 'boolean') summary[key] = item
  }
  for (const key of ['ids', 'songIds', 'bands', 'nodes', 'items', 'parts']) {
    if (Array.isArray(params[key])) summary[`${key}Count`] = params[key].length
  }
  for (const key of ['input', 'config', 'metadata', 'analysis']) {
    if (params[key] && typeof params[key] === 'object')
      summary[`${key}Fields`] = Object.keys(params[key]).slice(0, 32)
  }
  return summary
}

function resultSummary(value: unknown, depth = 0): LogContext {
  if (Array.isArray(value)) return { resultCount: value.length }
  if (value === null) return { result: 'null' }
  if (typeof value === 'boolean' || typeof value === 'number') return { result: value }
  if (!value || typeof value !== 'object') return {}
  const result = value as Record<string, unknown>
  const summary: LogContext = {}
  for (const key of [
    'success',
    'cancelled',
    'added',
    'skipped',
    'total',
    'duplicates',
    'recovered',
    'imported',
    'reloaded',
    'failed',
    'count',
    'state',
    'version',
    'status',
    'ok'
  ]) {
    const item = result[key]
    if (typeof item === 'number' || typeof item === 'boolean') summary[key] = item
    else if (typeof item === 'string') summary[key] = item.slice(0, 128)
    else if (Array.isArray(item)) summary[`${key}Count`] = item.length
  }
  if (depth < 2 && result.data !== undefined && result.data !== value)
    summary.data = resultSummary(result.data, depth + 1)
  if (result.success === false && typeof result.error === 'string')
    summary.reason = redactUrls(result.error).slice(0, 1024)
  return summary
}

/** Preserve synchronous returns and promise rejections while recording outcomes. */
export function logOperation<T>(
  name: string,
  context: LogContext,
  operation: () => T,
  options: OperationOptions = {}
): T {
  const operationId = nextOperationId++
  const started = performance.now()
  const details = (): LogContext => ({
    ...context,
    operationId,
    elapsedMs: Math.round((performance.now() - started) * 100) / 100
  })
  if (!options.quiet) Logger.debug(`${name} begin`, { ...context, operationId })
  const completed = (value: unknown): void => {
    const response = value && typeof value === 'object' ? (value as Record<string, unknown>) : null
    const failed = (options.warnOnFalse && value === false) || response?.success === false
    const cancelled =
      response?.cancelled === true ||
      (options.cancellationExpected && response?.success === false && !response.error)
    if (failed && !cancelled) {
      Logger.warn(`${name} returned failure`, details(), resultSummary(value))
    } else if (!options.quiet) {
      Logger[options.successLevel ?? 'debug'](`${name} completed`, details(), resultSummary(value))
    }
  }
  const failed = (error: unknown): never => {
    Logger.error(`${name} exception`, details(), logError(error))
    throw error
  }
  let value: T
  try {
    value = operation()
  } catch (error) {
    return failed(error)
  }
  if (types.isPromise(value)) {
    return value.then((result) => {
      completed(result)
      return result
    }, failed) as T
  }
  completed(value)
  return value
}
