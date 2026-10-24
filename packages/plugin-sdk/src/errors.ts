import type { SourceErrorCode } from './networkSources'

/** Stable codes cross the host boundary; UI localization belongs to the host. */
export class SourceCallError extends Error {
  readonly name = 'SourceCallError'
  readonly retryable: boolean
  constructor(
    readonly code: SourceErrorCode,
    readonly sourceId?: string,
    readonly operation?: string,
    options?: ErrorOptions
  ) {
    super(code, options)
    this.retryable = ['TIMEOUT', 'NETWORK', 'RATE_LIMITED', 'PROVIDER_ERROR'].includes(code)
  }
}
