import { DOMParser } from '@xmldom/xmldom'
import { createReadStream, promises as fs } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import type { RemoteConnection } from '../../shared/remoteSources'
import type { RemoteProvider, RemoteTrack } from './remoteProvider'
import { waitForBackgroundWork } from './playbackMode'

import { nasTrack, MAX_NAS_ENTRIES } from './nasFileModel'
const MAX_XML = 5 * 1024 * 1024

function davRoot(config: RemoteConnection): URL {
  const url = new URL(config.baseUrl.trim())
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error(
      'WebDAV requires an HTTP(S) directory URL without embedded credentials or query parameters'
    )
  if (!url.pathname.endsWith('/')) url.pathname += '/'
  return url
}

function davUrl(config: RemoteConnection, path: string): URL {
  const root = davRoot(config)
  const url = new URL(path, root)
  if (
    url.origin !== root.origin ||
    !url.pathname.startsWith(root.pathname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('WebDAV resource is outside the configured directory')
  // Reject encoded traversal/separators before forwarding authenticated requests.
  const decoded = decodeURIComponent(url.pathname)
  if (
    decoded.split('/').some((part) => part === '..' || part === '.') ||
    /%2f|%5c/i.test(url.pathname) ||
    decoded.includes('\\')
  )
    throw new Error('Invalid WebDAV resource path')
  return url
}

async function davFetch(
  config: RemoteConnection,
  path: string,
  method = 'GET',
  depth = '1'
): Promise<Response> {
  const headers: Record<string, string> = {}
  if (config.auth.type === 'basic')
    headers.Authorization = `Basic ${Buffer.from(`${config.auth.username}:${config.auth.password}`).toString('base64')}`
  if (config.auth.type === 'bearer') headers.Authorization = `Bearer ${config.auth.token}`
  if (method === 'PROPFIND') {
    headers.Depth = depth
    headers['Content-Type'] = 'application/xml; charset=utf-8'
  }
  const response = await fetch(davUrl(config, path), {
    method,
    headers,
    redirect: 'error',
    signal: AbortSignal.timeout(20_000),
    body:
      method === 'PROPFIND'
        ? '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:resourcetype/><d:getcontentlength/></d:prop></d:propfind>'
        : undefined
  })
  if (!response.ok) throw new Error(`WebDAV request failed (${response.status})`)
  return response
}

async function listDav(
  config: RemoteConnection,
  path: string,
  depth = '1'
): Promise<Array<{ path: string; directory: boolean; size: number }>> {
  const response = await davFetch(config, path, 'PROPFIND', depth)
  if (response.status !== 207 || !response.body)
    throw new Error('Invalid WebDAV multistatus response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.length
      if (length > MAX_XML) throw new Error('WebDAV directory response is too large')
      chunks.push(value)
    }
  } finally {
    await reader.cancel()
  }
  const xml = Buffer.concat(chunks).toString('utf8')
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Unsupported WebDAV XML declaration')
  const doc = new DOMParser({
    onError: () => {
      throw new Error('Invalid WebDAV XML')
    }
  }).parseFromString(xml, 'application/xml')
  if (
    doc.documentElement?.localName !== 'multistatus' ||
    doc.documentElement.namespaceURI !== 'DAV:'
  )
    throw new Error('Invalid WebDAV XML root')
  const root = davRoot(config)
  const result: Array<{ path: string; directory: boolean; size: number }> = []
  for (const entry of Array.from(doc.getElementsByTagNameNS('DAV:', 'response'))) {
    const href = entry.getElementsByTagNameNS('DAV:', 'href')[0]?.textContent
    if (!href) throw new Error('WebDAV response is missing href')
    const url = davUrl(config, new URL(href, davUrl(config, path)).href)
    const propstats = Array.from(entry.getElementsByTagNameNS('DAV:', 'propstat'))
    const props = propstats.filter((propstat) =>
      /HTTP\/\S+ 2\d\d\b/.test(
        propstat.getElementsByTagNameNS('DAV:', 'status')[0]?.textContent || ''
      )
    )
    if (!props.length) throw new Error('WebDAV resource properties are inaccessible')
    result.push({
      path: url.pathname.slice(root.pathname.length),
      directory: props.some((prop) => prop.getElementsByTagNameNS('DAV:', 'collection').length > 0),
      size:
        Number(
          props.flatMap((prop) =>
            Array.from(prop.getElementsByTagNameNS('DAV:', 'getcontentlength'))
          )[0]?.textContent
        ) || 0
    })
  }
  return result
}

const noCover = async (): Promise<Response> => new Response(null, { status: 404 })

export const webdavProvider: RemoteProvider = {
  id: 'webdav',
  async test(config) {
    const entries = await listDav(config, '', '0')
    if (!entries.some((entry) => entry.path === '' && entry.directory))
      throw new Error('WebDAV URL must point to a directory')
    return { version: '' }
  },
  async listTracks(config) {
    const pending = ['']
    const visited = new Set<string>()
    const tracks = new Map<string, RemoteTrack>()
    let count = 0
    while (pending.length) {
      await waitForBackgroundWork()
      const directory = pending.pop()!
      if (visited.has(directory)) continue
      visited.add(directory)
      for (const entry of await listDav(config, directory)) {
        if (++count > MAX_NAS_ENTRIES) throw new Error('NAS library exceeds the entry limit')
        if (entry.directory) {
          const child = entry.path && !entry.path.endsWith('/') ? `${entry.path}/` : entry.path
          if (!visited.has(child)) pending.push(child)
        } else {
          const item = nasTrack(decodeURIComponent(entry.path), entry.size)
          if (item) tracks.set(entry.path, { ...item, id: entry.path })
        }
      }
    }
    return [...tracks.values()]
  },
  fetchCover: noCover,
  fetchStream: (config, id) => davFetch(config, id)
}

/** SMB authentication and mounting belong to the OS; never invoke shell mount commands. */
export function smbRoot(config: RemoteConnection): string {
  let path = config.baseUrl.trim()
  if (path.startsWith('smb://')) {
    const url = new URL(path)
    if (process.platform !== 'win32')
      throw new Error('Mount the SMB share in your OS and enter its absolute directory path')
    if (
      url.username ||
      url.password ||
      url.port ||
      url.search ||
      url.hash ||
      !url.hostname ||
      url.pathname === '/'
    )
      throw new Error('Invalid SMB share URL')
    path = `\\\\${url.hostname}${decodeURIComponent(url.pathname).replace(/\//g, '\\')}`
  }
  if (!isAbsolute(path)) throw new Error('Enter an absolute mounted share path or Windows UNC path')
  return resolve(path)
}

async function smbPath(config: RemoteConnection, id: string): Promise<string> {
  const root = await fs.realpath(smbRoot(config))
  const path = await fs.realpath(resolve(root, id))
  const child = relative(root, path)
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child))
    throw new Error('SMB resource is outside the configured directory')
  return path
}

export const smbProvider: RemoteProvider = {
  id: 'smb',
  async test(config) {
    if (!(await fs.stat(smbRoot(config))).isDirectory())
      throw new Error('SMB path must be a directory')
    await fs.readdir(smbRoot(config))
    return { version: '' }
  },
  async listTracks(config) {
    const root = smbRoot(config)
    const pending = ['']
    const tracks: RemoteTrack[] = []
    let count = 0
    while (pending.length) {
      await waitForBackgroundWork()
      const directory = pending.pop()!
      for (const entry of await fs.readdir(await smbPath(config, directory), {
        withFileTypes: true
      })) {
        if (++count > MAX_NAS_ENTRIES) throw new Error('NAS library exceeds the entry limit')
        const id = directory ? `${directory}/${entry.name}` : entry.name
        if (entry.isDirectory()) pending.push(id)
        else if (entry.isFile()) {
          const item = nasTrack(id, (await fs.stat(resolve(root, id))).size)
          if (item) tracks.push(item)
        }
      }
    }
    return tracks
  },
  fetchCover: noCover,
  async fetchStream(config, id) {
    const path = await smbPath(config, id)
    const stat = await fs.stat(path)
    if (!stat.isFile()) throw new Error('SMB resource is not a file')
    return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, {
      headers: { 'Content-Length': String(stat.size) }
    })
  }
}
