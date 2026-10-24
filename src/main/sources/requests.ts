import { randomUUID } from 'node:crypto'
import type { WebContents } from 'electron'
import { SourceCallError } from './errors'
import type { SourceRequestOptions } from '../../shared/networkSources'

const owners = new Map<number, { calls: Map<string, AbortController>; destroy: () => void }>()
const validId = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-zA-Z0-9:._-]{1,128}$/.test(value)
export function cancelSourceRequest(ownerId: number, requestId: unknown): boolean {
  if (!validId(requestId)) return false
  const controller = owners.get(ownerId)?.calls.get(requestId)
  if (!controller) return false
  controller.abort()
  return true
}
export async function withSourceRequest<T>(
  owner: WebContents,
  options: SourceRequestOptions,
  task: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const requestId = options?.requestId ?? randomUUID()
  if (!validId(requestId)) throw new SourceCallError('INVALID_REQUEST')
  if (owner.isDestroyed()) throw new SourceCallError('CANCELLED')
  let state = owners.get(owner.id)
  if (!state) {
    const calls = new Map<string, AbortController>()
    const destroy = (): void => {
      for (const controller of calls.values()) controller.abort()
      owners.delete(owner.id)
    }
    state = { calls, destroy }
    owners.set(owner.id, state)
    owner.once('destroyed', destroy)
  }
  if (state.calls.has(requestId) || state.calls.size >= 64)
    throw new SourceCallError('INVALID_REQUEST')
  const controller = new AbortController()
  state.calls.set(requestId, controller)
  try {
    const result = await task(controller.signal)
    if (controller.signal.aborted) throw new SourceCallError('CANCELLED')
    return result
  } finally {
    state.calls.delete(requestId)
    if (!state.calls.size) {
      owner.removeListener('destroyed', state.destroy)
      owners.delete(owner.id)
    }
  }
}
