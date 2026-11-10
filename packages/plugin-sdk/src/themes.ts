import type { PluginAuthor } from './plugins'
import type { PluginThemeTokens } from './themeGlass'

/** Third-party themes are declarative. Official themes may use a sandboxed renderer. */
export interface PluginThemeManifest {
  displayName: string
  names?: { zh?: string; en?: string }
}
export interface PluginThemeTexture {
  uniform: string
  path: string
  width: number
  height: number
  /** image uses declared dimensions, decoded RGBA8, flipped Y and mipmapped linear sampling. */
  format: 'rg32f' | 'image'
}
export interface PluginThemeAssets {
  resources: Record<
    string,
    { type: 'font' | 'image'; path: string; weight?: string; style?: 'normal' | 'italic' }
  >
  slots: Partial<
    Record<
      | 'appBackground'
      | 'home'
      | 'sidebar'
      | 'header'
      | 'footer'
      | 'button'
      | 'dialog'
      | 'drawer'
      | 'menu'
      | 'playbackThumb'
      | 'global',
      { image?: string; font?: string }
    >
  >
  text?: { appTitle?: string; homeWelcome?: string }
  licenses?: string[]
}
export interface PluginThemeData {
  version: 1
  /** Design mode; does not change the user's preference. Scoped styles/assets apply on match. */
  colorMode: 'light' | 'dark'
  /** Scene accent. The host derives button foreground/hover unless the theme overrides them. */
  accentColor: string
  headerBackground: string
  footerBackground: string
  chromeBorder: string
  /** Color/gradient fallback while resources load or fail; not the legacy replace/inherit flag. */
  background: string
  /** Public semantic tokens; user custom themes and descendant-local declarations retain precedence. */
  tokens?: PluginThemeTokens
  /** Same scoped declarations and resource slots as custom theme packages. */
  rules?: Record<string, Record<string, string>>
  assets?: PluginThemeAssets
  /** Host-generated SVG edge refraction; requires a host with glass support. No SVG code or URLs. */
  glass?: PluginThemeGlass
  /** Official catalog packages only; runs inside an opaque sandboxed background frame. */
  renderer?: { entry: string }
  shader?: { fragment: string; textures: PluginThemeTexture[]; fps?: number }
}
export interface PluginThemeGlass {
  /** Public .ep-* selectors, including descendants; at most 16 unique entries. */
  selectors: string[]
  /** Backdrop blur in pixels, 0–24. */
  blur: number
  /** Edge displacement in pixels, 0–40. */
  refraction: number
  /** Backdrop saturation, 1–2. */
  saturation: number
  /** Optical edge thickness in CSS pixels, 4–64; limited to 20% of the short side. Default 8. */
  thickness?: number
  /** Index of refraction, 1–2.5. Default 1.5. */
  ior?: number
  /** RGB wavelength separation and narrow prismatic rim enhancement, 0–1. Default 0.18. */
  dispersion?: number
  /** Schlick Fresnel reflection strength, 0–1. Default 0.4. */
  fresnel?: number
  /** Directional specular highlight strength, 0–2. Default 0.65. */
  highlight?: number
  /** Light azimuth in degrees, 0–360. Default 225. */
  lightAngle?: number
  /** Soft shadow strength, 0–1. Default 0.2. */
  shadow?: number
  /** Small local pointer response inside the surface, respecting reduced motion. Default false. */
  interactive?: boolean
}
export interface InstalledPluginTheme {
  pluginId: string
  author?: PluginAuthor
  version: string
  revision: string
  displayName: string
  names?: PluginThemeManifest['names']
  data: PluginThemeData
  rendererUrl?: string
  fragmentShader?: string
  textures: (PluginThemeTexture & { url: string })[]
}
