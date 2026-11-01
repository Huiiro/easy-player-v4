import { stripVTControlCharacters } from 'node:util'
import type {
  FingerprintFailure,
  FingerprintFailureReason
} from '../../shared/duplicateFingerprintErrors'

/** Bound diagnostics and omit URL queries before logs, reports or IPC persistence. */
export function fingerprintDiagnostic(value: unknown): string {
  return stripVTControlCharacters(String(value ?? ''))
    .replace(/(https?:\/\/[^\s?"'<>]+)\?[^\s"'<>]*/g, '$1?[redacted]')
    .slice(-4096)
}
export class FingerprintExtractionError extends Error {
  constructor(
    public reason: FingerprintFailureReason,
    public stderr = '',
    public exitCode?: number | null,
    message: string = reason
  ) {
    super(fingerprintDiagnostic(message))
    this.name = 'FingerprintExtractionError'
    this.stderr = fingerprintDiagnostic(stderr)
  }
}
export function fingerprintFailureDetails(file: string, error: unknown): FingerprintFailure {
  if (error instanceof FingerprintExtractionError)
    return {
      path: file,
      reason: error.reason,
      message: error.message,
      stderr: error.stderr,
      exitCode: error.exitCode
    }
  const message = error instanceof Error ? error.message : String(error)
  const code = (error as NodeJS.ErrnoException | undefined)?.code
  return {
    path: file,
    reason:
      message === 'changed'
        ? 'changed'
        : ['ENOENT', 'EACCES', 'EPERM', 'EIO'].includes(code ?? '')
          ? 'unavailable'
          : 'unknown',
    message: fingerprintDiagnostic(message)
  }
}
