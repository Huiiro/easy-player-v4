import { computed, ref, watch, onScopeDispose, type Ref, type ComputedRef } from 'vue'
import { useUIStore } from '@/stores/ui/uiStore'

const cache = new Map<string, { path: string | null; expires: number }>()
const pending = new Map<string, { work: Promise<string | null>; consumers: Set<() => boolean> }>()
const cacheEpoch = ref(0)
let subscribed = false
function connectCacheNotifications(): void {
  if (subscribed) return
  subscribed = true
  window.api.metadata.onArtistArtworkCacheCleared(() => {
    cache.clear()
    pending.clear()
    cacheEpoch.value++
  })
}
let active = 0
const queue: (() => void)[] = []
export const artistArtworkKey = (name: string): string =>
  name.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ')
async function resolve(name: string, shouldRun: () => boolean): Promise<string | null> {
  const epoch = cacheEpoch.value
  const key = artistArtworkKey(name)
  const cached = cache.get(key)
  if (cached && cached.expires > Date.now()) return cached.path
  const current = pending.get(key)
  if (current) {
    current.consumers.add(shouldRun)
    return current.work
  }
  const consumers = new Set([shouldRun])
  const work = (async () => {
    if (active >= 2) await new Promise<void>((done) => queue.push(done))
    active++
    try {
      if (![...consumers].some((check) => check())) return null
      const result = await window.api.metadata.resolveArtistArtwork(name)
      if (epoch !== cacheEpoch.value) return null
      const path = result.success ? (result.data?.path ?? null) : null
      if (result.success) cache.set(key, { path, expires: Date.now() + (path ? 86400000 : 30000) })
      return path
    } catch {
      return null
    } finally {
      active--
      queue.shift()?.()
    }
  })()
  pending.set(key, { work, consumers })
  try {
    return await work
  } finally {
    if (pending.get(key)?.work === work) pending.delete(key)
  }
}
export function useArtistArtwork(
  name: Ref<string>,
  visible: Ref<boolean>
): {
  networkPath: Ref<string | null>
  useLocal: ComputedRef<boolean>
  toggle: () => void
} {
  connectCacheNotifications()
  const ui = useUIStore()
  const networkPath = ref<string | null>(null)
  const useLocal = computed(() => ui.localArtistArtworkNames.includes(artistArtworkKey(name.value)))
  let revision = 0
  watch(
    [name, visible, () => ui.autoSearchArtistArtwork, useLocal, cacheEpoch],
    async (values, previous) => {
      const token = ++revision
      networkPath.value = null
      if (
        (previous.length > 0 && values[4] !== previous[4]) ||
        !visible.value ||
        !ui.autoSearchArtistArtwork ||
        !name.value.trim() ||
        name.value.startsWith('__easy_player_unknown_') ||
        useLocal.value
      )
        return
      const path = await resolve(name.value, () => token === revision)
      if (token === revision) networkPath.value = path
    },
    { immediate: true }
  )
  onScopeDispose(() => {
    revision++
  })
  function toggle(): void {
    const key = artistArtworkKey(name.value)
    ui.localArtistArtworkNames = useLocal.value
      ? ui.localArtistArtworkNames.filter((value) => value !== key)
      : [...ui.localArtistArtworkNames, key]
  }
  return { networkPath, useLocal, toggle }
}
