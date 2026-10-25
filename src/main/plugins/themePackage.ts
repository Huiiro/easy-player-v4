import { verifyResource } from '../utils/themeResources'
import AdmZip from 'adm-zip'
import { inflateRawSync } from 'node:zlib'
import { parsePluginThemeData, type PluginThemeData } from '../../shared/themePlugins'

export interface ThemePluginContent {
  data: PluginThemeData
  fragmentShader?: string
  assets: Map<string, Buffer>
}
/** Declared assets only. Official renderer bytes are served to a sandbox, never evaluated here. */
export function readThemePlugin(bytes: Buffer, allowOfficialRenderer = false): ThemePluginContent {
  const zip = new AdmZip(bytes)
  const entries = zip.getEntries()
  const names = new Set<string>()
  let total = 0
  for (const entry of entries) {
    const name = entry.entryName
    total += entry.header.size
    if (
      entries.length > 128 ||
      total > 32 * 1024 * 1024 ||
      entry.header.size > 16 * 1024 * 1024 ||
      names.has(name.toLowerCase()) ||
      entry.header.encrypted ||
      ((entry.attr >>> 16) & 0xf000) === 0xa000 ||
      !/^[a-zA-Z0-9_./-]+$/.test(name) ||
      name.startsWith('/') ||
      name.split('/').some((part) => part === '.' || part === '..')
    )
      throw new Error('pluginPackageInvalid')
    names.add(name.toLowerCase())
  }
  const used = new Set(['manifest.json'])
  const read = (name: string, limit: number): Buffer => {
    const entry = entries.find((item) => item.entryName === name)
    if (
      !entry ||
      entry.isDirectory ||
      entry.header.size > limit ||
      ![0, 8].includes(entry.header.method)
    )
      throw new Error('pluginPackageInvalid')
    if (entry.header.method === 8)
      inflateRawSync(entry.getCompressedData(), { maxOutputLength: limit })
    const buffer = entry.getData()
    if (buffer.length !== entry.header.size || buffer.length > limit)
      throw new Error('pluginPackageInvalid')
    used.add(name)
    return buffer
  }
  read('manifest.json', 128 * 1024)
  const data = parsePluginThemeData(JSON.parse(read('theme.json', 128 * 1024).toString('utf8')))
  const assets = new Map<string, Buffer>()
  if (data.renderer) {
    if (!allowOfficialRenderer) throw new Error('pluginPackageInvalid')
    assets.set(data.renderer.entry, read(data.renderer.entry, 2 * 1024 * 1024))
  }
  let fragmentShader: string | undefined
  if (data.shader) {
    fragmentShader = read(data.shader.fragment, 256 * 1024).toString('utf8')
    if (!fragmentShader.startsWith('#version 300 es') || fragmentShader.includes('\0'))
      throw new Error('pluginPackageInvalid')
    for (const texture of data.shader.textures) {
      const buffer = read(
        texture.path,
        texture.format === 'rg32f' ? texture.width * texture.height * 8 : 16 * 1024 * 1024
      )
      if (texture.format === 'image') verifyResource(buffer, texture.path)
      else {
        if (buffer.length !== texture.width * texture.height * 8)
          throw new Error('pluginPackageInvalid')
        for (let index = 0; index < buffer.length; index += 4)
          if (!Number.isFinite(buffer.readFloatLE(index))) throw new Error('pluginPackageInvalid')
      }
      assets.set(texture.path, buffer)
    }
  }
  for (const resource of Object.values(data.assets?.resources ?? {})) {
    const buffer = read(resource.path, 16 * 1024 * 1024)
    verifyResource(buffer, resource.path)
    assets.set(resource.path, buffer)
  }
  for (const license of data.assets?.licenses ?? []) read(license, 64 * 1024)
  for (const entry of entries) {
    if (entry.isDirectory || used.has(entry.entryName)) continue
    if (!/^licenses\/[a-zA-Z0-9_-]+\.txt$/.test(entry.entryName))
      throw new Error('pluginPackageInvalid')
    read(entry.entryName, 64 * 1024)
  }
  return { data, fragmentShader, assets }
}
