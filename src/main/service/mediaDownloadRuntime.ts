import { app, net } from 'electron'
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { t } from '../i18n'
import { onPlaybackModeChanged, requireBackgroundWork } from './playbackMode'
import { logOperation } from './operationLogger'
import type { MediaInfoRequest } from '../../../packages/plugin-sdk/src/host'
import { SourceCallError } from '../sources/errors'

/** Public SDK capability: only metadata extraction, no plugin-supplied flags or paths. */
export async function extractMediaInfo(
  request: MediaInfoRequest,
  signal: AbortSignal
): Promise<Record<string, unknown>> {
  signal.throwIfAborted()
  requireBackgroundWork()
  let target: string
  if (request?.type === 'search') {
    const limit = request.limit ?? 12
    if (
      typeof request.query !== 'string' ||
      !request.query.trim() ||
      request.query.length > 2000 ||
      !Number.isInteger(limit) ||
      limit < 1 ||
      limit > 20
    )
      throw new SourceCallError('INVALID_REQUEST')
    target = `ytsearch${limit}:${request.query.trim()}`
  } else if (request?.type === 'url' && typeof request.url === 'string') {
    let url: URL
    try {
      url = new URL(request.url)
    } catch {
      throw new SourceCallError('INVALID_REQUEST')
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      request.url.length > 8192
    )
      throw new SourceCallError('INVALID_REQUEST')
    target = url.href
  } else throw new SourceCallError('INVALID_REQUEST')
  const output = await runYtDlp(
    ['--dump-single-json', '--flat-playlist', '--skip-download', '--no-warnings', '--', target],
    signal
  )
  signal.throwIfAborted()
  const result: unknown = JSON.parse(output)
  if (!result || typeof result !== 'object' || Array.isArray(result))
    throw new SourceCallError('INVALID_RESPONSE')
  return result as Record<string, unknown>
}
export function trackProcess(
  child: ChildProcessWithoutNullStreams,
  signal?: AbortSignal
): ChildProcessWithoutNullStreams {
  let terminating = false
  const terminate = (): void => {
    if (terminating || !child.pid) return
    terminating = true
    if (process.platform === 'win32') {
      // yt-dlp may own ffmpeg; terminate only this task's process tree.
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true
      })
      killer.on('error', () => child.kill())
    } else child.kill()
  }
  const cleanup = onPlaybackModeChanged((enabled) => {
    if (enabled) terminate()
  })
  signal?.addEventListener('abort', terminate, { once: true })
  if (signal?.aborted) terminate()
  child.once('close', () => {
    cleanup()
    signal?.removeEventListener('abort', terminate)
  })
  return child
}

export function backgroundRequest(url: string, signal?: AbortSignal): Electron.ClientRequest {
  signal?.throwIfAborted()
  requireBackgroundWork()
  const request = net.request({ method: 'GET', url })
  const cleanup = onPlaybackModeChanged((enabled) => {
    if (enabled) request.abort()
  })
  const abort = (): void => request.abort()
  signal?.addEventListener('abort', abort, { once: true })
  request.once('close', () => {
    cleanup()
    signal?.removeEventListener('abort', abort)
  })
  return request
}

export function ytdlpCommand(): string {
  const executable = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
  const sourceDirectory =
    process.platform === 'win32'
      ? 'win'
      : process.platform === 'darwin'
        ? 'mac'
        : join('linux', process.arch)
  const bundled = join(
    app.isPackaged ? process.resourcesPath : app.getAppPath(),
    'tools',
    'yt-dlp',
    ...(app.isPackaged ? [executable] : [sourceDirectory, executable])
  )
  if (existsSync(bundled)) return bundled
  return process.env.EASY_PLAYER_YTDLP_PATH || 'yt-dlp'
}

export function runYtDlp(args: string[], signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  requireBackgroundWork()
  return logOperation(
    '[Download] runYtDlp',
    { executable: ytdlpCommand(), argumentCount: args.length },
    () => {
      return new Promise((resolve, reject) => {
        const process = trackProcess(spawn(ytdlpCommand(), args, { windowsHide: true }), signal)
        const abort = (): void => reject(signal?.reason)
        signal?.addEventListener('abort', abort, { once: true })
        if (signal?.aborted) abort()
        let stdout = ''
        let stderr = ''
        process.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
        process.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
        process.once('error', () => reject(new Error(t('ytdlpMissing'))))
        process.once('close', (code) => {
          signal?.removeEventListener('abort', abort)
          if (code === 0) resolve(stdout)
          else {
            const detail = stderr.trim()
            reject(new Error(detail || t('ytdlpFailed', { code: code ?? 'unknown' })))
          }
        })
      })
    },
    { successLevel: 'debug' }
  )
}

export function fetchMediaImage(url: string, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = backgroundRequest(url)
    const timeout = setTimeout(() => {
      reject(new Error('Cover request timed out'))
      request.abort()
    }, 15000)
    request.once('close', () => clearTimeout(timeout))
    request.once('abort', () => reject(new Error('Lightweight mode')))
    Object.entries(headers).forEach(([name, value]) => request.setHeader(name, value))
    request.on('response', (response) => {
      if ((response.statusCode ?? 0) >= 400) {
        reject(new Error(`Cover request failed: ${response.statusCode}`))
        request.abort()
        return
      }
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size <= 5 * 1024 * 1024) chunks.push(chunk)
      })
      response.on('end', () => {
        if (size > 5 * 1024 * 1024) return reject(new Error(t('coverTooLarge')))
        const mimeType = String(response.headers['content-type'] || 'image/jpeg').split(';')[0]
        resolve(`data:${mimeType};base64,${Buffer.concat(chunks).toString('base64')}`)
      })
      response.once('error', reject)
      response.once('aborted', () => reject(new Error('Cover response interrupted')))
    })
    request.on('error', reject)
    request.end()
  })
}
