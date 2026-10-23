import type { WindowMaterial } from '../../../shared/windowMaterial'
import type {
  SystemBackground,
  SystemBackgroundTheme
} from '@/components/background/systemBackgroundRegistry'
import { accessibleSongAccent } from '@/components/background/songThemeColors'

export type ColorMode = 'light' | 'dark' | 'system'
export type AccentSource = 'auto' | 'user' | 'scene' | 'song'
export type AppearanceBackground =
  { type: 'none' } | { type: 'preset'; id: SystemBackground } | { type: 'image' | 'video' }
export interface AppearancePreferences {
  colorMode: ColorMode
  background: AppearanceBackground
  accentSource: AccentSource
  accentColor: string
  themeBackgroundEnabled: boolean
  customChrome: { header: string; footer: string; border: string }
}
export interface AppearanceRuntime {
  systemDark: boolean
  material: WindowMaterial
  scene: SystemBackgroundTheme
  songColor: string | null
  theme?: { name: string; background?: 'replace' | 'inherit'; tokens: Record<string, string> }
}
export const DEFAULT_ACCENT_COLOR = 'oklch(0.691 0.198 148.262)'

/** Resolve effective appearance without mutating the saved preferences or the DOM. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function resolveAppearance(preferences: AppearancePreferences, runtime: AppearanceRuntime) {
  const dark =
    preferences.colorMode === 'system' ? runtime.systemDark : preferences.colorMode === 'dark'
  const nativeMaterialEnabled = runtime.material !== 'none'
  const themeBackground =
    !!runtime.theme && runtime.theme.background !== 'inherit' && preferences.themeBackgroundEnabled
  const background: AppearanceBackground | { type: 'theme' } = nativeMaterialEnabled
    ? { type: 'none' }
    : themeBackground
      ? { type: 'theme' }
      : preferences.background
  const sceneActive = background.type === 'preset'
  const customActive = background.type === 'image' || background.type === 'video'
  const reasons: (
    'material' | 'themeBackground' | 'themeAccent' | 'songUnavailable' | 'sceneUnavailable'
  )[] = []
  if (nativeMaterialEnabled && (themeBackground || preferences.background.type !== 'none'))
    reasons.push('material')
  else if (themeBackground && preferences.background.type !== 'none')
    reasons.push('themeBackground')
  let accentColor = preferences.accentColor || DEFAULT_ACCENT_COLOR
  let accentSource: AccentSource | 'theme' = 'user'
  const source = preferences.accentSource
  const useSong =
    source === 'song' || (source === 'auto' && sceneActive && background.id === 'solid')
  const useScene = source === 'scene' || (source === 'auto' && sceneActive)
  if (useSong && runtime.songColor) {
    accentColor = accessibleSongAccent(runtime.songColor)
    accentSource = 'song'
  } else if (useScene && preferences.background.type === 'preset') {
    accentColor = runtime.scene.accentColor
    accentSource = 'scene'
  } else if (source === 'song') reasons.push('songUnavailable')
  else if (source === 'scene') reasons.push('sceneUnavailable')
  // Preserve hue while limiting accent lightness on pale surfaces. The saved
  // color stays intact; explicit theme tokens retain their author-defined value.
  if (!dark) accentColor = `oklch(from ${accentColor} min(l, 0.45) c h)`
  if (runtime.theme?.tokens?.['--color-primary']) {
    accentColor = runtime.theme.tokens['--color-primary']
    accentSource = 'theme'
    reasons.push('themeAccent')
  }
  const translucent = runtime.material === 'acrylic' || runtime.material === 'vibrancy'
  const sceneChrome = sceneActive && dark
  const header = nativeMaterialEnabled
    ? 'transparent'
    : customActive
      ? dark
        ? preferences.customChrome.header
        : `color-mix(in srgb, var(--color-bg) 92%, ${preferences.customChrome.header})`
      : sceneChrome
        ? runtime.scene.headerBackground
        : 'color-mix(in srgb, var(--color-bg) 82%, transparent)'
  const footer = translucent
    ? 'color-mix(in srgb, var(--color-primary) 8%, color-mix(in srgb, var(--color-bg) 24%, transparent))'
    : customActive
      ? dark
        ? preferences.customChrome.footer
        : `color-mix(in srgb, var(--color-bg) 92%, ${preferences.customChrome.footer})`
      : sceneChrome
        ? runtime.scene.footerBackground
        : 'color-mix(in srgb, var(--color-bg) 78%, transparent)'
  const border = translucent
    ? 'color-mix(in srgb, var(--color-primary) 18%, transparent)'
    : customActive
      ? preferences.customChrome.border
      : sceneChrome
        ? runtime.scene.chromeBorder
        : 'color-mix(in srgb, var(--color-border) 82%, transparent)'
  return {
    dark,
    background,
    nativeMaterialEnabled,
    material: runtime.material,
    accentColor,
    accentSource,
    systemTheme: background.type === 'preset' ? background.id : customActive ? 'custom' : 'none',
    primaryFill:
      sceneActive && background.id === 'solid' && accentSource !== 'theme'
        ? accentSource === 'song'
          ? runtime.songColor
          : accentColor
        : null,
    chrome: { header, footer, border },
    reasons
  }
}
export type ResolvedAppearance = ReturnType<typeof resolveAppearance>
