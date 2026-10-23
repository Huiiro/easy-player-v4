import { computed, onMounted, onBeforeUnmount, ref, watch, type Ref } from 'vue'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useFooterAutoHide(
  footerRoot: Ref<HTMLElement | null>,
  enabled: Readonly<Ref<boolean>>,
  footerBusy: Readonly<Ref<boolean>>,
  reduceMotion: Readonly<Ref<boolean>>
) {
  const footerHidden = ref(false)
  const footerPeekVisible = ref(false)
  const pointerNearFooter = ref(false)
  const hoverQuery = window.matchMedia('(hover: hover) and (pointer: fine)')
  const hoverPointer = ref(hoverQuery.matches)
  const AUTO_HIDE_DELAY = 5000
  const REVEAL_MARGIN = 8
  let autoHideTimer: ReturnType<typeof setTimeout> | null = null
  let peekTimer: ReturnType<typeof setTimeout> | null = null
  const autoHideActive = computed(() => enabled.value && hoverPointer.value)

  function revealFooter(): void {
    if (autoHideTimer) clearTimeout(autoHideTimer)
    if (peekTimer) clearTimeout(peekTimer)
    autoHideTimer = null
    peekTimer = null
    footerPeekVisible.value = false
    footerHidden.value = false
  }

  function scheduleFooterHide(): void {
    if (!autoHideActive.value || footerBusy.value || pointerNearFooter.value) {
      revealFooter()
      return
    }
    if (autoHideTimer || footerHidden.value) return
    autoHideTimer = setTimeout(() => {
      autoHideTimer = null
      if (autoHideActive.value && !footerBusy.value && !pointerNearFooter.value) {
        footerHidden.value = true
        peekTimer = setTimeout(
          () => {
            peekTimer = null
            footerPeekVisible.value = autoHideActive.value && footerHidden.value
          },
          reduceMotion.value ? 0 : 300
        )
      }
    }, AUTO_HIDE_DELAY)
  }

  function onWindowPointerMove(event: PointerEvent): void {
    const revealDistance = (footerRoot.value?.offsetHeight ?? 96) + REVEAL_MARGIN
    pointerNearFooter.value =
      event.clientY >= window.innerHeight - revealDistance ||
      (event.target instanceof Node && footerRoot.value?.contains(event.target) === true)
    if (pointerNearFooter.value) revealFooter()
    else scheduleFooterHide()
  }

  function onWindowPointerOut(event: PointerEvent): void {
    if (event.relatedTarget) return
    pointerNearFooter.value = false
    scheduleFooterHide()
  }

  function onHoverPointerChange(event: MediaQueryListEvent): void {
    hoverPointer.value = event.matches
  }

  watch([autoHideActive, footerBusy], scheduleFooterHide)
  onMounted(() => {
    window.addEventListener('pointermove', onWindowPointerMove, { passive: true })
    window.addEventListener('pointerout', onWindowPointerOut)
    hoverQuery.addEventListener('change', onHoverPointerChange)
    scheduleFooterHide()
  })
  onBeforeUnmount(() => {
    window.removeEventListener('pointermove', onWindowPointerMove)
    window.removeEventListener('pointerout', onWindowPointerOut)
    hoverQuery.removeEventListener('change', onHoverPointerChange)
    if (autoHideTimer) clearTimeout(autoHideTimer)
    if (peekTimer) clearTimeout(peekTimer)
  })
  return { footerHidden, footerPeekVisible, autoHideActive, revealFooter, scheduleFooterHide }
}
