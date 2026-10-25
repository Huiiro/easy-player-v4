import type { BrowserWindow } from 'electron'

/** Keep a native window hidden until its first application frame is ready. */
export function createWindowPresentation(
  window: BrowserWindow,
  present: () => void,
  backgroundThrottling = true
): { show: () => void; cancel: () => void; rendererReady: () => void } {
  // Keep the initial hidden renderer painting until its application frame is captured.
  // Restore the requested background policy after the first frame, including canceled opens.
  window.webContents.setBackgroundThrottling(false)
  let nativeReady = false
  let rendererReady = false
  let frameReady = false
  let requested = false
  const showIfReady = (): void => {
    if (!requested || !nativeReady || !frameReady || window.isDestroyed()) return
    requested = false
    present()
  }
  window.once('ready-to-show', () => {
    nativeReady = true
    showIfReady()
  })
  window.once('closed', () => {
    requested = false
  })
  return {
    show: () => {
      requested = true
      showIfReady()
    },
    cancel: () => {
      requested = false
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
