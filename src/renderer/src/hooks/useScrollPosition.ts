import {
  computed,
  nextTick,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  readonly,
  ref,
  watch,
  type Ref
} from 'vue'

interface ScrollPosition {
  top: number
  left: number
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useScrollPosition(
  scrollContainer: Readonly<Ref<HTMLElement | null>>,
  storageKey: Readonly<Ref<string>>,
  options: { ready?: Readonly<Ref<boolean>>; onRestore?: () => void } = {}
) {
  const ready = options.ready ?? computed(() => true)
  let key = storageKey.value
  let active = true
  let disposed = false
  let saveFrame = 0
  let restoreFrame = 0
  let revision = 0
  const restoring = ref(false)
  let restored = false
  let finishRestore: (() => void) | undefined

  function readPosition(): ScrollPosition {
    try {
      const raw = sessionStorage.getItem(key)
      const value = raw ? JSON.parse(raw) : 0
      // Existing card-grid positions were stored as a single number.
      const top = typeof value === 'number' ? value : value?.top
      const left = typeof value === 'number' ? 0 : value?.left
      return {
        top: Number.isFinite(top) && top > 0 ? top : 0,
        left: Number.isFinite(left) && left > 0 ? left : 0
      }
    } catch {
      return { top: 0, left: 0 }
    }
  }
  let position = readPosition()
  function persist(): void {
    try {
      sessionStorage.setItem(key, JSON.stringify(position))
    } catch {
      // Position remains available to the cached instance without storage.
    }
  }
  function capture(): void {
    const container = scrollContainer.value
    if (active && ready.value && restored && !restoring.value && container?.isConnected) {
      position = { top: container.scrollTop, left: container.scrollLeft }
    }
  }
  function cancelRestore(): void {
    revision++
    cancelAnimationFrame(restoreFrame)
    restoreFrame = 0
    restoring.value = false
    finishRestore?.()
    finishRestore = undefined
  }
  function flushSave(): void {
    cancelAnimationFrame(saveFrame)
    saveFrame = 0
    persist()
  }
  function syncKey(): void {
    if (key === storageKey.value) return
    capture()
    flushSave()
    cancelRestore()
    key = storageKey.value
    position = readPosition()
    restored = false
  }
  function saveScrollPosition(): void {
    syncKey()
    capture()
    flushSave()
  }
  function setScrollPosition(next: ScrollPosition): void {
    const container = scrollContainer.value
    if (disposed || !active || !container?.isConnected) return
    syncKey()
    // A deliberate layout anchor supersedes an in-flight storage restore.
    cancelRestore()
    container.scrollTo({ top: next.top, left: next.left, behavior: 'auto' })
    position = { top: container.scrollTop, left: container.scrollLeft }
    restored = true
    options.onRestore?.()
    flushSave()
  }
  function scheduleScrollPositionSave(): void {
    if (!active || !ready.value || restoring.value || !restored) return
    syncKey()
    // Capture in the event itself: detaching a cached page can clamp its DOM to 0.
    capture()
    if (saveFrame) return
    saveFrame = requestAnimationFrame(() => {
      saveFrame = 0
      persist()
    })
  }
  async function restoreScrollPosition(): Promise<void> {
    syncKey()
    cancelRestore()
    if (disposed || !active) return
    const current = revision
    restoring.value = true
    await nextTick()
    if (disposed || !active || current !== revision) return
    // Explicit restoration is awaited by list loaders before revealing content.
    // Virtual scrollers need bounded frames to measure the patched item list.
    await new Promise<void>((resolve) => {
      finishRestore = resolve
      restoreFrame = requestAnimationFrame(() => {
        restoreFrame = requestAnimationFrame(() => {
          restoreFrame = 0
          if (disposed || !active || current !== revision) {
            resolve()
            return
          }
          const container = scrollContainer.value
          if (container?.isConnected) {
            container.scrollTo({ top: position.top, left: position.left, behavior: 'auto' })
            position = { top: container.scrollTop, left: container.scrollLeft }
            restored = true
            options.onRestore?.()
          }
          void nextTick(() => {
            if (current === revision) {
              restoring.value = false
              finishRestore = undefined
            }
            resolve()
          })
        })
      })
    })
  }
  function restoreWhenReady(): void {
    if (!ready.value) {
      cancelRestore()
      return
    }
    const container = scrollContainer.value
    if (
      !restored ||
      container?.scrollTop !== position.top ||
      container?.scrollLeft !== position.left
    )
      void restoreScrollPosition()
  }
  function clearSavedScrollPosition(): void {
    syncKey()
    cancelRestore()
    cancelAnimationFrame(saveFrame)
    saveFrame = 0
    position = { top: 0, left: 0 }
    restored = false
    try {
      sessionStorage.removeItem(key)
    } catch {
      // Clearing a position is also supported without session storage.
    }
    restoreWhenReady()
  }
  function suspend(): void {
    saveScrollPosition()
    active = false
    cancelRestore()
  }
  watch(storageKey, syncKey, { flush: 'pre' })
  watch([scrollContainer, ready, storageKey], restoreWhenReady, { flush: 'post' })
  onMounted(() => {
    window.addEventListener('pagehide', saveScrollPosition)
    restoreWhenReady()
  })
  onActivated(() => {
    active = true
    const container = scrollContainer.value
    if (ready.value && container?.isConnected) {
      // Cached content is already laid out: restore before its first paint.
      container.scrollTo({ top: position.top, left: position.left, behavior: 'auto' })
      if (container.scrollTop === position.top && container.scrollLeft === position.left)
        restored = true
    }
    if (ready.value) void restoreScrollPosition()
    else cancelRestore()
  })
  onDeactivated(suspend)
  onBeforeUnmount(() => {
    suspend()
    disposed = true
    window.removeEventListener('pagehide', saveScrollPosition)
  })
  return {
    isRestoringScroll: readonly(restoring),
    saveScrollPosition,
    setScrollPosition,
    scheduleScrollPositionSave,
    clearSavedScrollPosition,
    restoreScrollPosition
  }
}
