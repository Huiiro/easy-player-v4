import { t } from '../i18n'
import type { SourceErrorCode, SourceFailure } from '../../shared/networkSources'

const messages = {
  TIMEOUT: 'sourceCallTimeout',
  CANCELLED: 'sourceCallCancelled',
  SOURCE_DISABLED: 'networkSourceDisabled',
  SOURCE_NOT_FOUND: 'networkSourceUnknown',
  UNSUPPORTED_CAPABILITY: 'sourceCallUnsupported',
  NETWORK: 'sourceCallNetwork',
  AUTH_REQUIRED: 'sourceCallAccessDenied',
  RATE_LIMITED: 'sourceCallRateLimited',
  RESOURCE_NOT_FOUND: 'sourceCallNotFound',
  INVALID_RESPONSE: 'sourceCallInvalidResponse',
  INVALID_REQUEST: 'sourceCallInvalidRequest',
  BACKGROUND_PAUSED: 'sourceCallBackgroundPaused',
  PROVIDER_ERROR: 'sourceCallFailed'
} as const

export class SourceCallError extends Error {
  readonly name = 'SourceCallError'
  readonly retryable: boolean
  constructor(
    readonly code: SourceErrorCode,
    readonly sourceId?: string,
    readonly operation?: string,
    options?: ErrorOptions
  ) {
    super(t(messages[code], { source: sourceId ?? '' }), options)
    this.retryable = ['TIMEOUT', 'NETWORK', 'RATE_LIMITED', 'PROVIDER_ERROR'].includes(code)
  }
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
export function normalizeSourceError(
  reason: unknown,
  sourceId?: string,
  operation?: string
): SourceCallError {
  const error = object(reason)
  if (
    reason instanceof SourceCallError ||
    (error.name === 'SourceCallError' &&
      typeof error.code === 'string' &&
      Object.hasOwn(messages, error.code))
  ) {
    const known = reason as SourceCallError
    return new SourceCallError(
      known.code,
      sourceId ?? known.sourceId,
      operation ?? known.operation,
      { cause: reason }
    )
  }
  const response = object(error.response)
  const status = Number(
    error.status ?? error.statusCode ?? response.status ?? object(error.body).code
  )
  const nativeCode = String(error.code ?? object(error.cause).code ?? '')
  let code: SourceErrorCode = 'PROVIDER_ERROR'
  if (error.name === 'AbortError') code = 'CANCELLED'
  else if (
    error.name === 'TimeoutError' ||
    [
      'ETIMEDOUT',
      'ESOCKETTIMEDOUT',
      'ECONNABORTED',
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_HEADERS_TIMEOUT'
    ].includes(nativeCode)
  )
    code = 'TIMEOUT'
  else if (status === 401 || status === 403) code = 'AUTH_REQUIRED'
  else if (status === 429) code = 'RATE_LIMITED'
  else if (status === 404) code = 'RESOURCE_NOT_FOUND'
  else if (error.name === 'SyntaxError') code = 'INVALID_RESPONSE'
  else if (
    [
      'ENOTFOUND',
      'EAI_AGAIN',
      'ECONNRESET',
      'ECONNREFUSED',
      'ENETUNREACH',
      'EHOSTUNREACH',
      'UND_ERR_SOCKET'
    ].includes(nativeCode) ||
    (error.name === 'TypeError' && /fetch/i.test(String(error.message)))
  )
    code = 'NETWORK'
  return new SourceCallError(code, sourceId, operation, { cause: reason })
}
export function sourceFailure(reason: unknown): SourceFailure {
  const error = normalizeSourceError(reason)
  return {
    code: error.code,
    message: error.message,
    retryable: error.retryable,
    sourceId: error.sourceId,
    operation: error.operation
  }
}
