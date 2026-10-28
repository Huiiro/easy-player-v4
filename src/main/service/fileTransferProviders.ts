import { Client as FtpClient } from 'basic-ftp'
import { Client as SshClient } from 'ssh2'
import type { SFTPWrapper, Stats } from 'ssh2'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { posix } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import type { RemoteConnection, RemoteProviderId } from '../../shared/remoteSources'
import type { RemoteProvider, RemoteTrack } from './remoteProvider'
import { waitForBackgroundWork } from './playbackMode'
import { nasTrack, MAX_NAS_ENTRIES } from './nasFileModel'

interface FileEntry {
  name: string
  directory: boolean
  file: boolean
  size: number
}
interface FileSession {
  list(path: string): Promise<FileEntry[]>
  read(path: string): Promise<Readable>
  close(): void
}

export function transferPath(root: string, id: string): string {
  if (
    id.startsWith('/') ||
    id.split('/').some((part) => part === '..' || part === '.') ||
    /[\r\n\0\\]/.test(id)
  )
    throw new Error('Invalid remote file path')
  return posix.join(root, id)
}

async function openFtp(config: RemoteConnection): Promise<FileSession> {
  const url = new URL(config.baseUrl)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const client = new FtpClient(20_000)
  try {
    await client.access({
      host,
      port: Number(url.port || (config.type === 'ftps-implicit' ? 990 : 21)),
      user: config.auth.type === 'password' ? config.auth.username : 'anonymous',
      password: config.auth.type === 'password' ? config.auth.password : 'guest@',
      secure: config.type === 'ftps-implicit' ? 'implicit' : config.type === 'ftps',
      secureOptions: {
        rejectUnauthorized: true,
        servername: isIP(host) ? undefined : host
      }
    })
    await client.cd(decodeURIComponent(url.pathname) || '/')
    const root = await client.pwd()
    return {
      async list(id) {
        return (await client.list(transferPath(root, id))).map((entry) => ({
          name: entry.name,
          directory: entry.isDirectory,
          file: entry.isFile,
          size: entry.size
        }))
      },
      async read(id) {
        const stream = new PassThrough()
        // The consumer drains concurrently; never await the transfer before returning its stream.
        void client
          .downloadTo(stream, transferPath(root, id))
          .catch((error) => stream.destroy(error))
        return stream
      },
      close: () => client.close()
    }
  } catch (error) {
    client.close()
    throw error
  }
}

async function openSftp(config: RemoteConnection): Promise<FileSession> {
  const url = new URL(config.baseUrl)
  const host = url.hostname.replace(/^\[|\]$/g, '')
  const client = new SshClient()
  let active: Readable | undefined
  client.on('error', (error) => active?.destroy(error))
  try {
    await new Promise<void>((resolve, reject) => {
      client
        .once('ready', resolve)
        .once('error', reject)
        .once('close', () => reject(new Error('SFTP connection closed')))
      client.connect({
        host,
        port: Number(url.port || 22),
        username: 'username' in config.auth ? config.auth.username : '',
        password: config.auth.type === 'password' ? config.auth.password : undefined,
        privateKey: config.auth.type === 'private-key' ? config.auth.privateKey : undefined,
        passphrase: config.auth.type === 'private-key' ? config.auth.passphrase : undefined,
        readyTimeout: 20_000,
        keepaliveInterval: 10_000,
        keepaliveCountMax: 2,
        hostVerifier: (key) =>
          `SHA256:${createHash('sha256').update(key).digest('base64').replace(/=+$/, '')}` ===
          config.hostKey?.replace(/=+$/, '')
      })
    })
    const sftp = await new Promise<SFTPWrapper>((resolve, reject) =>
      client.sftp((error, sftp) => (error ? reject(error) : resolve(sftp)))
    )
    const call = <T>(
      task: (callback: (error: Error | undefined | null, result: T) => void) => void
    ): Promise<T> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          client.end()
          reject(new Error('SFTP operation timed out'))
        }, 20_000)
        const closed = (): void => {
          clearTimeout(timer)
          reject(new Error('SFTP connection closed'))
        }
        client.once('close', closed)
        task((error, result) => {
          clearTimeout(timer)
          client.off('close', closed)
          if (error) reject(error)
          else resolve(result)
        })
      })
    const root = await call<string>((callback) =>
      sftp.realpath(decodeURIComponent(url.pathname) || '/', callback)
    )
    const path = async (id: string): Promise<string> => {
      const actual = await call<string>((callback) =>
        sftp.realpath(transferPath(root, id), callback)
      )
      if (actual !== root && !actual.startsWith(root.endsWith('/') ? root : `${root}/`))
        throw new Error('SFTP resource is outside the configured directory')
      return actual
    }
    const rootStats = await call<Stats>((callback) => sftp.stat(root, callback))
    if (!rootStats.isDirectory()) throw new Error('SFTP URL must point to a directory')
    return {
      async list(id) {
        const target = await path(id)
        const entries = await call<Array<{ filename: string; attrs: Stats }>>((callback) =>
          sftp.readdir(target, callback)
        )
        return entries.map((entry) => ({
          name: entry.filename,
          directory: entry.attrs.isDirectory(),
          file: entry.attrs.isFile(),
          size: entry.attrs.size
        }))
      },
      async read(id) {
        const target = await path(id)
        if (!(await call<Stats>((callback) => sftp.stat(target, callback))).isFile())
          throw new Error('SFTP resource is not a file')
        active = sftp.createReadStream(target)
        active.setMaxListeners(20)
        return active
      },
      close: () => client.end()
    }
  } catch (error) {
    client.end()
    throw error
  }
}

function fileProvider(
  id: RemoteProviderId,
  open: (config: RemoteConnection) => Promise<FileSession>
): RemoteProvider {
  return {
    id,
    async test(config) {
      const session = await open(config)
      try {
        await session.list('')
        return { version: '' }
      } finally {
        session.close()
      }
    },
    async listTracks(config) {
      const session = await open(config)
      try {
        const pending = ['']
        const tracks: RemoteTrack[] = []
        let count = 0
        while (pending.length) {
          await waitForBackgroundWork()
          const directory = pending.pop()!
          for (const entry of await session.list(directory)) {
            if (++count > MAX_NAS_ENTRIES) throw new Error('NAS library exceeds the entry limit')
            if (entry.name === '.' || entry.name === '..') continue
            if (!entry.name || entry.name.includes('/') || /[\\\r\n\0]/.test(entry.name))
              throw new Error('Invalid NAS directory entry')
            const child = directory ? `${directory}/${entry.name}` : entry.name
            if (entry.directory) pending.push(child)
            else if (entry.file) {
              const track = nasTrack(child, entry.size)
              if (track) tracks.push(track)
            }
          }
        }
        return tracks
      } finally {
        session.close()
      }
    },
    fetchCover: async () => new Response(null, { status: 404 }),
    async fetchStream(config, id) {
      const session = await open(config)
      try {
        const stream = await session.read(id)
        const timer = setTimeout(
          () => stream.destroy(new Error('NAS download timed out')),
          20 * 60_000
        )
        stream.once('close', () => {
          clearTimeout(timer)
          session.close()
        })
        return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>)
      } catch (error) {
        session.close()
        throw error
      }
    }
  }
}

export const ftpProvider = fileProvider('ftp', openFtp)
export const ftpsProvider = fileProvider('ftps', openFtp)
export const implicitFtpsProvider = fileProvider('ftps-implicit', openFtp)
export const sftpProvider = fileProvider('sftp', openSftp)
