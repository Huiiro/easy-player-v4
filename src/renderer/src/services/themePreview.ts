const PREVIEW_DURATION_MS = 10_000

export function createThemePreviewTimer(
  onTick: (seconds: number) => void,
  onExpire: () => void
): {
  start: () => void
  stop: () => void
  check: () => void
  confirm: () => boolean
} {
  let deadline: number | null = null
  let interval: ReturnType<typeof setInterval> | undefined

  function stop(): void {
    if (interval !== undefined) clearInterval(interval)
    interval = undefined
    deadline = null
    onTick(0)
  }
  function check(): void {
    if (deadline === null) return
    const remaining = Math.max(0, deadline - Date.now())
    onTick(Math.ceil(remaining / 1000))
    if (remaining === 0) {
      stop()
      onExpire()
    }
  }
  function start(): void {
    stop()
    deadline = Date.now() + PREVIEW_DURATION_MS
    check()
    interval = setInterval(check, 250)
  }
  function confirm(): boolean {
    check()
    if (deadline === null) return false
    stop()
    return true
  }
  return { start, stop, check, confirm }
}
