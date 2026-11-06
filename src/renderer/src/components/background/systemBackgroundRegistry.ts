import { computed, defineAsyncComponent, shallowRef, type Component } from 'vue'
import type { InstalledPluginTheme } from '../../../../shared/themePlugins'
const SandboxedThemeBackground = defineAsyncComponent(
  () => import('./SandboxedThemeBackground.vue')
)
const DeclarativeThemeBackground = defineAsyncComponent(
  () => import('./DeclarativeThemeBackground.vue')
)
const SolidBackground = defineAsyncComponent(() => import('./player/SolidBackground.vue'))

export type SystemBackground = `plugin:${string}` | 'none' | 'solid'

export interface SystemBackgroundTheme {
  id: SystemBackground
  labelKey: string
  colorMode: 'light' | 'dark'
  accentColor: string
  headerBackground: string
  footerBackground: string
  chromeBorder: string
  component?: Component
  displayName?: string
  names?: { zh?: string; en?: string }
  pluginTheme?: InstalledPluginTheme
}

export const systemBackgroundThemes: readonly SystemBackgroundTheme[] = [
  {
    id: 'none',
    labelKey: 'settings.systemBackgroundNone',
    colorMode: 'light',
    accentColor: 'oklch(0.691 0.198 148.262)',
    headerBackground: 'color-mix(in srgb, var(--color-bg) 82%, transparent)',
    footerBackground: 'color-mix(in srgb, var(--color-bg) 78%, transparent)',
    chromeBorder: 'color-mix(in srgb, var(--color-border) 82%, transparent)'
  },
  {
    id: 'solid',
    labelKey: 'settings.systemBackgroundSolid',
    colorMode: 'dark',
    accentColor: 'oklch(0.691 0.198 148.262)',
    headerBackground: 'color-mix(in srgb, var(--color-bg) 46%, transparent)',
    footerBackground: 'color-mix(in srgb, var(--color-bg) 64%, transparent)',
    chromeBorder: 'rgb(210 220 216 / 5%)',
    component: SolidBackground
  }
]

export const pluginThemes = shallowRef<InstalledPluginTheme[]>([])
export const availableBackgroundThemes = computed<SystemBackgroundTheme[]>(() => [
  ...systemBackgroundThemes,
  ...pluginThemes.value.map((theme): SystemBackgroundTheme => ({
    id: `plugin:${theme.pluginId}`,
    labelKey: '',
    displayName: theme.displayName,
    names: theme.names,
    ...theme.data,
    // Rendering strategy is separate from official/third-party package authentication.
    component: theme.data.renderer ? SandboxedThemeBackground : DeclarativeThemeBackground,
    pluginTheme: theme
  }))
])
export function getSystemBackgroundTheme(id: SystemBackground): SystemBackgroundTheme {
  return (
    availableBackgroundThemes.value.find((theme) => theme.id === id) ?? systemBackgroundThemes[0]
  )
}

export function isSystemBackground(value: unknown): value is SystemBackground {
  // Retain missing plugin selections for restoration after reinstall/re-enable.
  return (
    (typeof value === 'string' && /^plugin:[a-z][a-z0-9._-]{0,95}$/.test(value)) ||
    systemBackgroundThemes.some((theme) => theme.id === value)
  )
}
