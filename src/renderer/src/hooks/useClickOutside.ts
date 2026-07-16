import { onMounted, onBeforeUnmount, type Ref } from 'vue'

export function useClickOutside(targetEl: Ref<HTMLElement | null>, callback: () => void): void {
  const listener = (e: MouseEvent): void => {
    if (!targetEl.value) return
    if (!targetEl.value.contains(e.target as Node)) {
      callback()
    }
  }

  onMounted(() => {
    document.addEventListener('click', listener)
  })

  onBeforeUnmount(() => {
    document.removeEventListener('click', listener)
  })
}
