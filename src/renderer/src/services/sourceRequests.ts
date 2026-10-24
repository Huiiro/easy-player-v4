import type { SourceRequestOptions } from '../../../shared/networkSources'

interface PendingRequest {
  options: SourceRequestOptions
  isCurrent(): boolean
  finish(): void
}

// Only plain request IDs cross the bridge. Each slot owns one replaceable request.
export function createSourceRequestScope(): {
  start(slot: string): PendingRequest
  cancel(slot: string): void
  cancelAll(): void
} {
  const pending = new Map<string, string>()
  function cancel(slot: string): void {
    const requestId = pending.get(slot)
    if (!requestId) return
    pending.delete(slot)
    void window.api.networkSources.cancelRequest(requestId).catch(() => {})
  }
  function cancelAll(): void {
    for (const slot of pending.keys()) cancel(slot)
  }
  return {
    cancel,
    cancelAll,
    start(slot) {
      cancel(slot)
      const requestId = crypto.randomUUID()
      pending.set(slot, requestId)
      return {
        options: { requestId },
        isCurrent: () => pending.get(slot) === requestId,
        finish() {
          if (pending.get(slot) === requestId) pending.delete(slot)
        }
      }
    }
  }
}
