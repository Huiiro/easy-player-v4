import { onDeactivated } from 'vue'

/** Headless UI owns focus trapping, scroll locking and portal lifetime. */
export function useModalClose(
  props: { modelValue: boolean; closeOnOverlay: boolean; closeOnEsc: boolean },
  emit: { (event: 'update:modelValue', value: boolean): void; (event: 'close'): void }
): { close: () => void; onOverlayClose: () => void; onKeydown: (event: KeyboardEvent) => void } {
  function close(): void {
    if (!props.modelValue) return
    emit('update:modelValue', false)
    emit('close')
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
  onDeactivated(close)
  return { close, onOverlayClose, onKeydown }
}
