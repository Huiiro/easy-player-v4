import type { ResolvedAppearance } from './appearance'
import { primarySurfaceColors } from '@/components/background/songThemeColors'

/** Keep the visible palette until its background can start painting. */
export function createAppearanceHandoff(): {
  hold: (visibleKey: string) => void
  stage: (key: string, apply: (animated: boolean) => void) => void
  start: (key: string, animated: boolean) => void
  settle: (queued: boolean) => void
  release: (key: string) => void
} {
  let held = false
  let visibleKey = ''
  let animated = false
  const pending = new Map<string, (animated: boolean) => void>()
  function start(key: string, withMotion: boolean): void {
    visibleKey = key
    animated = withMotion
    const apply = pending.get(key)
    pending.delete(key)
    apply?.(withMotion)
  }
  return {
    hold(key) {
      if (!held) visibleKey = key
      held = true
    },
    stage(key, apply) {
      if (!held || key === visibleKey) apply(held && animated)
      else {
        pending.set(key, apply)
        // Only the loading scene and the latest queued choice can still be shown.
        if (pending.size > 2) pending.delete(pending.keys().next().value!)
      }
    },
    start,
    settle(queued) {
      if (queued) return
      held = animated = false
      pending.clear()
    },
    release(key) {
      start(key, false)
      held = animated = false
      pending.clear()
    }
  }
}

export const backgroundAppearanceHandoff = createAppearanceHandoff()

export interface CompactAppearance {
  dark: boolean
  background: ResolvedAppearance['systemTheme']
  accent: string
  fill?: string
  backgroundSurface?: string | null
}

/** Shared document palette for the main window and compact player. */
export function applyCompactAppearance(appearance: CompactAppearance, root: HTMLElement): void {
  root.classList.toggle('dark', appearance.dark)
  root.dataset.systemTheme = appearance.background
  root.style.colorScheme = appearance.dark ? 'dark' : 'light'
  root.style.setProperty('--color-primary', appearance.accent)
  if (appearance.backgroundSurface)
    root.style.setProperty('--app-song-surface', appearance.backgroundSurface)
  else root.style.removeProperty('--app-song-surface')
  if (appearance.fill) root.style.setProperty('--color-primary-fill', appearance.fill)
  else root.style.removeProperty('--color-primary-fill')
  const surface = primarySurfaceColors(appearance.fill ?? appearance.accent)
  root.style.setProperty('--color-on-primary', surface.text)
  root.style.setProperty('--btn-primary-bg-hover', surface.hover)
}

export function applyAppearance(appearance: ResolvedAppearance, root: HTMLElement): void {
  applyCompactAppearance(
    {
      dark: appearance.dark,
      background: appearance.systemTheme,
      accent: appearance.accentColor,
      fill: appearance.primaryFill ?? undefined,
      backgroundSurface: appearance.backgroundSurface
    },
    root
  )
  root.classList.toggle('native-material-enabled', appearance.nativeMaterialEnabled)
  // Keep the public legacy class for existing theme packages.
  root.classList.toggle('mica-enabled', appearance.nativeMaterialEnabled)
  root.ownerDocument.body.classList.toggle('mica-enabled', appearance.nativeMaterialEnabled)
  root.dataset.windowMaterial = appearance.material
  root.dataset.chromeDark = String(appearance.chrome.dark)
  root.dataset.chromeRaised = String(appearance.chrome.raised)
  root.style.setProperty('--app-header-bg', appearance.chrome.header)
  root.style.setProperty('--app-footer-bg', appearance.chrome.footer)
  root.style.setProperty('--app-chrome-border', appearance.chrome.border)
  root.style.setProperty('--app-chrome-accent', appearance.chrome.accentColor)
  const chromePrimary = primarySurfaceColors(appearance.chrome.accentColor)
  root.style.setProperty('--app-chrome-on-accent', chromePrimary.text)
  root.style.setProperty('--app-chrome-accent-hover', chromePrimary.hover)
  // Borders belong to the component palette; background chrome has its own token.
  root.style.removeProperty('--color-border')
  root.style.removeProperty('--color-border-l')
}

/** Coalesce a burst of changes, always reading the latest state when it is applied. */
export function createAppearanceScheduler(
  apply: () => void,
  enqueue: (job: () => void) => void = queueMicrotask
): () => void {
  let queued = false
  return () => {
    if (queued) return
    queued = true
    enqueue(() => {
      queued = false
      apply()
    })
  }
}
