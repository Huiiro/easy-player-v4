import { computed, ref, watch, type Ref, type ComputedRef } from 'vue'
import { useUIStore } from '@/stores/ui/uiStore'

const cache = new Map<string, { path: string | null; expires: number }>()
const MAX_CACHE_ENTRIES = 512
const MAX_ACTIVE_REQUESTS = 2
interface Request {
  key: string
  name: string
  work: Promise<string | null>
  finish: (path: string | null) => void
  consumers: number
}
const pending = new Map<string, Request>()
const queue = new Set<Request>()
let active = 0
const cacheEpoch = ref(0)
let subscribed = false
function connectCacheNotifications(): void {
  if (subscribed) return
  subscribed = true
  window.api.metadata.onArtistArtworkCacheCleared(() => {
    cache.clear()
    pending.clear()
    for (const request of queue) request.finish(null)
    queue.clear()
    cacheEpoch.value++
  })
}
export const artistArtworkKey = (name: string): string =>
  name.normalize('NFKC').trim().toLocaleLowerCase().replace(/\s+/g, ' ')

async function load(request: Request): Promise<void> {
  const { key, name } = request
  let path: string | null = null
  try {
    const result = await window.api.metadata.resolveArtistArtwork(name)
    if (result.success && pending.get(key) === request) {
      path = result.data?.path ?? null
      cache.set(key, { path, expires: Date.now() + (path ? 86400000 : 30000) })
      if (cache.size > MAX_CACHE_ENTRIES) {
        const oldest = cache.keys().next().value
        if (oldest !== undefined) cache.delete(oldest)
      }
    }
  } catch {
    // Keep the local cover on request failure.
  } finally {
    if (pending.get(key) === request) pending.delete(key)
    request.finish(path)
    active--
    startQueued()
  }
}

function startQueued(): void {
  while (active < MAX_ACTIVE_REQUESTS) {
    const request = queue.values().next().value
    if (!request) return
    queue.delete(request)
    active++
    void load(request)
  }
}

function resolve(name: string, onCleanup: (cleanup: () => void) => void): Promise<string | null> {
  const key = artistArtworkKey(name)
  const cached = cache.get(key)
  if (cached) {
    cache.delete(key)
    if (cached.expires > Date.now()) {
      cache.set(key, cached)
      return Promise.resolve(cached.path)
    }
  }
  let request = pending.get(key)
  if (!request) {
    const { promise, resolve: finish } = Promise.withResolvers<string | null>()
    request = { key, name, work: promise, finish, consumers: 0 }
    pending.set(key, request)
    queue.add(request)
  }
  const subscribed = request
  subscribed.consumers++
  onCleanup(() => {
    subscribed.consumers--
    if (!subscribed.consumers && queue.delete(subscribed)) {
      pending.delete(key)
      subscribed.finish(null)
    }
  })
  startQueued()
  return subscribed.work
}
export function useArtistArtwork(
  name: Ref<string>,
  visible: Ref<boolean>
): {
  networkPath: Ref<string | null>
  useLocal: ComputedRef<boolean>
  toggle: () => void
} {
  const ui = useUIStore()
  const networkPath = ref<string | null>(null)
  const useLocal = computed(() => ui.localArtistArtworkNames.includes(artistArtworkKey(name.value)))
  watch(
    [name, visible, () => ui.autoSearchArtistArtwork, useLocal, cacheEpoch],
    async (values, previous, onCleanup) => {
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
      connectCacheNotifications()
      let current = true
      onCleanup(() => {
        current = false
      })
      const path = await resolve(name.value, onCleanup)
      if (current) networkPath.value = path
    },
    { immediate: true }
  )
  function toggle(): void {
    const key = artistArtworkKey(name.value)
    ui.localArtistArtworkNames = useLocal.value
      ? ui.localArtistArtworkNames.filter((value) => value !== key)
      : [...ui.localArtistArtworkNames, key]
  }
  return { networkPath, useLocal, toggle }
}
