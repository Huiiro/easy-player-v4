import { nativeImage, nativeTheme, type BrowserWindow, type ThumbarButton } from 'electron'
import { join } from 'node:path'
import { t } from '../i18n'
import { Logger } from './loggerService'
import type { TaskbarAction } from './taskbarPlaybackService'

export function createThumbnailPlaybackControls(options: {
  platform: string
  window: () => BrowserWindow | null
  iconsDirectory: string
  onAction: (action: TaskbarAction) => void
}): {
  attach: (window: BrowserWindow) => void
  update: (state?: { hasTrack: boolean; isPlaying: boolean }) => void
  dispose: () => void
} {
  let state = { hasTrack: false, isPlaying: false }
  let disposed = false
  let retry: ReturnType<typeof setTimeout> | undefined
  let attempts = 0
  let registeredWindow: BrowserWindow | null = null
  function cancelRetry(): void {
    if (retry) clearTimeout(retry)
    retry = undefined
  }
  const icons = new Map<string, Electron.NativeImage>()
  function update(next?: typeof state): void {
    if (next) {
      state = { ...next }
      attempts = 0
    }
    if (disposed || options.platform !== 'win32') return
    const window = options.window()
    if (!window || window.isDestroyed() || !window.isVisible()) return
    cancelRetry()
    const theme = nativeTheme.shouldUseDarkColorsForSystemIntegratedUI ? 'dark' : 'light'
    const buttons = (['previous', 'toggle', 'next'] as const).map((action): ThumbarButton => {
      const name = action === 'toggle' ? (state.isPlaying ? 'pause' : 'play') : action
      const key = `${name}-${theme}`
      let icon = icons.get(key)
      if (!icon) {
        icon = nativeImage.createFromPath(join(options.iconsDirectory, `${key}.png`))
        icons.set(key, icon)
      }
      return {
        icon,
        tooltip: t(
          action === 'previous'
            ? 'trayPrevious'
            : action === 'next'
              ? 'trayNext'
              : state.isPlaying
                ? 'trayPause'
                : 'trayPlay'
        ),
        flags: state.hasTrack ? [] : ['disabled'],
        click: () => {
          if (!disposed && state.hasTrack && options.window() === window && !window.isDestroyed())
            options.onAction(action)
        }
      }
    })
    if (window.setThumbarButtons(buttons)) {
      attempts = 0
      if (registeredWindow !== window) {
        registeredWindow = window
        Logger.info('[Taskbar thumbnail] Playback buttons registered')
      }
    } else if (++attempts <= 3) {
      retry = setTimeout(() => {
        retry = undefined
        update()
      }, 250)
      retry.unref()
    } else {
      Logger.warn('[Taskbar thumbnail] Windows rejected playback buttons')
    }
  }
  const refresh = (): void => update()
  if (options.platform === 'win32') nativeTheme.on('updated', refresh)
  return {
    attach(window) {
      if (options.platform !== 'win32' || disposed) return
      window.once('ready-to-show', refresh)
      const shown = (): void => {
        cancelRetry()
        attempts = 0
        // Let Explorer register the taskbar button before adding the toolbar.
        retry = setTimeout(() => {
          retry = undefined
          update()
        }, 150)
        retry.unref()
      }
      window.on('show', shown)
      window.on('restore', shown)
      window.once('closed', () => {
        if (registeredWindow === window) registeredWindow = null
      })
      update()
    },
    update,
    dispose() {
      disposed = true
      cancelRetry()
      if (options.platform === 'win32') nativeTheme.removeListener('updated', refresh)
      icons.clear()
    }
  }
}
