import { app, type BrowserWindow } from 'electron'
import sharp from 'sharp'
import { getWindowPreviewAddonPath } from '../utils/pathUtils'
import { Logger } from './loggerService'

interface CoverBinding {
  configureCoverPreview(window: Buffer, enabled: boolean): boolean
  invalidateCoverPreview(window: Buffer): boolean
  drawCoverPreview(
    window: Buffer,
    pixels: Buffer,
    width: number,
    height: number,
    live: boolean
  ): boolean
}
const THUMBNAIL = 0x0323
const LIVE_PREVIEW = 0x0326

export function createTaskbarCoverPreview(options: { platform: string; fallback: string }): {
  attach(window: BrowserWindow): void
  update(cover?: string): void
  dispose(): void
} {
  let binding: CoverBinding | undefined
  let pixels: Buffer | undefined
  let cover: string | undefined
  let revision = 0
  let disposed = false
  const windows = new Set<BrowserWindow>()
  function configure(window: BrowserWindow): void {
    if (binding && pixels && !window.isDestroyed()) {
      binding.configureCoverPreview(window.getNativeWindowHandle(), true)
      binding.invalidateCoverPreview(window.getNativeWindowHandle())
    }
  }
  async function load(source?: string): Promise<void> {
    const token = ++revision
    let data: Buffer
    try {
      data = await sharp(source || options.fallback, { limitInputPixels: 40_000_000 })
        .rotate()
        .resize(512, 512, { fit: 'contain', background: '#111614' })
        .flatten({ background: '#111614' })
        .ensureAlpha()
        .raw()
        .toBuffer()
    } catch {
      if (source) {
        if (token === revision) void load()
        return
      }
      Logger.warn('[Taskbar thumbnail] Default cover could not be loaded')
      return
    }
    if (disposed || token !== revision) return
    // Windows DIBs use BGRA; sharp produces RGBA.
    for (let i = 0; i < data.length; i += 4) {
      const red = data[i]
      data[i] = data[i + 2]
      data[i + 2] = red
    }
    pixels = data
    windows.forEach(configure)
  }
  function detach(window: BrowserWindow): void {
    windows.delete(window)
    if (window.isDestroyed()) return
    window.unhookWindowMessage(THUMBNAIL)
    window.unhookWindowMessage(LIVE_PREVIEW)
    binding?.configureCoverPreview(window.getNativeWindowHandle(), false)
  }
  return {
    attach(window) {
      if (disposed || options.platform !== 'win32' || windows.has(window)) return
      try {
        // This module draws Windows previews without touching the audio engine.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        binding ??= require(getWindowPreviewAddonPath(app.isPackaged)) as CoverBinding
        if (typeof binding.configureCoverPreview !== 'function')
          throw new Error('Rebuild the native addon')
      } catch (error) {
        Logger.warn('[Taskbar thumbnail] Cover preview unavailable', error)
        return
      }
      windows.add(window)
      window.hookWindowMessage(THUMBNAIL, (_wp, lp) => {
        if (disposed || !pixels || window.isDestroyed()) return
        const size = lp.readUInt32LE(0)
        binding?.drawCoverPreview(
          window.getNativeWindowHandle(),
          pixels,
          size >>> 16,
          size & 0xffff,
          false
        )
      })
      window.hookWindowMessage(LIVE_PREVIEW, () => {
        if (!disposed && pixels && !window.isDestroyed())
          binding?.drawCoverPreview(window.getNativeWindowHandle(), pixels, 0, 0, true)
      })
      window.once('closed', () => windows.delete(window))
      window.on('show', () => configure(window))
      configure(window)
      if (!pixels) void load(cover)
    },
    update(next) {
      if (disposed || options.platform !== 'win32' || next === cover) return
      cover = next
      void load(cover)
    },
    dispose() {
      disposed = true
      revision++
      windows.forEach(detach)
      pixels = undefined
    }
  }
}
