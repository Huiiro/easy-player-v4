import { ipcMain, dialog } from 'electron'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readMetadata, writeMetadata, SongMetadata } from '../service/metadataService'
import { getSong } from '../database/repository'
import { getDatabase } from '../database'
import { getDataPath } from '../utils/pathUtils'
import { Logger } from '../service/loggerService'

export function registerMetadataIpcHandlers(): void {
  ipcMain.handle('metadata:read', async (_event, songId: number) => {
    try {
      if (!Number.isInteger(songId)) {
        return { success: false, error: 'Invalid song id' }
      }
      const song = getSong(songId)
      if (!song || !existsSync(song.audio)) {
        return { success: false, error: 'Song file not found' }
      }
      if (song.sourceId) {
        return { success: false, error: 'Remote songs are not supported' }
      }
      const metadata = await readMetadata(song.audio)
      return { success: true, data: metadata }
    } catch (error) {
      Logger.error('metadata:read error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read metadata'
      }
    }
  })

  ipcMain.handle('metadata:choose-cover', async () => {
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
      const mime = ext === 'png' ? 'image/png' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/jpeg'
      const dataUrl = `data:${mime};base64,${buffer.toString('base64')}`
      return { success: true, data: { filePath, dataUrl } }
    } catch (error) {
      Logger.error('metadata:choose-cover error:', error)
      return { success: false, error: error instanceof Error ? error.message : 'Failed to choose cover' }
    }
  })

  ipcMain.handle(
    'metadata:write',
    async (_event, request: { songId: number; metadata: SongMetadata }) => {
      try {
        const { songId, metadata } = request
        if (!Number.isInteger(songId)) {
          return { success: false, error: 'Invalid song id' }
        }
        const song = getSong(songId)
        if (!song || !existsSync(song.audio)) {
          return { success: false, error: 'Song file not found' }
        }
        if (song.sourceId) {
          return { success: false, error: 'Remote songs are not supported' }
        }

        const result = await writeMetadata(song.audio, song.format || '', metadata)
        if (!result) {
          return { success: false, error: 'Failed to write metadata' }
        }

        // Re-read file to sync database with updated metadata
        const updatedMeta = await readMetadata(song.audio)
        const db = getDatabase()

        const updates: string[] = []
        const values: unknown[] = []

        if (updatedMeta.title && updatedMeta.title !== song.title) {
          updates.push('title = ?')
          values.push(updatedMeta.title)
        }
        if (updatedMeta.artist && updatedMeta.artist !== song.artist) {
          updates.push('artist = ?')
          values.push(updatedMeta.artist)
        }
        if (updatedMeta.album && updatedMeta.album !== song.album) {
          updates.push('album = ?')
          values.push(updatedMeta.album)
        }
        if (updatedMeta.year !== undefined && updatedMeta.year !== song.year) {
          updates.push('year = ?')
          values.push(updatedMeta.year)
        }
        if (updatedMeta.genre && updatedMeta.genre !== song.genre) {
          updates.push('genre = ?')
          values.push(updatedMeta.genre)
        }

        // Handle cover art: if metadata was written with a cover, re-read and extract it
        if (metadata.coverPath || metadata.cover) {
          const picture = updatedMeta.cover
          if (picture) {
            const uuid = randomUUID()
            const coverDir = join(getDataPath(), 'covers')
            const coverPath = join(coverDir, `${uuid}.jpg`)
            writeFileSync(coverPath, picture)

            if (song.cover && existsSync(song.cover)) {
              try {
                unlinkSync(song.cover)
              } catch {
                // ignore cleanup failures
              }
            }
            updates.push('cover = ?')
            values.push(coverPath)
          }
        }

        if (updates.length > 0) {
          db.prepare(`UPDATE song SET ${updates.join(', ')} WHERE id = ?`).run(...values, songId)
        }

        return { success: true }
      } catch (error) {
        Logger.error('metadata:write error:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to write metadata'
        }
      }
    }
  )
}
