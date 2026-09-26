import { t } from '../i18n'
import { app, BrowserWindow } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import { Logger } from './loggerService'
import { logError, logOperation } from './operationLogger'

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
  if (next.state !== status.state || next.version !== status.version)
    Logger.debug('[Updater] state changed', {
      from: status.state,
      to: next.state,
      version: next.version
    })
  status = next
  for (const window of BrowserWindow.getAllWindows())
    window.webContents.send('app-update:status', status)
}

function setAvailable(state: 'available' | 'downloaded', info: UpdateInfo): void {
  Logger.info(`[Updater] update ${state}`, { version: info.version })
  publishStatus({ state, version: info.version, releaseNotes: releaseNotes(info) })
}

function updateErrorMessage(error: Error): string {
  if (/latest\.yml.*(?:404|not found)|(?:404|not found).*latest\.yml/i.test(error.message)) {
    return t('updateMetadataMissing')
  }
  return error.message
}

/** Configure GitHub Releases updates for packaged desktop builds only. */
export function initializeUpdater(): void {
  if (initialized || !app.isPackaged) {
    Logger.debug('[Updater] initialize skipped', { initialized, packaged: app.isPackaged })
    return
  }
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
  autoUpdater.on('error', (error) => {
    Logger.error(
      '[Updater] error',
      { state: status.state, version: status.version },
      logError(error)
    )
    publishStatus({ state: 'error', version: app.getVersion(), message: updateErrorMessage(error) })
  })
  Logger.debug('[Updater] initialized', { version: app.getVersion(), autoDownload: false })
}

export function getUpdateStatus(): UpdateStatus {
  return status
}

export async function checkForUpdates(): Promise<UpdateStatus> {
  if (!app.isPackaged) {
    Logger.debug('[Updater] check skipped in development', { version: app.getVersion() })
    return {
      state: 'error',
      version: app.getVersion(),
      message: t('updateCheckPackaged')
    }
  }
  initializeUpdater()
  try {
    await logOperation('[Updater] checkForUpdates', { version: app.getVersion() }, () =>
      autoUpdater.checkForUpdates()
    )
  } catch (error) {
    const message = updateErrorMessage(error instanceof Error ? error : new Error(String(error)))
    publishStatus({ state: 'error', version: app.getVersion(), message })
  }
  return status
}

export async function downloadUpdate(): Promise<UpdateStatus> {
  return logOperation('[Updater] downloadUpdate', { version: status.version }, async () => {
    if (!app.isPackaged) throw new Error(t('updateDownloadPackaged'))
    await autoUpdater.downloadUpdate()
    return status
  })
}

export function quitAndInstallUpdate(): void {
  if (status.state !== 'downloaded') throw new Error(t('noDownloadedUpdate'))
  Logger.info('[Updater] installing update', { version: status.version })
  autoUpdater.quitAndInstall()
}
