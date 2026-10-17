import { onActivated, onBeforeUnmount, onDeactivated, onMounted } from 'vue'

/** Run periodic UI work only while its page is active and the document is visible. */
export function useVisibleInterval(callback: () => void, delay: number | (() => number)): void {
  let active = false
  let timer: ReturnType<typeof setTimeout> | undefined
  function stop(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }
  function tick(): void {
    timer = undefined
    if (!active || document.hidden) return
    callback()
    if (active && !document.hidden)
      timer = setTimeout(tick, typeof delay === 'function' ? delay() : delay)
  }
  function sync(): void {
    if (!active || document.hidden) stop()
    else if (timer === undefined) tick()
  }
  function activate(): void {
    active = true
    sync()
  }
  onMounted(() => {
    document.addEventListener('visibilitychange', sync)
    activate()
  })
  onActivated(activate)
  onDeactivated(() => {
    active = false
    stop()
  })
  onBeforeUnmount(() => {
    active = false
    stop()
    document.removeEventListener('visibilitychange', sync)
  })
}
