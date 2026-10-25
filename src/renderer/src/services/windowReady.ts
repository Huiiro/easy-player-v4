import { nextTick } from 'vue'

let ready: Promise<void> | undefined

/** Commit Vue and theme changes before the host captures the first visible frame. */
export function notifyWindowReady(): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    await nextTick()
    document.documentElement.dataset.windowReady = 'true'
    // Flush styles and layout without relying on animation frames in a hidden page.
    document.documentElement.getBoundingClientRect()
    window.api.window.ready()
  })()
  return ready
}
