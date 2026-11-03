import { t } from '../i18n'
import { waitForBackgroundWork } from './playbackMode'
import { logError, logOperation } from './operationLogger'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseAudioFile } from './audioMetadataService'
import { getDatabase } from '../database'
import { getCoverPath } from '../utils/pathUtils'
import { Logger } from './loggerService'
import { refreshNewestSongs } from '../database/newestSongs'
import { joinMetadataValues } from '../../shared/metadataValues'
import { isApplicationShuttingDown } from './applicationShutdown'

export interface ScanCallback {
  (current: number, total: number, added: number, duplicates: number): void
}

export interface ScanResult {
  added: number
  duplicates: number
  skipped: number
  total: number
}

interface FolderRow {
  id: number
}

export const SUPPORTED_EXTENSIONS = [
  '.mp3',
  '.aac',
  '.m4a',
  '.ogg',
  '.opus',
  '.flac',
  '.wav',
  '.aiff',
  '.ape',
  '.dff',
  '.dsf'
]

function getOrInsertFolder(importPath: string, rootPath: string): FolderRow {
  const db = getDatabase()
  const existing = db.prepare('SELECT id FROM folder WHERE full_path = ?').get(importPath) as
    FolderRow | undefined
  if (existing) return existing

  const normalizedRoot = path.resolve(rootPath)
  const normalizedPath = path.resolve(importPath)
  const parent =
    normalizedPath === normalizedRoot
      ? null
      : getOrInsertFolder(path.dirname(normalizedPath), normalizedRoot)

  const result = db
    .prepare(
      `INSERT INTO folder (pid, name, full_path, is_root_path, import_time)
       VALUES (?, ?, ?, ?, datetime('now', 'localtime'))`
    )
    .run(
      parent?.id ?? null,
      path.basename(normalizedPath) || normalizedPath,
      normalizedPath,
      parent ? 0 : 1
    )

  return { id: Number(result.lastInsertRowid) }
}

function isMacMetadataPath(filePath: string): boolean {
  return (
    path.basename(filePath).startsWith('._') ||
    path.resolve(filePath).split(path.sep).includes('__MACOSX')
  )
}

async function collectMusicFiles(directory: string, files: string[]): Promise<void> {
  if (isMacMetadataPath(directory)) return
  await waitForBackgroundWork()
  const entries = await fs.promises.readdir(directory, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)
    if (isMacMetadataPath(fullPath)) continue
    if (entry.isDirectory()) {
      await collectMusicFiles(fullPath, files)
    } else if (
      entry.isFile() &&
      SUPPORTED_EXTENSIONS.includes(path.extname(entry.name).toLowerCase())
    ) {
      files.push(fullPath)
    }
  }
}

/** Scans a selected local folder and imports supported audio files into the library. */
export async function scanMusicDirectory(
  dirPath: string,
  callback?: ScanCallback,
  selectedFiles?: string[],
  ignoreShortSongs = true,
  options: {
    background?: boolean
    shouldContinue?: () => boolean
    shouldImportFile?: (file: string) => boolean
  } = {}
): Promise<ScanResult> {
  return logOperation(
    '[Scanner] scanMusicDirectory',
    { directory: dirPath },
    async () => {
      const rootPath = path.resolve(dirPath)
      let rootStat: fs.Stats
      try {
        rootStat = await fs.promises.stat(rootPath)
      } catch (error) {
        Logger.warn('[Scanner] directory access failed', { directory: rootPath }, logError(error))
        throw new Error(t('musicDirectoryMissing', { path: rootPath }))
      }
      if (!rootStat.isDirectory()) {
        throw new Error(t('musicDirectoryMissing', { path: rootPath }))
      }

      const files: string[] = []
      if (selectedFiles) {
        files.push(
          ...selectedFiles.filter(
            (file) =>
              !path.isAbsolute(path.relative(rootPath, file)) &&
              path.relative(rootPath, file) !== '..' &&
              !path.relative(rootPath, file).startsWith(`..${path.sep}`) &&
              !isMacMetadataPath(file) &&
              SUPPORTED_EXTENSIONS.includes(path.extname(file).toLowerCase())
          )
        )
      } else {
        await collectMusicFiles(rootPath, files)
      }
      Logger.debug('[Scanner] files collected', { directory: rootPath, fileCount: files.length })

      const active = (): boolean =>
        !isApplicationShuttingDown() && options.shouldContinue?.() !== false
      if (!active()) return { added: 0, duplicates: 0, skipped: 0, total: files.length }
      const db = getDatabase()
      const insertSong = db.prepare(`
      INSERT OR IGNORE INTO song (
        title, artist, album, duration, cover, audio, lrc, year, genre, bitrate,
        sample_rate, bit_depth, channels, format, file_name, file_size, track_no,
        disk_no, folder_id, is_newest
      ) VALUES (
        @title, @artist, @album, @duration, @cover, @audio, @lrc, @year, @genre, @bitrate,
        @sampleRate, @bitDepth, @channels, @format, @fileName, @fileSize, @trackNo,
        @diskNo, @folderId, 1
      )
    `)
      const existsSong = db.prepare('SELECT 1 FROM song WHERE audio = ?')
      const coverDir = getCoverPath()
      await fs.promises.mkdir(coverDir, { recursive: true })

      if (active()) callback?.(0, files.length, 0, 0)

      let added = 0
      let duplicates = 0
      let skipped = 0
      let failed = 0
      for (const [index, fullPath] of files.entries()) {
        // Explicit file opens are part of playback; only library scans wait.
        if (!selectedFiles || options.background) await waitForBackgroundWork()
        if (!active()) break
        try {
          if (options.shouldImportFile?.(fullPath) === false) {
            skipped++
            continue
          }
          if (existsSong.get(fullPath)) {
            duplicates++
            continue
          }

          const metadata = await parseAudioFile(fullPath, { duration: true })
          if (!active()) break
          const common = metadata.common
          const format = metadata.format
          // A supported extension can belong to metadata or a file with no audio stream.
          if (format.hasAudio === false) throw new Error('File contains no audio stream')
          // File selection and duration filtering are independent. Unknown durations are retained.
          if (ignoreShortSongs && format.duration != null && format.duration < 5) {
            skipped++
            continue
          }
          const picture = common.picture?.[0]
          let cover: string | null = null
          if (picture) {
            const coverPath = getCoverPath(`${crypto.randomUUID()}.jpg`)
            await fs.promises.writeFile(coverPath, picture.data)
            cover = coverPath
          }

          const fileSize = (await fs.promises.stat(fullPath)).size
          if (!active()) break
          // A deletion can happen while metadata or file information is being read.
          if (options.shouldImportFile?.(fullPath) === false) {
            skipped++
            continue
          }
          const folder = getOrInsertFolder(path.dirname(fullPath), rootPath)
          const result = insertSong.run({
            title: common.title || path.basename(fullPath, path.extname(fullPath)),
            artist: common.artist || 'Unknown Artist',
            album: common.album || 'Unknown Album',
            duration: Math.floor(format.duration || 0),
            cover,
            audio: fullPath,
            lrc: null,
            year: common.year || null,
            genre: joinMetadataValues(common.genre) || null,
            bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : null,
            sampleRate: format.sampleRate || null,
            bitDepth: format.bitsPerSample || null,
            channels: format.numberOfChannels || null,
            format: format.container || format.codec || path.extname(fullPath).slice(1) || null,
            fileName: path.basename(fullPath, path.extname(fullPath)),
            fileSize,
            trackNo: common.track.no || null,
            diskNo: common.disk.no || null,
            folderId: folder.id
          })
          if (result.changes > 0) added++
          else duplicates++
        } catch (error) {
          if (!active()) break
          failed++
          Logger.warn(
            '[Scanner] skipped file after import failure',
            {
              directory: rootPath,
              filePath: fullPath,
              index,
              total: files.length
            },
            logError(error)
          )
        } finally {
          if (active()) callback?.(index + 1, files.length, added, duplicates)
        }
      }

      if (failed)
        Logger.warn('[Scanner] scan completed with skipped failures', {
          directory: rootPath,
          added,
          duplicates,
          failed,
          total: files.length
        })
      if (active() && (added || !db.prepare('SELECT 1 FROM song WHERE is_newest = 1').get()))
        refreshNewestSongs(db)
      return { added, duplicates, skipped, total: files.length }
    },
    { successLevel: 'info', warnOnFalse: false }
  )
}
