import type { Component, CSSProperties } from 'vue'
import type { InstalledPluginTheme } from '../../../../shared/themePlugins'
import type { CustomTheme } from '@/services/customTheme'
import type { ResolvedAppearance } from '@/services/appearance'

export function backgroundSceneKey(
  appearance: ResolvedAppearance,
  themeName: string,
  mediaUrl: string,
  revision?: string
): string {
  if (appearance.nativeMaterialEnabled) return 'native'
  const background = appearance.background
  if (background.type === 'preset') return `preset:${background.id}:${revision ?? ''}`
  if (background.type === 'image' || background.type === 'video')
    return `${background.type}:${mediaUrl}`
  return background.type === 'theme' ? `theme:${themeName}` : background.type
}

/** Immutable resource inputs; outgoing layers must not follow the next selection. */
export interface BackgroundScene {
  key: string
  kind: 'none' | 'native' | 'theme' | 'image' | 'video' | 'preset'
  surface: string
  base: string
  scrim: string | null
  component?: Component
  plugin?: InstalledPluginTheme
  theme?: CustomTheme
  primary: string
  dark: boolean
  contentDark: boolean
  mediaUrl: string
  mediaStyle: CSSProperties
  mediaFilter: string
}
