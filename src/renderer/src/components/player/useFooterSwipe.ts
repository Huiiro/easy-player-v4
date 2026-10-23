import { computed, nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { usePlayerStore } from '@/stores/player/playerStore'
import type { LibrarySong } from '@/types/library'
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useFooterSwipe(
  player: ReturnType<typeof usePlayerStore>,
  collapsed: Readonly<Ref<boolean>>,
  reduceMotion: Readonly<Ref<boolean>>
) {
  let suppressClickTimer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  const SWIPE_DISTANCE = 56
  const SWIPE_DIRECTION_RATIO = 1.25
  const SWIPE_SETTLE_DURATION = 240
  const swipeOffset = ref(0)
  const swipeTransitioning = ref(false)
  const swipeCommitting = ref(false)
  const collapsedCarouselRef = ref<HTMLElement | null>(null)
  let swipePointerId: number | null = null
  let swipeStartX = 0
  let swipeStartY = 0
  let swipeWasDragged = false
  let suppressSwipeClick = false
  let swipeSettleTimer: ReturnType<typeof setTimeout> | null = null
  let pendingSwipeTargetIndex: number | null = null
  let pendingSwipeDirection: -1 | 0 | 1 = 0
  const swipePreviousIndex = ref<number | null>(null)
  const swipeNextIndex = ref<number | null>(null)

  function refreshSwipeTargetIndices(): void {
    const previousIndex = player.getPreviousQueueIndex()
    const nextIndex = player.getNextQueueIndex()
    swipePreviousIndex.value = previousIndex >= 0 ? previousIndex : null
    swipeNextIndex.value = nextIndex >= 0 ? nextIndex : null
  }

  function getSwipeTargetIndex(direction: -1 | 1): number | null {
    return direction < 0 ? swipePreviousIndex.value : swipeNextIndex.value
  }

  interface CollapsedSongCard {
    slot: 'previous' | 'current' | 'next'
    song: LibrarySong | null
  }

  const frozenSwipeCards = ref<CollapsedSongCard[] | null>(null)
  const collapsedSongCards = computed<CollapsedSongCard[]>(() => {
    const previousIndex = getSwipeTargetIndex(-1)
    const nextIndex = getSwipeTargetIndex(1)
    return [
      {
        slot: 'previous',
        song: previousIndex === null ? null : player.queue[previousIndex]
      },
      { slot: 'current', song: player.currentQueueSong },
      { slot: 'next', song: nextIndex === null ? null : player.queue[nextIndex] }
    ]
  })
  const renderedCollapsedSongCards = computed(
    () => frozenSwipeCards.value ?? collapsedSongCards.value
  )
  const collapsedTrackStyle = computed(() => ({
    transform: `translate3d(calc(-33.333333% + ${swipeOffset.value}px), 0, 0)`,
    transition: swipeTransitioning.value
      ? `transform ${reduceMotion.value ? 0 : SWIPE_SETTLE_DURATION}ms cubic-bezier(0.22, 1, 0.36, 1)`
      : 'none'
  }))
  watch(
    [
      () => player.currentQueueIndex,
      () => player.playMode,
      () => player.shuffleNavigationRevision,
      () => player.queue.map((song) => song.id).join('|')
    ],
    refreshSwipeTargetIndices,
    { immediate: true }
  )
  function resetSwipe(): void {
    swipePointerId = null
    swipeStartX = 0
    swipeStartY = 0
    swipeWasDragged = false
  }

  function handleSwipePointerDown(event: PointerEvent): void {
    if (
      !collapsed.value ||
      swipeTransitioning.value ||
      swipeCommitting.value ||
      !event.isPrimary ||
      event.button !== 0
    )
      return
    swipePointerId = event.pointerId
    swipeStartX = event.clientX
    swipeStartY = event.clientY
    swipeOffset.value = 0
    swipeWasDragged = false
  }

  function handleSwipePointerMove(event: PointerEvent): void {
    if (!collapsed.value || swipePointerId !== event.pointerId) return
    const deltaX = event.clientX - swipeStartX
    const deltaY = event.clientY - swipeStartY
    if (Math.abs(deltaX) <= Math.abs(deltaY) || Math.abs(deltaX) < 4) return
    if (!swipeWasDragged) {
      frozenSwipeCards.value = collapsedSongCards.value.map((card) => ({ ...card }))
      const footer = event.currentTarget
      if (footer instanceof HTMLElement) footer.setPointerCapture(event.pointerId)
    }
    swipeWasDragged = true
    const targetIndex = getSwipeTargetIndex(deltaX < 0 ? 1 : -1)
    swipeOffset.value = targetIndex === null ? deltaX * 0.2 : deltaX
  }

  async function finishSwipeTransition(): Promise<void> {
    if (disposed || !swipeTransitioning.value) return
    if (swipeSettleTimer) clearTimeout(swipeSettleTimer)
    swipeSettleTimer = null
    const targetIndex = pendingSwipeTargetIndex
    const direction = pendingSwipeDirection
    pendingSwipeTargetIndex = null
    pendingSwipeDirection = 0
    swipeTransitioning.value = false
    swipeCommitting.value = true
    await nextTick()
    if (disposed) return
    try {
      if (targetIndex !== null && direction < 0) await player.playPrevious()
      else if (targetIndex !== null && direction > 0) await player.playNext(targetIndex)
    } finally {
      swipeOffset.value = 0
      frozenSwipeCards.value = null
      swipeCommitting.value = false
      refreshSwipeTargetIndices()
    }
  }

  function settleSwipe(targetIndex: number | null, direction: -1 | 0 | 1): void {
    swipeTransitioning.value = true
    pendingSwipeTargetIndex = targetIndex
    pendingSwipeDirection = direction
    const width = collapsedCarouselRef.value?.clientWidth || 448
    swipeOffset.value = direction === 0 ? 0 : direction < 0 ? width : -width
    if (reduceMotion.value) {
      void finishSwipeTransition()
      return
    }
    if (swipeSettleTimer) clearTimeout(swipeSettleTimer)
    swipeSettleTimer = setTimeout(() => void finishSwipeTransition(), SWIPE_SETTLE_DURATION + 100)
  }

  function handleSwipeTransitionEnd(event: TransitionEvent): void {
    if (event.target === event.currentTarget && event.propertyName === 'transform')
      void finishSwipeTransition()
  }

  function handleSwipePointerUp(event: PointerEvent): void {
    if (!collapsed.value || swipePointerId !== event.pointerId) return
    const deltaX = event.clientX - swipeStartX
    const deltaY = event.clientY - swipeStartY
    const isHorizontalSwipe =
      Math.abs(deltaX) >= SWIPE_DISTANCE &&
      Math.abs(deltaX) > Math.abs(deltaY) * SWIPE_DIRECTION_RATIO
    const direction = deltaX < 0 ? 1 : -1
    const targetIndex = getSwipeTargetIndex(direction)
    const wasDragged = swipeWasDragged
    resetSwipe()
    if (!wasDragged) return
    suppressSwipeClick = true
    settleSwipe(
      isHorizontalSwipe ? targetIndex : null,
      isHorizontalSwipe && targetIndex !== null ? direction : 0
    )
    suppressClickTimer = setTimeout(() => {
      suppressSwipeClick = false
    }, 0)
  }

  function handleSwipePointerCancel(event: PointerEvent): void {
    if (swipePointerId !== event.pointerId) return
    const wasDragged = swipeWasDragged
    resetSwipe()
    if (wasDragged) settleSwipe(null, 0)
  }

  function handleFooterClickCapture(event: MouseEvent): void {
    if (!suppressSwipeClick) return
    suppressSwipeClick = false
    event.preventDefault()
    event.stopPropagation()
  }

  onBeforeUnmount(() => {
    disposed = true
    if (swipeSettleTimer) clearTimeout(swipeSettleTimer)
    clearTimeout(suppressClickTimer)
  })
  return {
    collapsedCarouselRef,
    renderedCollapsedSongCards,
    collapsedTrackStyle,
    handleSwipePointerDown,
    handleSwipePointerMove,
    handleSwipePointerUp,
    handleSwipePointerCancel,
    handleSwipeTransitionEnd,
    handleFooterClickCapture
  }
}
