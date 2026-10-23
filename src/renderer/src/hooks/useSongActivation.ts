import { useUIStore } from '@/stores/ui/uiStore'

/** Shared pointer activation for song rows; explicit play buttons stay immediate. */
export function useSongActivation(): (event: MouseEvent, play: () => unknown) => void {
  const ui = useUIStore()
  return (event, play) => {
    if (event.defaultPrevented || event.button !== 0) return
    const target = event.target
    if (target instanceof Element) {
      const control = target.closest('button, a, input, select, textarea, [role="button"]')
      if (control && control !== event.currentTarget) return
    }
    const single = ui.songPlayTrigger === 'single'
    if (
      (event.type === 'click' && (event.detail === 0 || (single && event.detail === 1))) ||
      (event.type === 'dblclick' && !single)
    ) {
      void play()
    }
  }
}
