import AdmZip from 'adm-zip'
import { randomUUID } from 'node:crypto'
import { inflateRawSync } from 'node:zlib'
import { mkdir, readFile, writeFile, rm, lstat, realpath } from 'node:fs/promises'
import { resolve, relative, isAbsolute, dirname, extname } from 'node:path'
import { getDataPath } from '../utils/pathUtils'
import {
  isPackageId,
  parseThemeManifest,
  type InstalledThemePackage
} from '../../shared/themePackage'

const MAX_ZIP = 32 * 1024 * 1024
const MAX_TOTAL = 64 * 1024 * 1024
const MAX_FILE = 16 * 1024 * 1024
const directory = (): string => resolve(getDataPath(), 'themes')
function packageDirectory(id: string): string {
  if (!isPackageId(id)) throw new Error('Invalid installed theme id')
  return resolve(directory(), id)
}
function verifyResource(bytes: Buffer, path: string): void {
  const extension = extname(path).toLowerCase()
  const hex = bytes.subarray(0, 12).toString('hex')
  const signature = bytes.subarray(0, 4).toString('ascii')
  const valid =
    extension === '.png'
      ? hex.startsWith('89504e470d0a1a0a')
      : ['.jpg', '.jpeg'].includes(extension)
        ? hex.startsWith('ffd8ff')
        : extension === '.webp'
          ? signature === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP'
          : extension === '.gif'
            ? ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString())
            : extension === '.woff'
              ? signature === 'wOFF'
              : extension === '.woff2'
                ? signature === 'wOF2'
                : extension === '.otf'
                  ? signature === 'OTTO'
                  : extension === '.ttf'
                    ? hex.startsWith('00010000') || signature === 'true'
                    : false
  if (!valid) throw new Error(`Resource content does not match format: ${path}`)
}

export async function importThemePackage(
  data: Uint8Array
): Promise<{ source: string; package: InstalledThemePackage }> {
  if (!(data instanceof Uint8Array) || !data.byteLength || data.byteLength > MAX_ZIP)
    throw new Error('Theme ZIP must be smaller than 32 MB')
  const zip = new AdmZip(Buffer.from(data))
  const entries = zip.getEntries()
  if (entries.length > 128) throw new Error('Too many ZIP entries')
  const names = new Set<string>()
  let total = 0
  for (const entry of entries) {
    const name = entry.entryName.toLowerCase()
    if (names.has(name) || entry.header.encrypted || ((entry.attr >>> 16) & 0xf000) === 0xa000)
      throw new Error('Duplicate, encrypted or symbolic-link entry')
    names.add(name)
    total += entry.header.size
    if (entry.header.size > MAX_FILE || total > MAX_TOTAL)
      throw new Error('Theme resource size limit exceeded')
  }
  const readEntry = (name: string, max = MAX_FILE): Buffer => {
    const entry = entries.find((entry) => entry.entryName === name)
    if (!entry || entry.isDirectory || entry.header.size > max)
      throw new Error(`Missing or oversized package file: ${name}`)
    if (entry.header.method !== 0 && entry.header.method !== 8)
      throw new Error('Unsupported ZIP compression')
    if (entry.header.method === 8)
      inflateRawSync(entry.getCompressedData(), { maxOutputLength: max })
    if (entry.header.method !== 0 && entry.header.method !== 8)
      throw new Error('Unsupported ZIP compression')
    if (entry.header.method === 8)
      inflateRawSync(entry.getCompressedData(), { maxOutputLength: max })
    const bytes = entry.getData()
    if (bytes.length > max || bytes.length !== entry.header.size)
      throw new Error('Invalid ZIP size')
    return bytes
  }
  const manifestBytes = readEntry('manifest.json', 128 * 1024)
  const manifest = parseThemeManifest(JSON.parse(manifestBytes.toString('utf8')))
  if (manifest.theme === 'manifest.json') throw new Error('Theme path is reserved')
  if (manifest.theme === 'manifest.json') throw new Error('Theme path is reserved')
  const source = readEntry(manifest.theme, 128 * 1024).toString('utf8')
  const theme = JSON.parse(source)
  if (!theme || theme.version !== 1 || typeof theme.name !== 'string' || !theme.name.trim())
    throw new Error('Invalid theme.json')
  const files = new Map<string, Buffer>([
    ['manifest.json', Buffer.from(JSON.stringify(manifest, null, 2))],
    [manifest.theme, Buffer.from(source)]
  ])
  for (const resource of Object.values(manifest.resources)) {
    if (resource.path === 'manifest.json' || resource.path === manifest.theme)
      throw new Error('Reserved resource path')
    const bytes = readEntry(resource.path)
    verifyResource(bytes, resource.path)
    files.set(resource.path, bytes)
  }
  for (const file of manifest.licenses ?? []) {
    if (files.has(file)) throw new Error('Duplicate license path')
    files.set(file, readEntry(file, 64 * 1024))
  }
  // No generic extraction: only validated manifest paths are written.
  for (const entry of entries) {
    if (!entry.isDirectory && !files.has(entry.entryName))
      throw new Error(`Undeclared package file: ${entry.entryName}`)
  }
  const id = randomUUID()
  const target = packageDirectory(id)
  try {
    await mkdir(target, { recursive: true })
    for (const [file, bytes] of files) {
      const path = resolve(target, file)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, bytes, { flag: 'wx' })
    }
    return { source, package: { id, manifest } }
  } catch (error) {
    await rm(target, { recursive: true, force: true })
    throw error
  }
}

export async function exportThemePackage(id: string): Promise<Uint8Array> {
  const target = packageDirectory(id)
  const manifest = parseThemeManifest(
    JSON.parse(await readFile(resolve(target, 'manifest.json'), 'utf8'))
  )
  const zip = new AdmZip()
  for (const file of new Set([
    'manifest.json',
    manifest.theme,
    ...Object.values(manifest.resources).map((resource) => resource.path),
    ...(manifest.licenses ?? [])
  ])) {
    const path = await checkedPath(target, file)
    zip.addFile(file, await readFile(path))
  }
  return zip.toBuffer()
}
async function checkedPath(base: string, file: string): Promise<string> {
  if ((await lstat(base)).isSymbolicLink()) throw new Error('Theme directory must not be a symlink')
  const path = await realpath(resolve(base, file))
  const inside = relative(await realpath(base), path)
  if (!inside || inside.startsWith('..') || isAbsolute(inside) || !(await lstat(path)).isFile())
    throw new Error('Invalid theme file path')
  return path
}
export async function resolveThemeResource(id: string, path: string): Promise<string> {
  const target = packageDirectory(id)
  const manifest = parseThemeManifest(
    JSON.parse(await readFile(resolve(target, 'manifest.json'), 'utf8'))
  )
  if (!Object.values(manifest.resources).some((resource) => resource.path === path))
    throw new Error('Undeclared theme resource')
  return checkedPath(target, path)
}
export async function removeThemePackage(id: string): Promise<void> {
  const target = packageDirectory(id)
  if (relative(directory(), target) !== id) throw new Error('Invalid theme directory')
  await rm(target, { recursive: true, force: true })
}
