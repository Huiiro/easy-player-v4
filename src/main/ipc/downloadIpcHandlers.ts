import { app, BrowserWindow, dialog, ipcMain, net, Notification, shell } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createWriteStream, existsSync } from 'node:fs'
import { join } from 'node:path'
import { listDownloadTasks, saveDownloadTask } from '../database/repository'

type DownloadPlatform = 'youtube' | 'bili'
type DownloadType = 'audio' | 'video'
type DownloadQuality = 'best' | 'high' | 'standard' | 'compact'
interface DownloadSearchItem {
  platform: DownloadPlatform
  selected?: boolean
  id: string
  title: string
  url: string
  thumbnail: string | null
  thumbnailUrl?: string | null
  duration: number | null
  uploader: string | null
}
interface DownloadRequest {
  platform: DownloadPlatform
  url: string
  title: string
  resourceId: string
  directory: string
  downloadType: DownloadType
  quality: DownloadQuality
  locale?: string
}

function downloadNotificationTitle(locale?: string): string {
  return (locale || app.getLocale()).toLowerCase().startsWith('zh')
    ? '下载完成'
    : 'Download completed'
}

function ytdlpCommand(): string {
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

function runYtDlp(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const process = spawn(ytdlpCommand(), args, { windowsHide: true })
    let stdout = ''
    let stderr = ''
    process.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()))
    process.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    process.once('error', () =>
      reject(new Error('未找到 yt-dlp。请安装它或设置 EASY_PLAYER_YTDLP_PATH。'))
    )
    process.once('close', (code) => {
      if (code === 0) resolve(stdout)
      else {
        const detail = stderr.trim()
        reject(new Error(detail || `yt-dlp 执行失败（退出码 ${code ?? 'unknown'}）。`))
      }
    })
  })
}

function toSearchItem(
  entry: Record<string, unknown>,
  platform: DownloadPlatform
): DownloadSearchItem | null {
  const id = typeof entry.id === 'string' ? entry.id : ''
  const title = typeof entry.title === 'string' ? entry.title : ''
  const url =
    typeof entry.webpage_url === 'string'
      ? entry.webpage_url
      : typeof entry.url === 'string'
        ? entry.url
        : ''
  if (!id || !title || !url) return null
  return {
    platform,
    id,
    title,
    url,
    thumbnail: typeof entry.thumbnail === 'string' ? entry.thumbnail : null,
    duration: typeof entry.duration === 'number' ? entry.duration : null,
    uploader:
      typeof entry.uploader === 'string'
        ? entry.uploader
        : typeof entry.channel === 'string'
          ? entry.channel
          : null
  }
}

function platformArgs(platform: DownloadPlatform): string[] {
  if (platform !== 'bili') return []
  const args = [
    '--add-headers',
    'Referer:https://www.bilibili.com/',
    '--add-headers',
    'User-Agent:Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  ]
  return args
}

function platformFromUrl(url: string): DownloadPlatform {
  return /(^|\.)bilibili\.com/i.test(new URL(url).hostname) ? 'bili' : 'youtube'
}

const BILI_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Origin: 'https://www.bilibili.com',
  Referer: 'https://www.bilibili.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
}

function biliApi<T>(url: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url })
    Object.entries(BILI_HEADERS).forEach(([name, value]) => request.setHeader(name, value))
    request.on('response', (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer) => chunks.push(chunk))
      response.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString()) as {
            code?: number
            message?: string
            data: T
          }
          if (parsed.code !== 0 || !parsed.data)
            reject(
              new Error(parsed.message || `哔哩哔哩接口请求失败（${parsed.code ?? 'unknown'}）。`)
            )
          else resolve(parsed.data)
        } catch {
          reject(new Error('哔哩哔哩返回了无法识别的数据。'))
        }
      })
    })
    request.on('error', reject)
    request.end()
  })
}

function biliBvid(url: string): string | null {
  return url.match(/BV[\w]+/i)?.[0] ?? null
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]+>/g, '').trim()
}

function normalizeBiliUrl(value: string): string {
  if (value.startsWith('//')) return `https:${value}`
  return value.replace(/^http:\/\//i, 'https://')
}

function biliImageDataUrl(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const request = net.request({ method: 'GET', url })
    Object.entries(BILI_HEADERS).forEach(([name, value]) => request.setHeader(name, value))
    request.on('response', (response) => {
      const chunks: Buffer[] = []
      let size = 0
      response.on('data', (chunk: Buffer) => {
        size += chunk.length
        if (size <= 5 * 1024 * 1024) chunks.push(chunk)
      })
      response.on('end', () => {
        if (size > 5 * 1024 * 1024) return reject(new Error('封面文件过大。'))
        const mimeType = String(response.headers['content-type'] || 'image/jpeg').split(';')[0]
        resolve(`data:${mimeType};base64,${Buffer.concat(chunks).toString('base64')}`)
      })
    })
    request.on('error', reject)
    request.end()
  })
}

async function extractBiliItems(target: string, search = false): Promise<DownloadSearchItem[]> {
  if (search) {
    const query = target.replace(/^bilisearch\d+:/, '')
    const data = await biliApi<{ result?: Array<Record<string, unknown>> }>(
      `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(query)}`
    )
    return (data.result ?? []).slice(0, 12).flatMap((entry) => {
      const bvid = typeof entry.bvid === 'string' ? entry.bvid : ''
      if (!bvid) return []
      return [
        {
          platform: 'bili' as const,
          id: bvid,
          title: stripHtml(String(entry.title ?? '未命名视频')),
          url: `https://www.bilibili.com/video/${bvid}`,
          thumbnail: null,
          thumbnailUrl: typeof entry.pic === 'string' ? normalizeBiliUrl(entry.pic) : null,
          duration: null,
          uploader: typeof entry.author === 'string' ? entry.author : null
        }
      ]
    })
  }
  const bvid = biliBvid(target)
  if (!bvid) throw new Error('未识别到有效的哔哩哔哩 BV 号。')
  const requestedPage = Math.max(1, Number(new URL(target).searchParams.get('p') || '1'))
  const data = await biliApi<{
    bvid: string
    cid: number
    title: string
    pic?: string
    duration?: number
    owner?: { name?: string }
    pages?: Array<{ cid: number; part?: string; duration?: number; page?: number }>
    ugc_season?: {
      sections?: Array<{
        episodes?: Array<{
          bvid: string
          cid: number
          title: string
          cover?: string
          pic?: string
          arc?: { pic?: string }
          pages?: Array<{ cid: number; part?: string; duration?: number; page?: number }>
        }>
      }>
    }
  }>(`https://api.bilibili.com/x/web-interface/wbi/view?bvid=${bvid}`)
  const thumbnailUrl = data.pic ? normalizeBiliUrl(data.pic) : null
  const seasonPages = (data.ugc_season?.sections ?? []).flatMap((section) =>
    (section.episodes ?? []).flatMap((episode) => {
      const pages = episode.pages?.length
        ? episode.pages
        : [{ cid: episode.cid, part: episode.title, page: 1 }]
      return pages.map((page, index) => ({
        bvid: episode.bvid,
        cid: page.cid,
        title:
          pages.length > 1
            ? `${episode.title} - P${index + 1} ${page.part || ''}`.trim()
            : episode.title,
        duration: page.duration,
        page: page.page ?? index + 1,
        thumbnail: episode.arc?.pic ?? episode.cover ?? episode.pic ?? data.pic
      }))
    })
  )
  if (seasonPages.length) {
    return seasonPages.map((page) => ({
      platform: 'bili' as const,
      id: `${page.bvid}:${page.cid}`,
      title: page.title,
      url: `https://www.bilibili.com/video/${page.bvid}?p=${page.page}`,
      thumbnail: null,
      thumbnailUrl: page.thumbnail ? normalizeBiliUrl(page.thumbnail) : thumbnailUrl,
      duration: page.duration ?? null,
      uploader: data.owner?.name ?? null,
      selected: page.bvid.toLowerCase() === bvid.toLowerCase() && page.page === requestedPage
    }))
  }
  const pages = data.pages?.length
    ? data.pages
    : [{ cid: data.cid, part: data.title, duration: data.duration }]
  return pages.map((page, index) => ({
    platform: 'bili' as const,
    id: `${data.bvid}:${page.cid}`,
    title:
      pages.length > 1 ? `${data.title} - P${index + 1} ${page.part || ''}`.trim() : data.title,
    url: `https://www.bilibili.com/video/${data.bvid}?p=${page.page ?? index + 1}`,
    thumbnail: null,
    thumbnailUrl,
    duration: page.duration ?? data.duration ?? null,
    uploader: data.owner?.name ?? null,
    selected: (page.page ?? index + 1) === requestedPage
  }))
}

async function extractItems(
  target: string,
  platform: DownloadPlatform
): Promise<DownloadSearchItem[]> {
  if (platform === 'bili') return extractBiliItems(target, target.startsWith('bilisearch'))
  const output = await runYtDlp([
    '--dump-single-json',
    '--flat-playlist',
    '--skip-download',
    '--no-warnings',
    ...platformArgs(platform),
    target
  ])
  const parsed = JSON.parse(output) as Record<string, unknown>
  const entries = Array.isArray(parsed.entries) ? parsed.entries : [parsed]
  return entries
    .map((entry) => toSearchItem(entry as Record<string, unknown>, platform))
    .filter((item): item is DownloadSearchItem => !!item)
}

function downloadArgs(request: DownloadRequest, output: string): string[] {
  const base = [
    '--no-playlist',
    '--embed-metadata',
    '--embed-thumbnail',
    ...platformArgs(request.platform),
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
  let savedFilePath = request.directory
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
  process.stderr.on('data', (chunk: Buffer) => chunk.toString().split(/\r?\n/).forEach(onLine))
  process.once('error', () =>
    sender.send('media-download:progress', { taskId, status: 'error', progress: 0 })
  )
  process.once('close', (code) => {
    const done = code === 0
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
  sender.send('media-download:progress', {
    taskId,
    status: 'error',
    progress: 0,
    title,
    error: reason instanceof Error ? reason.message : '下载失败。'
  })
}

async function startBiliDownload(
  sender: Electron.WebContents,
  taskId: string,
  request: DownloadRequest
): Promise<void> {
  const bvid = biliBvid(request.url)
  if (!bvid) throw new Error('未识别到有效的哔哩哔哩 BV 号。')
  const view = await biliApi<{ cid: number; pages?: Array<{ cid: number; page?: number }> }>(
    `https://api.bilibili.com/x/web-interface/wbi/view?bvid=${bvid}`
  )
  const pageNumber = Number(new URL(request.url).searchParams.get('p') || '1')
  const cid = view.pages?.find((page) => page.page === pageNumber)?.cid ?? view.cid
  const play = await biliApi<{
    durl?: Array<{ url?: string }>
    dash?: { audio?: Array<{ baseUrl?: string; base_url?: string; bandwidth?: number }> }
  }>(
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&fnval=${request.downloadType === 'video' ? '16' : '4048'}&fnver=0&fourk=0`
  )
  const source =
    request.downloadType === 'video'
      ? play.durl?.[0]?.url
      : ([...(play.dash?.audio ?? [])].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0]
          ?.baseUrl ??
        [...(play.dash?.audio ?? [])].sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0))[0]
          ?.base_url)
  if (!source) throw new Error('未获取到可下载的哔哩哔哩媒体地址。')
  const extension = request.downloadType === 'video' ? 'mp4' : 'm4a'
  const filePath = join(
    request.directory,
    `${request.title.replace(/[\\/:*?"<>|]/g, '_').slice(0, 180)} [${bvid}-${cid}].${extension}`
  )
  await new Promise<void>((resolve, reject) => {
    const mediaRequest = net.request({ method: 'GET', url: source })
    Object.entries(BILI_HEADERS).forEach(([name, value]) => mediaRequest.setHeader(name, value))
    mediaRequest.setHeader('Range', 'bytes=0-')
    mediaRequest.on('response', (response) => {
      if ((response.statusCode ?? 0) >= 400) {
        reject(new Error(`哔哩哔哩媒体请求失败（HTTP ${response.statusCode}）。`))
        return
      }
      const total = Number(response.headers['content-length'] || 0)
      let received = 0
      const output = createWriteStream(filePath)
      response.on('data', (chunk: Buffer) => {
        received += chunk.length
        output.write(chunk)
        if (total > 0)
          sender.send('media-download:progress', {
            taskId,
            status: 'downloading',
            progress: Math.min(99, Math.round((received / total) * 100))
          })
      })
      response.once('error', reject)
      response.once('end', () => output.end(resolve))
      output.once('error', reject)
    })
    mediaRequest.on('error', reject)
    mediaRequest.end()
  })
  saveDownloadTask({
    platform: request.platform,
    resourceId: bvid,
    subId: String(cid),
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
}

export function registerDownloadIpcHandlers(): void {
  ipcMain.handle('media-download:choose-directory', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const result = window
      ? await dialog.showOpenDialog(window, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    return result.canceled ? null : (result.filePaths[0] ?? null)
  })
  ipcMain.handle('media-download:history', () => listDownloadTasks())
  ipcMain.handle('media-download:thumbnail', async (_event, url: string) => {
    let hostname = ''
    try {
      hostname = new URL(url).hostname
    } catch {
      throw new Error('无效的封面地址。')
    }
    if (!/(^|\.)hdslb\.com$/i.test(hostname)) throw new Error('不支持的封面来源。')
    return biliImageDataUrl(url)
  })
  ipcMain.handle('media-download:show-in-folder', (_event, filePath: string) => {
    if (!filePath || !existsSync(filePath))
      return { success: false, error: '下载文件不存在或已被移动。' }
    shell.showItemInFolder(filePath)
    return { success: true }
  })
  ipcMain.handle(
    'media-download:search',
    async (
      _event,
      request: {
        platform: DownloadPlatform
        query: string
      }
    ) => {
      const query = request.query.trim()
      if (!query) throw new Error('请输入搜索关键词。')
      const prefix = request.platform === 'youtube' ? 'ytsearch12:' : 'bilisearch12:'
      return extractItems(`${prefix}${query}`, request.platform)
    }
  )
  ipcMain.handle('media-download:parse', async (_event, request: { url: string }) => {
    const url = request.url.trim()
    if (!/^https?:\/\//i.test(url)) throw new Error('请输入有效的视频链接。')
    const platform = platformFromUrl(url)
    return extractItems(url, platform)
  })
  ipcMain.handle('media-download:start', (event, request: DownloadRequest) => {
    if (!request.directory || !request.url || !request.resourceId)
      throw new Error('下载参数不完整。')
    const taskId = `${request.platform}-${request.resourceId}-${Date.now()}`
    if (request.platform === 'bili') {
      void startBiliDownload(event.sender, taskId, request).catch((reason) => {
        senderError(event.sender, taskId, request.title, reason)
      })
      return { taskId }
    }
    const output = join(request.directory, '%(title).180B [%(id)s].%(ext)s')
    const process = spawn(ytdlpCommand(), [...downloadArgs(request, output), request.url], {
      windowsHide: true
    })
    registerProgress(process, event.sender, taskId, request)
    return { taskId }
  })
}
