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
  package?: InstalledThemePackage
}

export const MAX_THEME_BYTES = 128 * 1024
const selectorPattern =
  /^\.ep-[a-z][a-z0-9-]*(?::(?:hover|focus-visible|disabled))?(?: \.ep-[a-z][a-z0-9-]*(?::(?:hover|focus-visible|disabled))?)*$/
const tokenPattern = /^--(?:color|btn|scrollbar|app|ep|lrc|motion)-[a-z0-9-]+$/
// Keep theme files declarative and local: no imports, URLs, escaping or CSS injection.
function safeValue(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 500 &&
    !/[;{}<>@\\!]/.test(value) &&
    !Array.from(value).some((char) => char.charCodeAt(0) < 32) &&
    !/(?:url|image-set|expression)\s*\(/i.test(value) &&
    !/\/\*/.test(value)
  )
}
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
    packageCSS(theme.package) +
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

function packageCSS(installed?: InstalledThemePackage): string {
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
          return `${target.selector}{--ep-range-thumb-image:url("${themeResourceURL(installed.id, resource.path)}")}`
        }
        declarations.push(
          `background-image:url("${themeResourceURL(installed.id, resource.path)}")`,
          'background-size:cover',
          'background-position:center',
          'background-repeat:no-repeat'
        )
      }
      return fontRule + `${target.selector}{${declarations.join(';')}}`
    })
    .join('\n')
}

let activePackageId: string | undefined
let fontGeneration = 0
const packageFonts = new Set<FontFace>()
function loadPackageFonts(installed?: InstalledThemePackage): void {
  if (installed?.id === activePackageId) return
  activePackageId = installed?.id
  const generation = ++fontGeneration
  for (const font of packageFonts) document.fonts.delete(font)
  packageFonts.clear()
  if (!installed) return
  for (const [id, resource] of Object.entries(installed.manifest.resources)) {
    if (resource.type !== 'font') continue
    const face = new FontFace(
      `EPTheme-${installed.id}-${id}`,
      `url("${themeResourceURL(installed.id, resource.path)}")`,
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
      .catch((error) => console.warn('[Theme] Font could not be loaded', resource.path, error))
  }
}

export function applyCustomTheme(theme: CustomTheme | null): void {
  loadPackageFonts(theme?.package)
  document.getElementById('ep-custom-theme')?.remove()
  if (!theme) return
  const style = document.createElement('style')
  style.id = 'ep-custom-theme'
  style.textContent = customThemeCSS(theme)
  document.head.append(style)
}
