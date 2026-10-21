import { defineAsyncComponent, type Component } from 'vue'
const AuroraBackground = defineAsyncComponent(() => import('./themes/AuroraBackground.vue'))
const BlackHoleBackground = defineAsyncComponent(() => import('./themes/BlackHoleBackground.vue'))
const ForestBackground = defineAsyncComponent(() => import('./themes/ForestBackground.vue'))
const MatrixBackground = defineAsyncComponent(() => import('./themes/MatrixBackground.vue'))
const OceanBackground = defineAsyncComponent(() => import('./themes/OceanBackground.vue'))
const RainyBackground = defineAsyncComponent(() => import('./themes/RainyBackground.vue'))
const StarfieldBackground = defineAsyncComponent(() => import('./themes/StarfieldBackground.vue'))
const SunsetBackground = defineAsyncComponent(() => import('./themes/SunsetBackground.vue'))
const StarTrailsBackground = defineAsyncComponent(() => import('./themes/StarTrailsBackground.vue'))
const DnaBackground = defineAsyncComponent(() => import('./themes/DnaBackground.vue'))
const SolidBackground = defineAsyncComponent(() => import('./SolidBackground.vue'))

export type SystemBackground =
  | 'none'
  | 'aurora'
  | 'ocean'
  | 'sunset'
  | 'forest'
  | 'matrix'
  | 'blackhole'
  | 'rainy'
  | 'starfield'
  | 'startrails'
  | 'dna'
  | 'solid'

export interface SystemBackgroundTheme {
  id: SystemBackground
  labelKey: string
  colorMode: 'light' | 'dark'
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
  },
  {
    id: 'aurora',
    labelKey: 'settings.systemBackgroundAurora',
    colorMode: 'dark',
    accentColor: 'oklch(0.79 0.16 164)',
    headerBackground: 'rgb(10 39 42 / 0.84)',
    footerBackground: 'rgb(13 45 48 / 0.86)',
    chromeBorder: 'rgb(109 241 201 / 0.26)',
    component: AuroraBackground
  },
  {
    id: 'ocean',
    labelKey: 'settings.systemBackgroundOcean',
    colorMode: 'dark',
    accentColor: 'oklch(0.74 0.10 212)',
    headerBackground: 'rgb(7 28 39 / 0.86)',
    footerBackground: 'rgb(6 24 34 / 0.9)',
    chromeBorder: 'rgb(129 184 189 / 0.22)',
    component: OceanBackground
  },
  {
    id: 'sunset',
    labelKey: 'settings.systemBackgroundSunset',
    colorMode: 'dark',
    accentColor: 'oklch(0.75 0.12 55)',
    headerBackground: 'rgb(35 29 34 / 0.86)',
    footerBackground: 'rgb(28 27 34 / 0.9)',
    chromeBorder: 'rgb(236 180 137 / 0.22)',
    component: SunsetBackground
  },
  {
    id: 'forest',
    labelKey: 'settings.systemBackgroundForest',
    colorMode: 'dark',
    accentColor: 'oklch(0.73 0.095 138)',
    headerBackground: 'rgb(24 40 32 / 0.86)',
    footerBackground: 'rgb(19 33 27 / 0.9)',
    chromeBorder: 'rgb(174 193 145 / 0.22)',
    component: ForestBackground
  },
  {
    id: 'matrix',
    labelKey: 'settings.systemBackgroundMatrix',
    colorMode: 'dark',
    accentColor: 'oklch(0.74 0.12 158)',
    headerBackground: 'rgb(8 23 16 / 0.88)',
    footerBackground: 'rgb(7 20 15 / 0.92)',
    chromeBorder: 'rgb(126 187 151 / 0.2)',
    component: MatrixBackground
  },
  {
    id: 'rainy',
    labelKey: 'settings.systemBackgroundRainy',
    colorMode: 'dark',
    accentColor: 'oklch(0.75 0.09 233)',
    headerBackground: 'rgb(12 23 35 / 0.87)',
    footerBackground: 'rgb(9 19 30 / 0.9)',
    chromeBorder: 'rgb(139 179 205 / 0.24)',
    component: RainyBackground
  },
  {
    id: 'starfield',
    labelKey: 'settings.systemBackgroundStarfield',
    colorMode: 'dark',
    accentColor: 'oklch(0.78 0.12 264)',
    headerBackground: 'rgb(12 18 40 / 0.84)',
    footerBackground: 'rgb(14 20 45 / 0.87)',
    chromeBorder: 'rgb(153 181 255 / 0.24)',
    component: StarfieldBackground
  },
  {
    id: 'startrails',
    labelKey: 'settings.systemBackgroundStarTrails',
    colorMode: 'dark',
    accentColor: 'oklch(0.76 0.08 245)',
    headerBackground: 'rgb(9 18 31 / 0.88)',
    footerBackground: 'rgb(10 20 32 / 0.92)',
    chromeBorder: 'rgb(146 174 207 / 0.22)',
    component: StarTrailsBackground
  },
  {
    id: 'dna',
    labelKey: 'settings.systemBackgroundDna',
    colorMode: 'dark',
    accentColor: 'oklch(0.76 0.10 184)',
    headerBackground: 'rgb(9 22 29 / 0.88)',
    footerBackground: 'rgb(9 22 29 / 0.92)',
    chromeBorder: 'rgb(135 204 198 / 0.20)',
    component: DnaBackground
  },
  {
    id: 'blackhole',
    labelKey: 'settings.systemBackgroundBlackHole',
    colorMode: 'dark',
    accentColor: 'oklch(0.69 0.105 83)',
    headerBackground: 'rgb(15 13 9 / 0.86)',
    footerBackground: 'rgb(21 18 12 / 0.88)',
    chromeBorder: 'rgb(177 140 66 / 0.28)',
    component: BlackHoleBackground
  }
]

export function getSystemBackgroundTheme(id: SystemBackground): SystemBackgroundTheme {
  return systemBackgroundThemes.find((theme) => theme.id === id) ?? systemBackgroundThemes[0]
}

export function isSystemBackground(value: unknown): value is SystemBackground {
  return systemBackgroundThemes.some((theme) => theme.id === value)
}
