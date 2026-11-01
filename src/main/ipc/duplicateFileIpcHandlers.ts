import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { createDuplicateTaskStore } from '../service/duplicateTaskStore'
import { DuplicateScanTask } from '../service/duplicateScanTask'
import { createDuplicateAnalysisCache, duplicateTaskCache } from '../service/duplicateAnalysisCache'
import {
  calculateAudioFingerprint,
  requireFingerprintTool
} from '../service/audioFingerprintService'
import { getFingerprintToolPath, getStemFfmpegPath } from '../utils/pathUtils'
import { FingerprintComparisonWorker } from '../service/fingerprintComparisonWorker'
import { writeFile } from 'node:fs/promises'
import { lstatSync } from 'node:fs'
import { getDatabase } from '../database'
import { deleteSongs } from '../database/repository/songs'
import { excludeAutoImportFiles } from '../service/libraryAutoImport'
import {
  detectDuplicateFiles,
  duplicateReportMarkdown,
  validateDuplicateCleanup
} from '../service/duplicateFileService'
import { Logger } from '../service/loggerService'
import { logError } from '../service/operationLogger'
import type {
  DuplicateFileSong,
  DuplicateFileReport,
  DuplicateFileResponse,
  DuplicateCleanupRequest,
  DuplicateCleanupResult,
  DuplicateScanOptions,
  DuplicateTaskState,
  DuplicateTaskDetails
} from '../../shared/duplicateFiles'

let task: DuplicateScanTask | undefined
let cleaning = false

function manager(): DuplicateScanTask {
  task ??= new DuplicateScanTask({
    store: createDuplicateTaskStore(getDatabase()),
    changed: (state) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (window.webContents.isDestroyed()) continue
        try {
          window.webContents.send('library:duplicate-task', state)
          if (state?.progress) window.webContents.send('library:duplicate-progress', state.progress)
        } catch {
          // A closing renderer cannot interrupt the application-owned task.
        }
      }
    },
    run: async (options, progress, signal, taskId) => {
      let matchingWorker: FingerprintComparisonWorker | undefined
      try {
        const deep = options.deep === true
        const sampleSeconds = options.sampleSeconds === 120 ? 120 : 60
        const executable = deep ? getFingerprintToolPath(app.isPackaged) : ''
        if (deep) await requireFingerprintTool(executable)
        signal.throwIfAborted()
        const cache = duplicateTaskCache(
          createDuplicateAnalysisCache(getDatabase()),
          taskId,
          options.force === true
        )
        const songs = getDatabase()
          .prepare(
            `SELECT id, title, artist, album, audio, duration, format,
          bitrate, sample_rate AS sampleRate, bit_depth AS bitDepth FROM song WHERE source_id IS NULL ORDER BY id`
          )
          .all() as DuplicateFileSong[]
        return await detectDuplicateFiles(songs, progress, signal, {
          ...options,
          force: false,
          fingerprintWarning: (warning) =>
            Logger.warn('[Duplicate Files] fingerprint extraction warning', warning),
          fingerprintFailure: (failure) =>
            Logger.warn('[Duplicate Files] fingerprint extraction failed', failure),
          cache,
          compareBatch: async (items, pairs, batchSignal) => {
            matchingWorker ??= new FingerprintComparisonWorker(items, batchSignal)
            return matchingWorker.compare(pairs)
          },
          fingerprint: deep
            ? (file, childSignal, duration) =>
                calculateAudioFingerprint(executable, file, childSignal, sampleSeconds, {
                  ffmpeg: getStemFfmpegPath(app.isPackaged),
                  sourceDuration: duration
                })
            : undefined
        })
      } finally {
        await matchingWorker?.close()
      }
    }
  })
  return task
}

export function restoreDuplicateScanTask(): void {
  manager().restore()
}
export function stopDuplicateScans(): void {
  task?.shutdown()
}
const busy = (): boolean => cleaning || manager().busy

function failure(error: unknown): {
  success: false
  error: 'stale' | 'invalid' | 'failed' | 'fingerprintMissing' | 'busy'
} {
  const message = error instanceof Error ? error.message : ''
  Logger.warn('[Duplicate Files] operation failed', logError(error))
  return {
    success: false,
    error:
      message === 'stale' ||
      message === 'invalid' ||
      message === 'fingerprintMissing' ||
      message === 'busy'
        ? message
        : 'failed'
  }
}

export function registerDuplicateFileIpcHandlers(): void {
  ipcMain.handle('library:duplicate-task-state', (): DuplicateTaskState | null =>
    manager().getState()
  )
  ipcMain.handle('library:duplicate-task-details', (): DuplicateTaskDetails =>
    manager().getDetails()
  )
  ipcMain.handle(
    'library:start-duplicate-task',
    (_event, options: DuplicateScanOptions): DuplicateFileResponse<DuplicateTaskState> => {
      if (busy()) return { success: false, error: 'busy' }
      try {
        return { success: true, data: manager().start(options) }
      } catch (error) {
        return failure(error)
      }
    }
  )
  ipcMain.handle('library:resume-duplicate-task', (): DuplicateFileResponse<DuplicateTaskState> => {
    if (busy()) return { success: false, error: 'busy' }
    try {
      return { success: true, data: manager().resume() }
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(
    'library:pause-duplicate-task',
    async (): Promise<DuplicateFileResponse<boolean>> => {
      try {
        manager().pause()
        await manager().wait()
        return { success: true, data: true }
      } catch (error) {
        return failure(error)
      }
    }
  )
  ipcMain.handle(
    'library:save-duplicate-selection',
    (_event, reportId: string, retainedIds: number[]): DuplicateFileResponse<boolean> => {
      if (cleaning) return { success: false, error: 'busy' }
      try {
        manager().saveSelection(reportId, retainedIds)
        return { success: true, data: true }
      } catch (error) {
        return failure(error)
      }
    }
  )
  // Retain the blocking API for callers that need the finished report.
  ipcMain.handle(
    'library:detect-duplicates',
    async (
      _event,
      options: DuplicateScanOptions = {}
    ): Promise<DuplicateFileResponse<DuplicateFileReport>> => {
      if (busy()) return { success: false, error: 'busy' }
      try {
        manager().start(options)
        await manager().wait()
        const details = manager().getDetails()
        return details.report
          ? { success: true, data: details.report }
          : { success: false, error: details.task?.error ?? 'cancelled' }
      } catch (error) {
        return failure(error)
      }
    }
  )
  ipcMain.handle('library:cancel-duplicate-scan', async () => {
    manager().cancel()
    await manager().wait()
  })
  ipcMain.handle('library:clear-duplicate-cache', (): DuplicateFileResponse<boolean> => {
    if (busy()) return { success: false, error: 'busy' }
    try {
      createDuplicateAnalysisCache(getDatabase()).clear()
      return { success: true, data: true }
    } catch (error) {
      return failure(error)
    }
  })
  ipcMain.handle(
    'library:export-duplicate-report',
    async (
      event,
      reportId: string,
      language?: unknown
    ): Promise<DuplicateFileResponse<boolean>> => {
      const report = manager().getDetails().report
      if (!report || report.id !== reportId) return { success: false, error: 'stale' }
      try {
        const options = {
          defaultPath: `EasyPlayer-duplicates-${report.createdAt.slice(0, 10)}.md`,
          filters: [{ name: 'Markdown', extensions: ['md'] }]
        }
        const window = BrowserWindow.fromWebContents(event.sender)
        const result = window
          ? await dialog.showSaveDialog(window, options)
          : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return { success: true, data: false }
        await writeFile(
          result.filePath,
          duplicateReportMarkdown(report, language === 'en' ? 'en' : 'zh'),
          'utf8'
        )
        return { success: true, data: true }
      } catch (error) {
        return failure(error)
      }
    }
  )
  ipcMain.handle(
    'library:clean-duplicates',
    async (
      event,
      request: DuplicateCleanupRequest
    ): Promise<DuplicateFileResponse<DuplicateCleanupResult>> => {
      if (busy()) return { success: false, error: 'busy' }
      const report = manager().getDetails().report
      if (!report || report.id !== request?.reportId) return { success: false, error: 'stale' }
      if (typeof request.deleteLocalFiles !== 'boolean') return { success: false, error: 'invalid' }
      cleaning = true
      try {
        const lookup = getDatabase().prepare(
          'SELECT audio, source_id AS sourceId FROM song WHERE id = ?'
        )
        const currentSong = (id: number): { audio: string; sourceId: number | null } | undefined =>
          lookup.get(id) as { audio: string; sourceId: number | null } | undefined
        const targets = await validateDuplicateCleanup(report, request.songIds, currentSong)
        if (event.sender.isDestroyed()) throw new Error('stale')
        // Recheck all touched groups synchronously immediately before the existing delete operation.
        for (const group of report.groups.filter((group) =>
          group.files.some((file) => targets.some((target) => target.id === file.id))
        )) {
          for (const file of group.files) {
            const song = currentSong(file.id)
            let stat: ReturnType<typeof lstatSync>
            try {
              stat = lstatSync(file.audio)
            } catch {
              throw new Error('stale')
            }
            if (
              !song ||
              song.sourceId !== null ||
              song.audio !== file.audio ||
              !stat.isFile() ||
              stat.size !== file.size ||
              stat.mtimeMs !== file.mtimeMs
            )
              throw new Error('stale')
          }
        }
        const result: DuplicateCleanupResult = { deletedIds: [], deletedFiles: 0, failedFiles: [] }
        for (let start = 0; start < targets.length; start += 300) {
          const batch = targets.slice(start, start + 300)
          const deleted = deleteSongs(
            batch.map((file) => file.id),
            request.deleteLocalFiles
          )
          result.deletedIds.push(...batch.map((file) => file.id))
          result.deletedFiles += deleted.deletedFiles
          result.failedFiles.push(...deleted.failedFiles)
        }
        excludeAutoImportFiles(targets.map((file) => file.audio))
        manager().clearReport()
        return { success: true, data: result }
      } catch (error) {
        return failure(error)
      } finally {
        cleaning = false
      }
    }
  )
}
