import { ref, onMounted, onBeforeUnmount, watch } from 'vue'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useAutoHide(options: {
  enabled: () => boolean
  delay?: number
  target?: () => HTMLElement | null
}) {
  const visible = ref(true)
  let timer: number | null = null

  const delay = options.delay ?? 2000

  function clear(): void {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
  }

  function startTimer(): void {
    if (!options.enabled()) return

    clear()

    timer = window.setTimeout(() => {
      visible.value = false
    }, delay)
  }

  function show(): void {
    if (!options.enabled()) return
    visible.value = true
    startTimer()
  }

  function handleMove(): void {
    show()
  }

  onMounted(() => {
    const el = options.target?.() ?? window

    el.addEventListener('mousemove', handleMove)
    startTimer()
  })

  onBeforeUnmount(() => {
    const el = options.target?.() ?? window

    el.removeEventListener('mousemove', handleMove)
    clear()
  })

  watch(
    options.enabled,
    (val) => {
      if (val) {
        show()
      } else {
        visible.value = true
        clear()
      }
    },
    { immediate: true }
  )

  return {
    visible,
    show
  }
}
