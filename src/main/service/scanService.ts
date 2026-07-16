import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseFile } from 'music-metadata'
import { getDatabase } from '../database'
import { getDataPath } from '../utils/pathUtils'
import { Logger } from './loggerService'

export interface ScanCallback {
  (current: number, total: number, added: number, duplicates: number): void
}

export interface ScanResult {
  added: number
  duplicates: number
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

function collectMusicFiles(directory: string, files: string[]): void {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      collectMusicFiles(fullPath, files)
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
  callback?: ScanCallback
): Promise<ScanResult> {
  const rootPath = path.resolve(dirPath)
  if (!fs.existsSync(rootPath) || !fs.statSync(rootPath).isDirectory()) {
    throw new Error(`Music directory does not exist: ${rootPath}`)
  }

  const files: string[] = []
  collectMusicFiles(rootPath, files)

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
  const coverDir = path.join(getDataPath(), 'covers')
  fs.mkdirSync(coverDir, { recursive: true })
  db.prepare('UPDATE song SET is_newest = 0').run()

  callback?.(0, files.length, 0, 0)

  let added = 0
  let duplicates = 0
  for (const [index, fullPath] of files.entries()) {
    try {
      if (existsSong.get(fullPath)) {
        duplicates++
        continue
      }

      const metadata = await parseFile(fullPath)
      const common = metadata.common
      const format = metadata.format
      const picture = common.picture?.[0]
      let cover: string | null = null
      if (picture) {
        const coverPath = path.join(coverDir, `${crypto.randomUUID()}.jpg`)
        fs.writeFileSync(coverPath, picture.data)
        cover = coverPath
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
        genre: common.genre?.join(', ') || null,
        bitrate: format.bitrate ? Math.round(format.bitrate / 1000) : null,
        sampleRate: format.sampleRate || null,
        bitDepth: format.bitsPerSample || null,
        channels: format.numberOfChannels || null,
        format: format.container || format.codec || path.extname(fullPath).slice(1) || null,
        fileName: path.basename(fullPath, path.extname(fullPath)),
        fileSize: fs.statSync(fullPath).size,
        trackNo: common.track.no || null,
        diskNo: common.disk.no || null,
        folderId: folder.id
      })
      if (result.changes > 0) added++
      else duplicates++
    } catch (error) {
      Logger.error('Scanner: failed to import file', fullPath, error)
    } finally {
      callback?.(index + 1, files.length, added, duplicates)
    }
  }

  Logger.info(`Scanner: scan finished, added: ${added}, duplicates: ${duplicates}`)
  return { added, duplicates, total: files.length }
}
