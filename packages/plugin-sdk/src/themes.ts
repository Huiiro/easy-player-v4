import type { PluginAuthor } from './plugins'

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
  tokens?: Record<string, string>
  /** Same scoped declarations and resource slots as custom theme packages. */
  rules?: Record<string, Record<string, string>>
  assets?: PluginThemeAssets
  /** Official catalog packages only; runs inside an opaque sandboxed background frame. */
  renderer?: { entry: string }
  shader?: { fragment: string; textures: PluginThemeTexture[]; fps?: number }
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
