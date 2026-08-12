import { ipcMain, dialog } from 'electron'
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { readMetadata, writeMetadata, SongMetadata } from '../service/metadataService'
import { getSong } from '../database/repository'
import { getDatabase } from '../database'
import { getDataPath } from '../utils/pathUtils'
import { Logger } from '../service/loggerService'
import { search as searchNetease } from '@neteasecloudmusicapienhanced/api'

interface CoverSearchRequest {
  title: string
  artist?: string | null
  album?: string | null
}

function coverSearchKeyword(request: CoverSearchRequest): string {
  return [request.title, request.artist, request.album].filter(Boolean).join(' ').trim()
}

function saveCoverDataUrl(dataUrl: string): string {
  const matched = /^data:image\/(?:jpeg|jpg|png|webp|gif);base64,([a-z0-9+/=]+)$/i.exec(dataUrl)
  if (!matched) throw new Error('Invalid cover image data')
  const coverDir = join(getDataPath(), 'covers')
  mkdirSync(coverDir, { recursive: true })
  const path = join(coverDir, `metadata-${randomUUID()}.jpg`)
  writeFileSync(path, Buffer.from(matched[1], 'base64'))
  return path
}

async function downloadCoverDataUrl(imageUrl: string): Promise<string> {
  if (!/^https?:\/\//i.test(imageUrl)) throw new Error('Invalid cover URL')
  const response = await fetch(imageUrl)
  const contentType = response.headers.get('content-type') || ''
  if (!response.ok || !contentType.startsWith('image/'))
    throw new Error('Unable to download cover image')
  const buffer = Buffer.from(await response.arrayBuffer())
  if (!buffer.length || buffer.length > 20 * 1024 * 1024) throw new Error('Invalid cover image')
  return `data:${contentType.split(';')[0]};base64,${buffer.toString('base64')}`
}

async function reloadSongMetadata(songId: number): Promise<void> {
  const song = getSong(songId)
  if (!song || !existsSync(song.audio)) throw new Error('Song file not found')
  if (song.sourceId) throw new Error('Remote songs are not supported')

  const metadata = await readMetadata(song.audio)
  let cover: string | null = null
  if (metadata.cover) {
    const coverDir = join(getDataPath(), 'covers')
    mkdirSync(coverDir, { recursive: true })
    cover = join(coverDir, `${randomUUID()}.jpg`)
    writeFileSync(cover, metadata.cover)
  }

  const fileName = basename(song.audio, extname(song.audio))
  getDatabase()
    .prepare(
      `UPDATE song SET title = @title, artist = @artist, album = @album, duration = @duration,
       cover = @cover, year = @year, genre = @genre, bitrate = @bitrate,
       sample_rate = @sampleRate, bit_depth = @bitDepth, channels = @channels, format = @format,
       file_name = @fileName, file_size = @fileSize, track_no = @trackNo, disk_no = @diskNo,
       song_status = 1 WHERE id = @id`
    )
    .run({
      id: song.id,
      title: metadata.title || fileName,
      artist: metadata.artist || null,
      album: metadata.album || null,
      duration: Math.floor(metadata.duration || 0),
      cover,
      year: metadata.year ?? null,
      genre: metadata.genre || null,
      bitrate: metadata.bitrate ? Math.round(metadata.bitrate / 1000) : null,
      sampleRate: metadata.sampleRate ?? null,
      bitDepth: metadata.bitsPerSample ?? null,
      channels: metadata.channels ?? null,
      format: metadata.container || metadata.codec || extname(song.audio).slice(1) || null,
      fileName,
      fileSize: statSync(song.audio).size,
      trackNo: metadata.trackNumber ?? null,
      diskNo: metadata.discNumber ?? null
    })
  if (song.cover && song.cover !== cover && existsSync(song.cover)) {
    try {
      unlinkSync(song.cover)
    } catch {
      // The database has already been synchronized; retain an orphaned cover on cleanup failure.
    }
  }
}

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

  ipcMain.handle('metadata:reload', async (_event, songIds: number[]) => {
    const ids = [...new Set(songIds)].filter(Number.isInteger)
    if (!ids.length) return { success: false, error: 'No songs selected' }
    let reloaded = 0
    let failed = 0
    for (const songId of ids) {
      try {
        await reloadSongMetadata(songId)
        reloaded++
      } catch (error) {
        failed++
        Logger.error('metadata:reload error:', songId, error)
      }
    }
    return {
      success: reloaded > 0,
      data: { reloaded, failed },
      error: failed ? 'Some songs could not be reloaded' : undefined
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
      Logger.error('metadata:choose-cover error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to choose cover'
      }
    }
  })

  ipcMain.handle('metadata:search-covers', async (_event, request: CoverSearchRequest) => {
    try {
      const keyword = coverSearchKeyword(request)
      if (!keyword) return { success: true, data: [] }
      const response = (await searchNetease({
        keywords: keyword,
        type: 10,
        limit: 12
      })) as unknown as {
        status?: number
        body?: { result?: { albums?: Array<Record<string, unknown>> } }
      }
      if (response.status !== 200) return { success: true, data: [] }
      const candidates = (response.body?.result?.albums ?? []).flatMap((album) => {
        const imageUrl =
          typeof album.picUrl === 'string' ? album.picUrl.replace(/^http:\/\//i, 'https://') : ''
        if (!imageUrl) return []
        const artist =
          typeof (album.artist as { name?: string } | undefined)?.name === 'string'
            ? (album.artist as { name: string }).name
            : ''
        return [
          {
            id: String(album.id ?? imageUrl),
            title: String(album.name ?? ''),
            artist,
            album: String(album.name ?? ''),
            imageUrl
          }
        ]
      })
      // Fetch previews in the main process. NetEase CDN URLs can redirect to HTTP,
      // which the renderer's strict CSP correctly refuses to display directly.
      const data = (
        await Promise.all(
          candidates.map(async (candidate) => {
            try {
              return { ...candidate, previewUrl: await downloadCoverDataUrl(candidate.imageUrl) }
            } catch {
              return null
            }
          })
        )
      ).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
      return { success: true, data }
    } catch (error) {
      Logger.error('metadata:search-covers error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to search covers'
      }
    }
  })

  ipcMain.handle('metadata:download-cover', async (_event, imageUrl: string) => {
    try {
      return { success: true, data: { dataUrl: await downloadCoverDataUrl(imageUrl) } }
    } catch (error) {
      Logger.error('metadata:download-cover error:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to download cover'
      }
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

        const temporaryCover = metadata.coverDataUrl
          ? saveCoverDataUrl(metadata.coverDataUrl)
          : null
        if (temporaryCover) metadata.coverPath = temporaryCover
        let result: boolean
        try {
          result = await writeMetadata(song.audio, song.format || '', metadata)
        } finally {
          if (temporaryCover && existsSync(temporaryCover)) unlinkSync(temporaryCover)
        }
        if (!result) return { success: false, error: 'Failed to write metadata' }

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
