import type { FingerprintConcurrency } from '../../shared/duplicateFiles'

export function normalizeFingerprintConcurrency(value: unknown): FingerprintConcurrency {
  return value === 1 || value === 4 ? value : 2
}

/** Drain all workers before returning so cancellation cannot leave extraction processes behind. */
export async function runFingerprintTasks<T>(
  items: readonly T[],
  concurrency: FingerprintConcurrency,
  task: (item: T, index: number, signal: AbortSignal) => Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  signal?.throwIfAborted()
  const controller = new AbortController()
  const abort = (): void => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  let next = 0
  let failed = false
  let failure: unknown
  const worker = async (): Promise<void> => {
    try {
      for (;;) {
        controller.signal.throwIfAborted()
        const index = next++
        if (index >= items.length) return
        await task(items[index], index, controller.signal)
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
    await Promise.allSettled(
      Array.from(
        { length: Math.min(normalizeFingerprintConcurrency(concurrency), items.length) },
        worker
      )
    )
    if (failed) throw failure
    signal?.throwIfAborted()
  } finally {
    signal?.removeEventListener('abort', abort)
  }
}
