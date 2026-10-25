export * from '../../packages/plugin-sdk/src/plugins'

import type { PluginAuthor } from '../../packages/plugin-sdk/src/plugins'
export function parsePluginAuthor(value: unknown): PluginAuthor {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('pluginPackageInvalid')
  const author = value as Record<string, unknown>
  if (
    typeof author.name !== 'string' ||
    !author.name.trim() ||
    author.name.length > 120 ||
    Array.from(author.name).some((char) => char.charCodeAt(0) < 32)
  )
    throw new Error('pluginPackageInvalid')
  const result: PluginAuthor = { name: author.name.trim() }
  if (author.url !== undefined) {
    if (
      typeof author.url !== 'string' ||
      author.url.length > 2048 ||
      Array.from(author.url).some((char) => char.charCodeAt(0) <= 32) ||
      /[<>]/.test(author.url)
    )
      throw new Error('pluginPackageInvalid')
    let url: URL
    try {
      url = new URL(author.url)
    } catch {
      throw new Error('pluginPackageInvalid')
    }
    if (url.protocol !== 'https:' || url.username || url.password)
      throw new Error('pluginPackageInvalid')
    result.url = author.url
  }
  return result
}
