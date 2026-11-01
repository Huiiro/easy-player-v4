import { computed, onMounted, onBeforeUnmount, ref, type ComputedRef } from 'vue'

/** Hidden windows always idle; visible, unfocused windows follow the user's preference. */
export function useAnimationActivity(pauseOnBlur: () => boolean): ComputedRef<boolean> {
  const visible = ref(!document.hidden)
  const focused = ref(document.hasFocus())
  function sync(): void {
    visible.value = !document.hidden
    focused.value = document.hasFocus()
  }
  onMounted(() => {
    sync()
    document.addEventListener('visibilitychange', sync)
    window.addEventListener('focus', sync)
    window.addEventListener('blur', sync)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', sync)
    window.removeEventListener('focus', sync)
    window.removeEventListener('blur', sync)
  })
  return computed(() => visible.value && (!pauseOnBlur() || focused.value))
}
