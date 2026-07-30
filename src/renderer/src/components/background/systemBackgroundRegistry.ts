import type { Component } from 'vue'
import AuroraBackground from './themes/AuroraBackground.vue'
import ForestBackground from './themes/ForestBackground.vue'
import MatrixBackground from './themes/MatrixBackground.vue'
import OceanBackground from './themes/OceanBackground.vue'
import SunsetBackground from './themes/SunsetBackground.vue'

export type SystemBackground = 'none' | 'aurora' | 'ocean' | 'sunset' | 'forest' | 'matrix'

export interface SystemBackgroundTheme {
  id: SystemBackground
  labelKey: string
  accentColor: string
  headerBackground: string
  footerBackground: string
  chromeBorder: string
  component?: Component
}

export const systemBackgroundThemes: readonly SystemBackgroundTheme[] = [
  {
    id: 'none',
    labelKey: 'settings.systemBackgroundNone',
    accentColor: 'oklch(0.691 0.198 148.262)',
    headerBackground: 'color-mix(in srgb, var(--color-bg) 82%, transparent)',
    footerBackground: 'color-mix(in srgb, var(--color-bg) 78%, transparent)',
    chromeBorder: 'color-mix(in srgb, var(--color-border) 82%, transparent)'
  },
  {
    id: 'aurora',
    labelKey: 'settings.systemBackgroundAurora',
    accentColor: 'oklch(0.79 0.16 164)',
    headerBackground: 'rgb(10 39 42 / 0.84)',
    footerBackground: 'rgb(13 45 48 / 0.86)',
    chromeBorder: 'rgb(109 241 201 / 0.26)',
    component: AuroraBackground
  },
  {
    id: 'ocean',
    labelKey: 'settings.systemBackgroundOcean',
    accentColor: 'oklch(0.72 0.15 232)',
    headerBackground: 'rgb(5 25 48 / 0.85)',
    footerBackground: 'rgb(8 39 66 / 0.87)',
    chromeBorder: 'rgb(101 205 255 / 0.25)',
    component: OceanBackground
  },
  {
    id: 'sunset',
    labelKey: 'settings.systemBackgroundSunset',
    accentColor: 'oklch(0.7 0.23 340)',
    headerBackground: 'rgb(56 20 54 / 0.86)',
    footerBackground: 'rgb(52 24 70 / 0.88)',
    chromeBorder: 'rgb(255 111 209 / 0.3)',
    component: SunsetBackground
  },
  {
    id: 'forest',
    labelKey: 'settings.systemBackgroundForest',
    accentColor: 'oklch(0.75 0.17 137)',
    headerBackground: 'rgb(10 40 30 / 0.86)',
    footerBackground: 'rgb(13 52 36 / 0.88)',
    chromeBorder: 'rgb(150 226 108 / 0.26)',
    component: ForestBackground
  },
  {
    id: 'matrix',
    labelKey: 'settings.systemBackgroundMatrix',
    accentColor: 'oklch(0.78 0.18 151)',
    headerBackground: 'rgb(2 18 11 / 0.9)',
    footerBackground: 'rgb(4 28 17 / 0.9)',
    chromeBorder: 'rgb(103 255 169 / 0.28)',
    component: MatrixBackground
  }
]

export function getSystemBackgroundTheme(id: SystemBackground): SystemBackgroundTheme {
  return systemBackgroundThemes.find((theme) => theme.id === id) ?? systemBackgroundThemes[0]
}

export function isSystemBackground(value: unknown): value is SystemBackground {
  return systemBackgroundThemes.some((theme) => theme.id === value)
}
