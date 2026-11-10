import { parseThemeManifest } from './themePackage'
import { themeTokenPattern, themeSelectorPattern, safeThemeValue } from './themeStyles'
export type * from '../../packages/plugin-sdk/src/themes'
import type { PluginThemeData, PluginThemeManifest } from '../../packages/plugin-sdk/src/themes'

const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
export function themePluginPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= 160 &&
    /^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.(?:glsl|bin|png|jpg|jpeg|webp|gif)$/.test(value)
  )
}
function color(value: unknown, background = false): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > (background ? 2048 : 200) ||
    !/^[a-zA-Z0-9#().,% /+-]+$/.test(value) ||
    /(?:url|var|expression|image-set|paint)\s*\(/i.test(value) ||
    (!background &&
      !/^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(?:rgb|rgba|hsl|hsla|oklch|oklab)\([0-9.,% /+-]+\))$/.test(
        value
      ))
  )
    throw new Error('pluginPackageInvalid')
  return value
}
export function parsePluginThemeManifest(value: unknown): PluginThemeManifest {
  if (
    !object(value) ||
    typeof value.displayName !== 'string' ||
    !value.displayName.trim() ||
    value.displayName.length > 120
  )
    throw new Error('Invalid plugin theme declaration')
  const names: PluginThemeManifest['names'] = {}
  if (value.names !== undefined) {
    if (!object(value.names)) throw new Error('Invalid plugin theme names')
    for (const [locale, name] of Object.entries(value.names)) {
      if (
        !['zh', 'en'].includes(locale) ||
        typeof name !== 'string' ||
        !name.trim() ||
        name.length > 120
      )
        throw new Error('Invalid plugin theme name')
      names[locale as 'zh' | 'en'] = name
    }
  }
  return { displayName: value.displayName, ...(Object.keys(names).length ? { names } : {}) }
}
export function parsePluginThemeData(value: unknown): PluginThemeData {
  if (
    !object(value) ||
    value.version !== 1 ||
    !['light', 'dark'].includes(value.colorMode as string)
  )
    throw new Error('pluginPackageInvalid')
  const result: PluginThemeData = {
    version: 1,
    colorMode: value.colorMode as 'light' | 'dark',
    accentColor: color(value.accentColor),
    headerBackground: color(value.headerBackground),
    footerBackground: color(value.footerBackground),
    chromeBorder: color(value.chromeBorder),
    background: color(value.background, true)
  }
  if (value.glass !== undefined) {
    const glass = value.glass
    if (
      !object(glass) ||
      Object.keys(glass).some(
        (key) =>
          ![
            'selectors',
            'blur',
            'refraction',
            'saturation',
            'thickness',
            'ior',
            'dispersion',
            'fresnel',
            'highlight',
            'lightAngle',
            'shadow',
            'interactive'
          ].includes(key)
      ) ||
      !Array.isArray(glass.selectors) ||
      glass.selectors.length < 1 ||
      glass.selectors.length > 16 ||
      new Set(glass.selectors).size !== glass.selectors.length ||
      !glass.selectors.every(
        (selector) => typeof selector === 'string' && themeSelectorPattern.test(selector)
      ) ||
      ![
        ['blur', 0, 24],
        ['refraction', 0, 40],
        ['saturation', 1, 2]
      ].every(([key, min, max]) => {
        const n = glass[key as string]
        return typeof n === 'number' && Number.isFinite(n) && n >= Number(min) && n <= Number(max)
      })
    )
      throw new Error('pluginPackageInvalid')
    const optionalRanges = {
      thickness: [4, 64],
      ior: [1, 2.5],
      dispersion: [0, 1],
      fresnel: [0, 1],
      highlight: [0, 2],
      lightAngle: [0, 360],
      shadow: [0, 1]
    }
    for (const [key, [min, max]] of Object.entries(optionalRanges)) {
      const n = glass[key]
      if (n !== undefined && (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max))
        throw new Error('pluginPackageInvalid')
    }
    if (glass.interactive !== undefined && typeof glass.interactive !== 'boolean')
      throw new Error('pluginPackageInvalid')
    result.glass = {
      selectors: [...glass.selectors] as string[],
      blur: glass.blur as number,
      refraction: glass.refraction as number,
      saturation: glass.saturation as number,
      ...Object.fromEntries(
        Object.keys(optionalRanges)
          .filter((key) => glass[key] !== undefined)
          .map((key) => [key, glass[key]])
      ),
      ...(glass.interactive !== undefined ? { interactive: glass.interactive as boolean } : {})
    }
  }
  if (value.tokens !== undefined) {
    if (!object(value.tokens) || Object.keys(value.tokens).length > 64)
      throw new Error('pluginPackageInvalid')
    const tokens: Record<string, string> = Object.create(null)
    for (const [name, tokenValue] of Object.entries(value.tokens)) {
      if (!themeTokenPattern.test(name) || !safeThemeValue(tokenValue))
        throw new Error('pluginPackageInvalid')
      tokens[name] = tokenValue as string
    }
    result.tokens = tokens
  }
  if (value.rules !== undefined) {
    if (!object(value.rules) || Object.keys(value.rules).length > 128)
      throw new Error('pluginPackageInvalid')
    const rules: NonNullable<PluginThemeData['rules']> = Object.create(null)
    for (const [selector, declarations] of Object.entries(value.rules)) {
      if (
        !themeSelectorPattern.test(selector) ||
        !object(declarations) ||
        Object.keys(declarations).length > 64
      )
        throw new Error('pluginPackageInvalid')
      const properties: Record<string, string> = Object.create(null)
      for (const [property, cssValue] of Object.entries(declarations)) {
        if (!/^[a-z][a-z-]*$/.test(property) || !safeThemeValue(cssValue))
          throw new Error('pluginPackageInvalid')
        properties[property] = cssValue
      }
      rules[selector] = properties
    }
    result.rules = rules
  }
  if (value.assets !== undefined) {
    if (!object(value.assets)) throw new Error('pluginPackageInvalid')
    const { resources, slots, text, licenses } = parseThemeManifest({
      ...value.assets,
      version: 1,
      id: 'plugin-theme',
      theme: 'theme.json'
    })
    result.assets = { resources, slots, text, licenses }
  }
  if (value.renderer !== undefined) {
    if (
      !object(value.renderer) ||
      typeof value.renderer.entry !== 'string' ||
      value.renderer.entry.length > 160 ||
      !/^(?:[a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.js$/.test(value.renderer.entry) ||
      value.shader !== undefined
    )
      throw new Error('pluginPackageInvalid')
    result.renderer = { entry: value.renderer.entry }
  }
  if (value.shader !== undefined) {
    if (
      !object(value.shader) ||
      !themePluginPath(value.shader.fragment) ||
      !value.shader.fragment.endsWith('.glsl') ||
      !Array.isArray(value.shader.textures) ||
      value.shader.textures.length > 4 ||
      (value.shader.fps !== undefined &&
        (!Number.isInteger(value.shader.fps) ||
          (value.shader.fps as number) < 1 ||
          (value.shader.fps as number) > 30))
    )
      throw new Error('pluginPackageInvalid')
    const uniforms = new Set(['u_resolution', 'u_time', 'u_pointer'])
    let total = 0
    const textures = value.shader.textures.map((texture) => {
      if (
        !object(texture) ||
        typeof texture.uniform !== 'string' ||
        !/^u_[a-z][a-z0-9_]{0,63}$/.test(texture.uniform) ||
        uniforms.has(texture.uniform) ||
        !themePluginPath(texture.path) ||
        !(
          (texture.format === 'rg32f' && texture.path.endsWith('.bin')) ||
          (texture.format === 'image' && /\.(png|jpe?g|webp|gif)$/.test(texture.path))
        ) ||
        !Number.isInteger(texture.width) ||
        !Number.isInteger(texture.height) ||
        (texture.width as number) < 1 ||
        (texture.height as number) < 1 ||
        (texture.width as number) > 2048 ||
        (texture.height as number) > 2048
      )
        throw new Error('pluginPackageInvalid')
      uniforms.add(texture.uniform)
      total +=
        (texture.width as number) *
        (texture.height as number) *
        (texture.format === 'rg32f' ? 8 : 4)
      if (total > 16 * 1024 * 1024) throw new Error('pluginPackageInvalid')
      return {
        uniform: texture.uniform,
        path: texture.path,
        width: texture.width as number,
        height: texture.height as number,
        format: texture.format as 'rg32f' | 'image'
      }
    })
    result.shader = {
      fragment: value.shader.fragment,
      textures,
      ...(value.shader.fps !== undefined ? { fps: value.shader.fps as number } : {})
    }
  }
  return result
}
