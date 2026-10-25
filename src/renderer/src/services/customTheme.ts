import { reportThemeFailure } from './pluginLogs'
import {
  themeSelectorPattern as selectorPattern,
  themeTokenPattern as tokenPattern,
  safeThemeValue as safeValue
} from '../../../shared/themeStyles'
import type { InstalledPluginTheme } from '../../../shared/themePlugins'
import {
  isPackageId,
  parseThemeManifest,
  THEME_SLOTS,
  themeResourceURL,
  type InstalledThemePackage,
  type ThemeSlot
} from '../../../shared/themePackage'

export interface CustomTheme {
  version: 1
  name: string
  background?: 'replace' | 'inherit'
  tokens: Record<string, string>
  rules: Record<string, Record<string, string>>
  /** Runtime only; never read from user JSON or persisted. */
  plugin?: InstalledPluginTheme
  package?: InstalledThemePackage
}

export const MAX_THEME_BYTES = 128 * 1024
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function parseCustomTheme(source: string): CustomTheme {
  if (new TextEncoder().encode(source).length > MAX_THEME_BYTES)
    throw new Error('Theme exceeds 128 KB')
  const data: unknown = JSON.parse(source)
  if (
    !record(data) ||
    data.version !== 1 ||
    typeof data.name !== 'string' ||
    !data.name.trim() ||
    data.name.length > 80
  )
    throw new Error('Invalid theme name or version')
  const tokens: Record<string, string> = Object.create(null)
  let installedPackage: InstalledThemePackage | undefined
  if (data.package !== undefined) {
    if (!record(data.package) || !isPackageId(data.package.id))
      throw new Error('Invalid installed package')
    installedPackage = { id: data.package.id, manifest: parseThemeManifest(data.package.manifest) }
  }
  if (
    data.background !== undefined &&
    data.background !== 'replace' &&
    data.background !== 'inherit'
  )
    throw new Error('Invalid theme background mode')
  const rules: Record<string, Record<string, string>> = Object.create(null)
  if (data.tokens !== undefined && !record(data.tokens)) throw new Error('Invalid theme tokens')
  for (const [key, value] of Object.entries(data.tokens ?? {})) {
    if (!tokenPattern.test(key) || !safeValue(value)) throw new Error(`Invalid token: ${key}`)
    tokens[key] = value
  }
  if (data.rules !== undefined && !record(data.rules)) throw new Error('Invalid theme rules')
  for (const [selector, declarations] of Object.entries(data.rules ?? {})) {
    if (!selectorPattern.test(selector) || !record(declarations))
      throw new Error(`Invalid selector: ${selector}`)
    const properties: Record<string, string> = Object.create(null)
    for (const [property, value] of Object.entries(declarations)) {
      if (!/^[a-z][a-z-]*$/.test(property) || !safeValue(value) || !CSS.supports(property, value))
        throw new Error(`Invalid CSS property: ${property}`)
      properties[property] = value
    }
    rules[selector] = properties
  }
  return {
    version: 1,
    name: data.name.trim(),
    background: data.background ?? 'replace',
    tokens,
    rules,
    package: installedPackage
  }
}

export function customThemeCSS(theme: CustomTheme): string {
  const tokens = Object.entries(theme.tokens)
    .map(([key, value]) => `${key}:${value} !important`)
    .join(';')
  return (
    `:root{${tokens}}\n` +
    runtimePackages(theme).map(packageCSS).join('\n') +
    Object.entries(theme.rules)
      .map(
        ([selector, declarations]) =>
          `${selector}{${Object.entries(declarations)
            .map(([key, value]) => `${key}:${value}`)
            .join(';')}}`
      )
      .join('\n')
  )
}

interface RuntimePackage {
  theme?: Pick<InstalledPluginTheme, 'pluginId' | 'revision'>
  id: string
  manifest: Pick<InstalledThemePackage['manifest'], 'resources' | 'slots'>
  url: (path: string) => string
}
function runtimePackages(theme: CustomTheme): RuntimePackage[] {
  const packages: RuntimePackage[] = []
  const plugin = theme.plugin
  if (plugin?.data.assets)
    packages.push({
      theme: plugin,
      id: plugin.pluginId + '-' + plugin.revision,
      manifest: plugin.data.assets,
      url: (path) =>
        'easy-player-media://plugin-theme/' + plugin.pluginId + '/' + plugin.revision + '/' + path
    })
  if (theme.package)
    packages.push({
      id: theme.package.id,
      manifest: {
        resources: theme.package.manifest.resources,
        // Selecting a plugin background keeps custom fonts/slots, but suppresses its old background.
        slots: Object.fromEntries(
          Object.entries(theme.package.manifest.slots).filter(
            ([slot]) => !plugin || slot !== 'appBackground'
          )
        )
      },
      url: (path) => themeResourceURL(theme.package!.id, path)
    })
  return packages
}
function packageCSS(installed?: RuntimePackage): string {
  if (!installed) return ''
  return Object.entries(installed.manifest.slots)
    .map(([slot, assignment]) => {
      const target = THEME_SLOTS[slot as ThemeSlot]
      const fontSelector =
        slot === 'global'
          ? 'body,button,input,select,textarea'
          : `${target.selector},${target.selector} :where(button,input,select,textarea)`
      const fontRule = assignment.font
        ? `${fontSelector}{font-family:"EPTheme-${installed.id}-${assignment.font}",sans-serif}`
        : ''
      const declarations: string[] = []
      if (assignment.image) {
        const resource = installed.manifest.resources[assignment.image]
        if (slot === 'playbackThumb') {
          return `${target.selector}{--ep-range-thumb-image:url("${installed.url(resource.path)}")}`
        }
        declarations.push(
          slot === 'appBackground'
            ? `background-image:var(--ep-background-image-overlay,linear-gradient(transparent,transparent)),url("${installed.url(resource.path)}")`
            : `background-image:url("${installed.url(resource.path)}")`,
          'background-size:cover',
          'background-position:center',
          'background-repeat:no-repeat'
        )
      }
      return fontRule + `${target.selector}{${declarations.join(';')}}`
    })
    .join('\n')
}

let activePackageKey = ''
let fontGeneration = 0
const packageFonts = new Set<FontFace>()
function loadPackageFonts(packages: RuntimePackage[]): void {
  const key = packages.map((installed) => installed.id).join('|')
  if (key === activePackageKey) return
  activePackageKey = key
  const generation = ++fontGeneration
  for (const font of packageFonts) document.fonts.delete(font)
  packageFonts.clear()
  for (const installed of packages) {
    for (const [id, resource] of Object.entries(installed.manifest.resources)) {
      if (resource.type !== 'font') continue
      const face = new FontFace(
        `EPTheme-${installed.id}-${id}`,
        `url("${installed.url(resource.path)}")`,
        {
          weight: resource.weight ?? '400',
          style: resource.style ?? 'normal'
        }
      )
      void face
        .load()
        .then((loaded) => {
          if (generation !== fontGeneration) return
          document.fonts.add(loaded)
          packageFonts.add(loaded)
        })
        .catch((error: unknown) => {
          if (generation !== fontGeneration) return
          if (installed.theme)
            reportThemeFailure(
              installed.theme,
              'FONT_LOAD',
              resource.path + ': ' + (error instanceof Error ? error.message : 'Font decode failed')
            )
          else console.warn('[Theme] Font could not be loaded', resource.path, error)
        })
    }
  }
}

export function applyCustomTheme(theme: CustomTheme | null): void {
  loadPackageFonts(theme ? runtimePackages(theme) : [])
  const existing = document.getElementById('ep-custom-theme')
  if (!theme) {
    existing?.remove()
    return
  }
  const css = customThemeCSS(theme)
  if (existing) {
    if (existing.textContent !== css) existing.textContent = css
    return
  }
  const style = document.createElement('style')
  style.id = 'ep-custom-theme'
  style.textContent = css
  document.head.append(style)
}
