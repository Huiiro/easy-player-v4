import { nextTick, onBeforeUnmount, type Ref } from 'vue'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useScrollPosition(
  scrollContainer: Ref<HTMLElement | null>,
  storageKey: Readonly<Ref<string>>
) {
  let scrollSaveFrame = 0
  let restoreFrame = 0
  let disposed = false

  function savedScrollTop(): number {
    try {
      const value = Number(sessionStorage.getItem(storageKey.value))
      return Number.isFinite(value) && value > 0 ? value : 0
    } catch {
      return 0
    }
  }
  function saveScrollPosition(): void {
    const container = scrollContainer.value
    if (!container) return
    try {
      sessionStorage.setItem(storageKey.value, String(container.scrollTop))
    } catch {
      // Scroll restoration is optional when session storage is unavailable.
    }
  }
  function scheduleScrollPositionSave(): void {
    if (scrollSaveFrame) return
    scrollSaveFrame = requestAnimationFrame(() => {
      scrollSaveFrame = 0
      saveScrollPosition()
    })
  }
  function clearSavedScrollPosition(): void {
    cancelAnimationFrame(restoreFrame)
    if (scrollSaveFrame) {
      cancelAnimationFrame(scrollSaveFrame)
      scrollSaveFrame = 0
    }
    try {
      sessionStorage.removeItem(storageKey.value)
    } catch {
      // Scroll restoration is optional when session storage is unavailable.
    }
  }
  async function restoreScrollPosition(): Promise<void> {
    const top = savedScrollTop()
    if (!top) return
    await nextTick()
    if (disposed) return
    restoreFrame = requestAnimationFrame(() =>
      scrollContainer.value?.scrollTo({ top, behavior: 'auto' })
    )
  }

  onBeforeUnmount(() => {
    disposed = true
    cancelAnimationFrame(scrollSaveFrame)
    cancelAnimationFrame(restoreFrame)
    saveScrollPosition()
  })
  return {
    saveScrollPosition,
    scheduleScrollPositionSave,
    clearSavedScrollPosition,
    restoreScrollPosition
  }
}
