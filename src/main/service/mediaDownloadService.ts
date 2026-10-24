import { t } from '../i18n'
import { requireBackgroundWork } from './playbackMode'
import { logError, logOperation } from './operationLogger'
import { Logger } from './loggerService'
import { BrowserWindow, Notification } from 'electron'
import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { createWriteStream, existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { saveDownloadTask } from '../database/repository'
import { finalizeDownloadedAudio } from './downloadAudioService'
import {
  backgroundRequest,
  trackProcess,
  ytdlpCommand,
  fetchMediaImage
} from './mediaDownloadRuntime'
import { resolveSourceMedia } from '../sources/download'
import { getNetworkSources } from '../sources'
import type {
  DownloadType,
  DownloadQuality,
  MediaDownloadPlan,
  HttpMediaDownloadPlan
} from '../../shared/networkSources'
export interface DownloadRequest {
  platform: string
  url: string
  title: string
  resourceId: string
  directory: string
  downloadType: DownloadType
  quality: DownloadQuality
  locale?: string
}

function downloadNotificationTitle(locale?: string): string {
  return t(
    'downloadCompleted',
    {},
    locale?.toLowerCase().startsWith('zh') ? 'zh' : locale ? 'en' : undefined
  )
}

function downloadArgs(
  request: Extract<MediaDownloadPlan, { transport: 'yt-dlp' }>,
  output: string
): string[] {
  const base = [
    '--no-playlist',
    '--embed-metadata',
    '--embed-thumbnail',
    '--newline',
    '--progress',
    '--print',
    'after_move:filepath',
    '--output',
    output
  ]
  if (request.downloadType === 'video') {
    const height = { best: 'best', high: '1080', standard: '720', compact: '480' }[request.quality]
    return [
      '--format',
      height === 'best' ? 'bv*+ba/b' : `bv*[height<=${height}]+ba/b[height<=${height}]`,
      '--merge-output-format',
      'mp4',
      ...base
    ]
  }
  const audioQuality = { best: '0', high: '2', standard: '5', compact: '7' }[request.quality]
  return [
    '--extract-audio',
    '--audio-format',
    'mp3',
    '--convert-thumbnails',
    'jpg',
    '--audio-quality',
    audioQuality,
    ...base
  ]
}

function registerProgress(
  process: ChildProcessWithoutNullStreams,
  sender: Electron.WebContents,
  taskId: string,
  request: DownloadRequest
): void {
  const started = Date.now()
  Logger.debug('[Download] process started', {
    taskId,
    pid: process.pid,
    platform: request.platform,
    type: request.downloadType,
    quality: request.quality,
    directory: request.directory
  })
  let savedFilePath = request.directory
  let diagnosticTail = ''
  const onLine = (line: string): void => {
    const progress = line.match(/\[download\]\s+([\d.]+)%/)
    if (progress)
      sender.send('media-download:progress', {
        taskId,
        status: 'downloading',
        progress: Number(progress[1])
      })
    const candidate = line.trim()
    if (/^(?:[A-Za-z]:\\|\/)/.test(candidate) && existsSync(candidate)) savedFilePath = candidate
  }
  process.stdout.on('data', (chunk: Buffer) => chunk.toString().split(/\r?\n/).forEach(onLine))
  process.stderr.on('data', (chunk: Buffer) => {
    diagnosticTail = (diagnosticTail + chunk.toString()).slice(-4096)
    chunk.toString().split(/\r?\n/).forEach(onLine)
  })
  process.once('error', (error) => {
    Logger.error('[Download] process error', { taskId, pid: process.pid }, logError(error))
    sender.send('media-download:progress', { taskId, status: 'error', progress: 0 })
  })
  process.once('close', (code, signal) => {
    const done = code === 0
    Logger[done ? 'info' : 'error'](
      '[Download] process finished',
      {
        taskId,
        pid: process.pid,
        exitCode: code,
        signal,
        filePath: savedFilePath,
        elapsedMs: Date.now() - started
      },
      ...(done ? [] : [logError(new Error(diagnosticTail.trim() || t('downloadNoDiagnostics')))])
    )
    saveDownloadTask({
      platform: request.platform,
      resourceId: request.resourceId,
      title: request.title,
      filePath: savedFilePath,
      quality: `${request.downloadType}:${request.quality}`,
      status: done ? 'done' : 'error',
      progress: done ? 100 : 0,
      extra: { url: request.url, downloadType: request.downloadType }
    })
    sender.send('media-download:progress', {
      taskId,
      status: done ? 'done' : 'error',
      progress: done ? 100 : 0,
      filePath: savedFilePath,
      title: request.title
    })
    const window = BrowserWindow.fromWebContents(sender)
    if (
      done &&
      window &&
      (!window.isFocused() || window.isMinimized()) &&
      Notification.isSupported()
    ) {
      new Notification({
        title: downloadNotificationTitle(request.locale),
        body: request.title
      }).show()
    }
  })
}

function senderError(
  sender: Electron.WebContents,
  taskId: string,
  title: string,
  reason: unknown
): void {
  Logger.error('[Download] task failed', { taskId }, logError(reason))
  sender.send('media-download:progress', {
    taskId,
    status: 'error',
    progress: 0,
    title,
    error: reason instanceof Error ? reason.message : t('downloadFailed')
  })
}

function downloadHttpMedia(
  plan: HttpMediaDownloadPlan,
  filePath: string,
  onProgress: (progress: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const mediaRequest = backgroundRequest(plan.url)
    let output: ReturnType<typeof createWriteStream> | undefined
    let failure: Error | undefined
    const fail = (error: Error): void => {
      failure ??= error
      if (output) output.destroy()
      else reject(failure)
    }
    mediaRequest.once('abort', () => fail(new Error('Download interrupted by lightweight mode')))
    mediaRequest.once('error', fail)
    Object.entries(plan.headers).forEach(([name, value]) => mediaRequest.setHeader(name, value))
    mediaRequest.on('response', (response) => {
      if ((response.statusCode ?? 0) >= 400) {
        fail(new Error(t('biliMediaFailed', { status: response.statusCode ?? 'unknown' })))
        mediaRequest.abort()
        return
      }
      const total = Number(response.headers['content-length'] || 0)
      let received = 0
      output = createWriteStream(filePath)
      // Wait for the handle to close before remuxing or removing a failed download on Windows.
      output.once('close', () => {
        if (failure) reject(failure)
        else if (output?.writableFinished) resolve()
        else reject(new Error('Downloaded file closed before completion'))
      })
      output.once('error', (error) => {
        fail(error)
        mediaRequest.abort()
      })
      response.once('error', fail)
      response.once('aborted', () => fail(new Error('Media response interrupted')))
      response.once('end', () => {
        if (total > 0 && received !== total) {
          fail(new Error('Downloaded media size does not match Content-Length'))
        } else output?.end()
      })
      response.on('data', (chunk: Buffer) => {
        if (failure) return
        received += chunk.length
        output?.write(chunk)
        if (total > 0) onProgress(Math.min(99, Math.round((received / total) * 100)))
      })
    })
    mediaRequest.end()
  })
}

async function startHttpDownload(
  sender: Electron.WebContents,
  taskId: string,
  request: DownloadRequest,
  plan: HttpMediaDownloadPlan
): Promise<void> {
  return logOperation(
    '[Download] httpTask',
    {
      taskId,
      platform: request.platform,
      type: request.downloadType,
      quality: request.quality,
      directory: request.directory
    },
    async () => {
      const { resource, extension } = plan
      const resourceSuffix = [resource.resourceId, resource.subId].filter(Boolean).join('-')
      const filePath = join(
        request.directory,
        `${request.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 180)} [${resourceSuffix.replace(/[\\/:*?"<>|]/g, '_').slice(0, 100)}].${extension}`
      )
      // Publish the final filename only after remux/validation.
      const stagingDirectory = await fs.mkdtemp(join(request.directory, '.easy-player-download-'))
      const stagedPath = join(stagingDirectory, `audio.${extension}`)
      try {
        await downloadHttpMedia(plan, stagedPath, (progress) => {
          sender.send('media-download:progress', { taskId, status: 'downloading', progress })
        })
        requireBackgroundWork()
        if (plan.finalizeAudio) {
          let coverData: Buffer | undefined
          if (plan.artwork) {
            try {
              const dataUrl = await fetchMediaImage(plan.artwork.url, plan.artwork.headers)
              coverData = Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64')
            } catch (error) {
              Logger.warn(
                '[Download] cover fetch failed; continuing without cover',
                { taskId },
                logError(error)
              )
            }
          }
          await finalizeDownloadedAudio(stagedPath, { title: request.title }, coverData)
        }
        requireBackgroundWork()
        await fs.rename(stagedPath, filePath)
      } finally {
        await fs.rm(stagingDirectory, { recursive: true, force: true }).catch((error) => {
          Logger.warn('[Download] staging cleanup failed', { stagingDirectory }, logError(error))
        })
      }
      saveDownloadTask({
        platform: request.platform,
        resourceId: resource.resourceId,
        subId: resource.subId,
        title: request.title,
        filePath,
        quality: `${request.downloadType}:${request.quality}`,
        status: 'done',
        progress: 100,
        extra: { url: request.url, downloadType: request.downloadType }
      })
      sender.send('media-download:progress', {
        taskId,
        status: 'done',
        progress: 100,
        filePath,
        title: request.title
      })
    },
    { successLevel: 'info' }
  )
}

/** Starts a host-owned task. Providers only resolve a plan and never receive the destination. */
export function startMediaDownload(
  sender: Electron.WebContents,
  request: DownloadRequest
): { taskId: string } {
  requireBackgroundWork()
  if (!request.directory || !request.url || !request.resourceId)
    throw new Error(t('downloadParamsIncomplete'))
  if (
    !['audio', 'video'].includes(request.downloadType) ||
    !['best', 'high', 'standard', 'compact'].includes(request.quality)
  )
    throw new Error(t('downloadParamsIncomplete'))
  const registry = getNetworkSources()
  const source = registry.findDownload(request.url)
  if (source.id !== request.platform) throw new Error('Download source does not match URL')
  registry.requireDownload(source.id)
  const taskId = source.id + '-' + randomUUID()
  void (async () => {
    const plan = await resolveSourceMedia(source.id, {
      url: request.url,
      resourceId: request.resourceId,
      downloadType: request.downloadType,
      quality: request.quality
    })
    requireBackgroundWork()
    if (plan.transport === 'http') {
      await startHttpDownload(sender, taskId, request, plan)
    } else {
      const output = join(request.directory, '%(title).180B [%(id)s].%(ext)s')
      const child = trackProcess(
        spawn(ytdlpCommand(), [...downloadArgs(plan, output), plan.url], { windowsHide: true })
      )
      registerProgress(child, sender, taskId, request)
    }
  })().catch((reason) => senderError(sender, taskId, request.title, reason))
  return { taskId }
}
