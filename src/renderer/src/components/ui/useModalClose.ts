import { computed, nextTick, onActivated, onDeactivated, ref, type ComputedRef } from 'vue'

/** Shared close policy and lifecycle for portalled Headless UI modals. */
export function useModalClose(
  props: { modelValue: boolean; closeOnOverlay: boolean; closeOnEsc: boolean },
  emit: { (event: 'update:modelValue', value: boolean): void; (event: 'close'): void }
): {
  isOpen: ComputedRef<boolean>
  close: () => void
  beforeEnter: () => void
  afterLeave: () => void
  onOverlayClose: () => void
  onKeydown: (event: KeyboardEvent) => void
} {
  const active = ref(true)
  const isOpen = computed(() => active.value && props.modelValue)
  let restoreTarget: HTMLElement | null = null
  function beforeEnter(): void {
    // Preserve the original trigger when a leave transition is interrupted.
    if (restoreTarget?.isConnected) return
    restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null
  }
  function afterLeave(): void {
    const target = restoreTarget
    restoreTarget = null
    void nextTick(() => {
      // Portal unmount can skip Headless UI's focus restore watcher. Do not
      // override focus already moved to another dialog or to a new page.
      if (
        !isOpen.value &&
        document.activeElement === document.body &&
        target?.isConnected &&
        !target.closest('[inert]')
      )
        target.focus({ preventScroll: true })
    })
  }
  let closingRequested = false
  function close(): void {
    if (!props.modelValue || closingRequested) return
    closingRequested = true
    emit('update:modelValue', false)
    emit('close')
    // A parent may veto closing (for example an unsaved-draft confirmation).
    // Coalesce one interaction without permanently locking that dialog open.
    void nextTick(() => {
      closingRequested = false
    })
  }
  function onOverlayClose(): void {
    if (props.closeOnOverlay) close()
  }
  function onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    if (props.closeOnEsc) close()
  }
  onActivated(() => {
    active.value = true
  })
  onDeactivated(() => {
    active.value = false
    close()
  })
  return { isOpen, close, beforeEnter, afterLeave, onOverlayClose, onKeydown }
}
