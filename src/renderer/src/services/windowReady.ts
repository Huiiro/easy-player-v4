import { nextTick } from 'vue'

let ready: Promise<void> | undefined

/** Commit Vue and theme changes before the host captures the first visible frame. */
export function notifyWindowReady(): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    await nextTick()
    if (document.documentElement.dataset.startupPresented && !document.hidden) {
      // Give the initialized application a compositor frame beneath the opaque splash.
      // Hidden view replacements must not wait on throttled animation frames.
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve()))
      })
    }
    // Establish the opaque startup frame even when initialization finishes before first paint.
    document.documentElement.getBoundingClientRect()
    document.documentElement.dataset.windowReady = 'true'
    // Flush styles and layout without relying on animation frames in a hidden page.
    document.documentElement.getBoundingClientRect()
    window.api.window.ready()
  })()
  return ready
}
