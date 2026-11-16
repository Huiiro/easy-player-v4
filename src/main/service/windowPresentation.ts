import type { BrowserWindow } from 'electron'

/** Keep Windows' initial show/resize surfaces invisible until the compositor repaints. */
export async function revealPaintedWindow(window: BrowserWindow): Promise<void> {
  try {
    await window.webContents.executeJavaScript(`new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })`)
    if (window.isDestroyed()) return
    await window.webContents.capturePage()
  } finally {
    if (!window.isDestroyed()) window.setOpacity(1)
  }
}

/** Present either the static startup screen or the first complete application frame. */
export function createWindowPresentation(
  window: BrowserWindow,
  present: () => void | Promise<void>,
  backgroundThrottling = true,
  showStartupScreen = false
): {
  show: () => void
  cancel: () => void
  startupReady: () => Promise<boolean>
  rendererReady: () => void
} {
  // Keep the initial hidden renderer painting until its application frame is captured.
  // Restore the requested background policy after the first frame, including canceled opens.
  window.webContents.setBackgroundThrottling(false)
  let nativeReady = false
  let rendererReady = false
  let frameReady = false
  let requested = false
  let presenting = false
  let startup: Promise<boolean> | undefined
  let resolveStartup: ((shown: boolean) => void) | undefined
  const showIfReady = (): void => {
    if (!requested || !nativeReady || !frameReady || presenting || window.isDestroyed()) return
    requested = false
    presenting = true
    void Promise.resolve(present())
      .then(() => {
        presenting = false
        resolveStartup?.(!window.isDestroyed())
        resolveStartup = undefined
        showIfReady()
      })
      .catch(() => {
        presenting = false
        resolveStartup?.(false)
        resolveStartup = undefined
      })
  }
  window.once('ready-to-show', () => {
    nativeReady = true
    showIfReady()
  })
  window.once('closed', () => {
    requested = false
    resolveStartup?.(false)
    resolveStartup = undefined
  })
  return {
    show: () => {
      requested = true
      showIfReady()
    },
    cancel: () => {
      requested = false
    },
    startupReady: () => {
      if (!showStartupScreen || window.isDestroyed()) return Promise.resolve(false)
      if (startup) return startup
      startup = new Promise((resolve) => {
        resolveStartup = resolve
      })
      // The bootstrap has decoded the logo; capture its opaque frame before show().
      void window.webContents
        .capturePage()
        .then(() => {
          if (window.isDestroyed()) return
          frameReady = true
          showIfReady()
        })
        .catch(() => {
          // Continue initialization while retaining the native dark background.
          resolveStartup?.(false)
          resolveStartup = undefined
        })
      return startup
    },
    rendererReady: () => {
      if (rendererReady || window.isDestroyed()) return
      rendererReady = true
      // Capturing the compositor frame works for hidden windows, where rAF can
      // remain throttled even with background timer throttling disabled.
      void window.webContents
        .capturePage()
        .catch(() => undefined)
        .then(() => {
          if (window.isDestroyed()) return
          frameReady = true
          showIfReady()
          window.webContents.setBackgroundThrottling(backgroundThrottling)
        })
    }
  }
}
