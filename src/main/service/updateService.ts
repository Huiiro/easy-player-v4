import { app, BrowserWindow } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'

export type UpdateStatus =
  | { state: 'idle'; version: string }
  | { state: 'checking'; version: string }
  | { state: 'available'; version: string; releaseNotes?: string | null }
  | { state: 'not-available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string; releaseNotes?: string | null }
  | { state: 'error'; version: string; message: string }

let status: UpdateStatus = { state: 'idle', version: app.getVersion() }
let initialized = false

function releaseNotes(info: UpdateInfo): string | null {
  if (typeof info.releaseNotes === 'string') return info.releaseNotes
  if (Array.isArray(info.releaseNotes)) return info.releaseNotes.map((note) => note.note).join('\n')
  return null
}

function publishStatus(next: UpdateStatus): void {
  status = next
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send('app-update:status', status)
}

function setAvailable(state: 'available' | 'downloaded', info: UpdateInfo): void {
  publishStatus({ state, version: info.version, releaseNotes: releaseNotes(info) })
}

function updateErrorMessage(error: Error): string {
  if (/latest\.yml.*(?:404|not found)|(?:404|not found).*latest\.yml/i.test(error.message)) {
    return '未找到 GitHub Release 的更新元数据（latest.yml）。请发布包含 latest.yml 的新版本后再检查更新。'
  }
  return error.message
}

/** Configure GitHub Releases updates for packaged desktop builds only. */
export function initializeUpdater(): void {
  if (initialized || !app.isPackaged) return
  initialized = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () =>
    publishStatus({ state: 'checking', version: app.getVersion() })
  )
  autoUpdater.on('update-available', (info) => setAvailable('available', info))
  autoUpdater.on('update-not-available', () =>
    publishStatus({ state: 'not-available', version: app.getVersion() })
  )
  autoUpdater.on('download-progress', (progress: ProgressInfo) =>
    publishStatus({ state: 'downloading', version: status.version, percent: progress.percent })
  )
  autoUpdater.on('update-downloaded', (info) => setAvailable('downloaded', info))
  autoUpdater.on('error', (error) =>
    publishStatus({ state: 'error', version: app.getVersion(), message: updateErrorMessage(error) })
  )
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    return {
      state: 'error',
      version: app.getVersion(),
      message: '更新检查仅在已安装的正式版本中可用。'
    }
  }
  initializeUpdater()
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    const message = updateErrorMessage(error instanceof Error ? error : new Error(String(error)))
    publishStatus({ state: 'error', version: app.getVersion(), message })
  }
  return status
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  if (!app.isPackaged) throw new Error('更新下载仅在已安装的正式版本中可用。')
  await autoUpdater.downloadUpdate()
  return status
}

export function quitAndInstallUpdate(): void {
  if (status.state !== 'downloaded') throw new Error('当前没有已下载的更新。')
  autoUpdater.quitAndInstall()
}
