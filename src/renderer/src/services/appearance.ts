import type { WindowMaterial } from '../../../shared/windowMaterial'
import type {
  SystemBackground,
  SystemBackgroundTheme
} from '@/components/background/systemBackgroundRegistry'
import { accessibleSongAccent, solidBackgroundColor } from '@/components/background/songThemeColors'

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
  const lightSongMaterial = sceneActive && background.id === 'solid' && !dark
  const contentDark =
    dark ||
    (nativeMaterialEnabled && runtime.systemDark) ||
    (sceneActive && background.id !== 'solid' && runtime.scene.colorMode === 'dark')
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
  let chromeAccentColor = accentColor
  // Preserve hue while limiting accent lightness and chroma on pale surfaces. The saved
  // color stays intact; explicit theme tokens retain their author-defined value.
  if (!dark)
    accentColor = lightSongMaterial
      ? `oklch(from ${accentColor} min(l, 0.32) min(c, 0.07) h)`
      : `oklch(from ${accentColor} min(l, 0.42) min(c, 0.12) h)`
  if (runtime.theme?.tokens?.['--color-primary']) {
    accentColor = runtime.theme.tokens['--color-primary']
    chromeAccentColor = accentColor
    accentSource = 'theme'
    reasons.push('themeAccent')
  }
  const translucent = runtime.material === 'acrylic' || runtime.material === 'vibrancy'
  const lightMica = runtime.material === 'mica' && !dark
  const sceneChrome = sceneActive && (dark || background.id !== 'solid')
  const importedChrome = background.type === 'theme'
  const chromeDark = contentDark || customActive || importedChrome
  const raisedChrome = !dark && chromeDark && (sceneChrome || importedChrome)
  // Light mode changes foregrounds and component surfaces, leaving authored
  // backgrounds intact. Keep the existing dark-mode readability treatment.
  const backgroundScrim = !dark
    ? null
    : customActive
      ? 'color-mix(in srgb, var(--color-bg) 42%, transparent)'
      : sceneActive && background.id !== 'solid'
        ? 'var(--ep-background-scrim, color-mix(in srgb, var(--color-bg) 62%, transparent))'
        : null
  const header = nativeMaterialEnabled
    ? 'transparent'
    : customActive
      ? preferences.customChrome.header
      : sceneChrome
        ? runtime.scene.headerBackground
        : importedChrome
          ? (runtime.theme?.tokens['--app-header-bg'] ?? 'oklch(14% 0.01 260 / 82%)')
          : lightSongMaterial
            ? 'color-mix(in srgb, var(--color-bg-l) 78%, transparent)'
            : dark
              ? 'color-mix(in srgb, var(--color-bg) 82%, transparent)'
              : 'color-mix(in srgb, var(--color-bg-l) 94%, transparent)'
  const footer = lightMica
    ? runtime.systemDark
      ? 'rgb(10 16 13 / 16%)'
      : 'rgb(24 34 28 / 6%)'
    : translucent
      ? 'color-mix(in srgb, var(--color-primary) 8%, color-mix(in srgb, var(--color-bg) 24%, transparent))'
      : customActive
        ? preferences.customChrome.footer
        : sceneChrome
          ? runtime.scene.footerBackground
          : importedChrome
            ? (runtime.theme?.tokens['--app-footer-bg'] ?? 'oklch(14% 0.01 260 / 78%)')
            : lightSongMaterial
              ? 'color-mix(in srgb, var(--color-bg-l2) 88%, transparent)'
              : dark
                ? 'color-mix(in srgb, var(--color-bg) 78%, transparent)'
                : 'color-mix(in srgb, var(--color-bg-l) 96%, transparent)'
  const border = lightMica
    ? runtime.systemDark
      ? 'rgb(255 255 255 / 10%)'
      : 'rgb(24 34 28 / 12%)'
    : translucent
      ? 'color-mix(in srgb, var(--color-primary) 18%, transparent)'
      : customActive
        ? preferences.customChrome.border
        : sceneChrome
          ? runtime.scene.chromeBorder
          : importedChrome
            ? (runtime.theme?.tokens['--app-chrome-border'] ?? 'rgb(210 220 216 / 15%)')
            : 'color-mix(in srgb, var(--color-border) 82%, transparent)'
  return {
    dark,
    contentDark,
    background,
    backgroundSurface:
      sceneActive && background.id === 'solid'
        ? solidBackgroundColor(runtime.songColor ?? accentColor, dark)
        : null,
    backgroundScrim,
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
    chrome: {
      header,
      footer,
      border,
      dark: chromeDark,
      raised: raisedChrome,
      accentColor: chromeAccentColor
    },
    reasons
  }
}
export type ResolvedAppearance = ReturnType<typeof resolveAppearance>
