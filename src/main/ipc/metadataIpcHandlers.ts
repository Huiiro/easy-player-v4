import { t } from '../i18n'
import {
  setMetadataPlaybackStatusProvider,
  type MetadataPlaybackStatusProvider
} from '../service/metadataWriteGuard'
import { logError, logOperation, logParams, logUrl } from '../service/operationLogger'
import { ipcMain, dialog } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import type { SongMetadata } from '../service/metadataService'
import { getSong } from '../database/repository'
import { Logger } from '../service/loggerService'
import {
  writeSongMetadata,
  applySourceMetadata,
  getSourceMetadataSnapshot,
  reloadSongMetadata,
  readSongMetadataForEditing
} from '../service/metadataWriteService'
import {
  listMetadataSources,
  searchSourceTracks,
  getSourceTrack,
  getSourceTrackLyrics
} from '../sources/metadata'
import type { ApplySourceMetadataRequest } from '../../shared/sourceMetadata'
import type { SourceResourceRef } from '../../shared/networkSources'
import { searchSourceArtwork } from '../sources/artwork'
import { fetchArtworkDataUrl as downloadCoverDataUrl } from '../sources/artworkFetch'
import type { MetadataQuery } from '../../shared/networkSources'

export function registerMetadataIpcHandlers(
  playbackStatus: MetadataPlaybackStatusProvider = () => null
): void {
  setMetadataPlaybackStatusProvider(playbackStatus)
  const sourceHandle = <T>(channel: string, action: (request: T) => unknown): void => {
    ipcMain.handle(channel, async (_event, request: T) => {
      try {
        return { success: true, data: await action(request) }
      } catch (error) {
        Logger.warn('[Metadata IPC] source operation failed', { channel }, logError(error))
        return {
          success: false,
          error: error instanceof Error ? error.message : t('metadataReadFailed')
        }
      }
    })
  }
  sourceHandle('metadata:source-list', () => listMetadataSources())
  sourceHandle('metadata:source-search', (request: { sourceId: string; query: string }) =>
    searchSourceTracks(request.sourceId, request.query)
  )
  sourceHandle('metadata:source-track', (resource: SourceResourceRef) => getSourceTrack(resource))
  sourceHandle('metadata:source-lyrics', (resource: SourceResourceRef) =>
    getSourceTrackLyrics(resource)
  )
  sourceHandle('metadata:source-snapshot', (request: { songId: number }) =>
    getSourceMetadataSnapshot(request.songId)
  )
  ipcMain.handle('metadata:source-apply', async (_event, request: ApplySourceMetadataRequest) => {
    try {
      return await applySourceMetadata(request)
    } catch (error) {
      Logger.error(
        '[Metadata IPC] source apply failed',
        {
          songId: request?.songId,
          fields: Object.keys(request?.patch ?? {})
        },
        logError(error)
      )
      return {
        success: false,
        error: error instanceof Error ? error.message : t('metadataWriteFailed')
      }
    }
  })
  ipcMain.handle('metadata:read', async (_event, songId: number) => {
    return logOperation('[IPC] metadata:read', { songId }, async () => {
      try {
        if (!Number.isInteger(songId)) {
          return { success: false, error: t('invalidSongId') }
        }
        const song = getSong(songId)
        if (!song || !existsSync(song.audio)) {
          return { success: false, error: t('songFileNotFound') }
        }
        if (song.sourceId) {
          return { success: false, error: t('remoteUnsupported') }
        }
        const metadata = await readSongMetadataForEditing(songId)
        return { success: true, data: metadata }
      } catch (error) {
        Logger.error('[Metadata IPC] read failed', { songId }, logError(error))
        return {
          success: false,
          error: error instanceof Error ? error.message : t('metadataReadFailed')
        }
      }
    })
  })

  ipcMain.handle('metadata:reload', async (_event, songIds: number[]) => {
    return logOperation(
      '[IPC] metadata:reload',
      { songCount: Array.isArray(songIds) ? songIds.length : 0 },
      async () => {
        const ids = [...new Set(songIds)].filter(Number.isInteger)
        if (!ids.length) return { success: false, error: t('noSongs') }
        let reloaded = 0
        let failed = 0
        for (const songId of ids) {
          try {
            await reloadSongMetadata(songId)
            reloaded++
          } catch (error) {
            failed++
            Logger.warn('[Metadata IPC] reload skipped song', { songId }, logError(error))
          }
        }
        return {
          success: reloaded > 0,
          data: { reloaded, failed },
          error: failed ? t('reloadPartial') : undefined
        }
      }
    )
  })

  ipcMain.handle('metadata:choose-cover', async () => {
    return logOperation('[IPC] metadata:choose-cover', {}, async () => {
      try {
        const result = await dialog.showOpenDialog({
          properties: ['openFile'],
          filters: [{ name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'] }]
        })
        if (result.canceled || !result.filePaths.length) {
          return { success: false }
        }
        const filePath = result.filePaths[0]
        const buffer = readFileSync(filePath)
        const ext = filePath.split('.').pop()?.toLowerCase() || 'jpg'
        const mime =
          ext === 'png'
            ? 'image/png'
            : ext === 'gif'
              ? 'image/gif'
              : ext === 'webp'
                ? 'image/webp'
                : 'image/jpeg'
        const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`
        return { success: true, data: { filePath, dataUrl } }
      } catch (error) {
        Logger.error('[Metadata IPC] choose cover failed', logError(error))
        return {
          success: false,
          error: error instanceof Error ? error.message : t('chooseCoverFailed')
        }
      }
    })
  })

  ipcMain.handle('metadata:search-covers', async (_event, request: MetadataQuery) => {
    return logOperation(
      '[IPC] metadata:search-covers',
      { titleLength: request?.title?.length, hasArtist: Boolean(request?.artist) },
      async () => {
        try {
          const candidates = await searchSourceArtwork(request)
          // Fetch previews in the main process. NetEase CDN URLs can redirect to HTTP,
          // which the renderer's strict CSP correctly refuses to display directly.
          const data = (
            await Promise.all(
              candidates.map(async (candidate) => {
                try {
                  return {
                    ...candidate,
                    previewUrl: await downloadCoverDataUrl(candidate.imageUrl)
                  }
                } catch {
                  return null
                }
              })
            )
          ).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
          return { success: true, data }
        } catch (error) {
          Logger.error(
            '[Metadata IPC] search covers failed',
            { titleLength: request?.title?.length },
            logError(error)
          )
          return {
            success: false,
            error: error instanceof Error ? error.message : t('searchCoverFailed')
          }
        }
      }
    )
  })

  ipcMain.handle('metadata:download-cover', async (_event, imageUrl: string) => {
    return logOperation('[IPC] metadata:download-cover', { url: logUrl(imageUrl) }, async () => {
      try {
        return { success: true, data: { dataUrl: await downloadCoverDataUrl(imageUrl) } }
      } catch (error) {
        Logger.error(
          '[Metadata IPC] download cover failed',
          { url: logUrl(imageUrl) },
          logError(error)
        )
        return {
          success: false,
          error: error instanceof Error ? error.message : t('downloadCoverFailed')
        }
      }
    })
  })

  ipcMain.handle(
    'metadata:write',
    async (_event, request: { songId: number; metadata: SongMetadata }) => {
      return logOperation('[IPC] metadata:write', logParams(request), async () => {
        try {
          return await writeSongMetadata(request.songId, request.metadata)
        } catch (error) {
          Logger.error('[Metadata IPC] write failed', logParams(request), logError(error))
          return {
            success: false,
            error: error instanceof Error ? error.message : t('metadataWriteFailed')
          }
        }
      })
    }
  )
}
