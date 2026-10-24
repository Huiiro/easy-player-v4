import type { SourceCallContext } from '../sources/types'

// Only a host-accepted download resolution may outlive its plugin activation.
const downloads = new WeakMap<SourceCallContext, string>()
export function leaseDownloadCall(call: SourceCallContext, pluginId: string): () => void {
  downloads.set(call, pluginId)
  return () => downloads.delete(call)
}
export function hasDownloadLease(call: SourceCallContext | undefined, pluginId: string): boolean {
  return !!call && downloads.get(call) === pluginId
}
