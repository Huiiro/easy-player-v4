import type { ResolvedAppearance } from './appearance'
import { primarySurfaceColors } from '@/components/background/songThemeColors'

export function applyAppearance(appearance: ResolvedAppearance, root: HTMLElement): void {
  root.classList.toggle('dark', appearance.dark)
  root.classList.toggle('native-material-enabled', appearance.nativeMaterialEnabled)
  // Keep the public legacy class for existing theme packages.
  root.classList.toggle('mica-enabled', appearance.nativeMaterialEnabled)
  root.ownerDocument.body.classList.toggle('mica-enabled', appearance.nativeMaterialEnabled)
  root.dataset.windowMaterial = appearance.material
  root.dataset.systemTheme = appearance.systemTheme
  root.style.colorScheme = appearance.dark ? 'dark' : 'light'
  root.style.setProperty('--color-primary', appearance.accentColor)
  root.style.setProperty('--app-header-bg', appearance.chrome.header)
  root.style.setProperty('--app-footer-bg', appearance.chrome.footer)
  root.style.setProperty('--app-chrome-border', appearance.chrome.border)
  // Borders belong to the component palette; background chrome has its own token.
  root.style.removeProperty('--color-border')
  root.style.removeProperty('--color-border-l')
  if (appearance.primaryFill) {
    const surface = primarySurfaceColors(appearance.primaryFill)
    root.style.setProperty('--color-primary-fill', appearance.primaryFill)
    root.style.setProperty('--color-on-primary', surface.text)
    root.style.setProperty('--btn-primary-bg-hover', surface.hover)
  } else {
    for (const token of ['--color-primary-fill', '--color-on-primary', '--btn-primary-bg-hover'])
      root.style.removeProperty(token)
  }
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
