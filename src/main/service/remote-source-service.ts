import { createHash, randomBytes } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { basename, extname, join } from 'node:path'
import { getDatabase } from '../database'
import {
  getAppSetting,
  getSong,
  getSource,
  touchSource,
  updateSourceStats
} from '../database/repository'
import type { MusicSource } from '../database/types'
import { getDataPath } from '../utils/pathUtils'

interface SubsonicSong {
  id: string
  title?: string
  artist?: string
  album?: string
  duration?: number
  coverArt?: string
  year?: number
  genre?: string
  bitRate?: number
  samplingRate?: number
  bitDepth?: number
  channelCount?: number
  suffix?: string
  path?: string
  size?: number
  track?: number
  discNumber?: number
}

interface SubsonicResponse<T> {
  'subsonic-response'?: T & { status?: string; error?: { message?: string } }
}

type ConfiguredSource = MusicSource & { baseUrl: string; user: string; secret: string }

function validateSource(source: MusicSource | null): asserts source is ConfiguredSource {
  if (!source || source.type !== 'navidrome' || !source.baseUrl || !source.user || !source.secret) {
    throw new Error('Navidrome 音源配置不完整')
  }
}

function sourceUrl(
  source: MusicSource,
  endpoint: string,
  parameters: Record<string, string> = {}
): string {
  validateSource(source)
  const salt = randomBytes(8).toString('hex')
  const token = createHash('md5').update(`${source.secret}${salt}`).digest('hex')
  const query = new URLSearchParams({
    u: source.user,
    t: token,
    s: salt,
    v: '1.16.1',
    c: 'EasyPlayer',
    f: 'json',
    ...parameters
  })
  return `${source.baseUrl.replace(/\/$/, '')}/rest/${endpoint}.view?${query}`
}

async function request<T>(
  source: MusicSource,
  endpoint: string,
  parameters: Record<string, string> = {}
): Promise<T> {
  const response = await fetch(sourceUrl(source, endpoint, parameters))
  const body = (await response.json()) as SubsonicResponse<T>
  const result = body['subsonic-response']
  if (!response.ok || result?.status !== 'ok')
    throw new Error(result?.error?.message || `请求 ${endpoint} 失败`)
  return result as T
}

function remoteFolderId(source: MusicSource): number {
  const db = getDatabase()
  const path = `remote://${source.id}`
  const existing = db.prepare('SELECT id FROM folder WHERE full_path = ?').get(path) as
    { id: number } | undefined
  if (existing) return existing.id
  const result = db
    .prepare(
      "INSERT INTO folder (pid, name, full_path, is_root_path, import_time) VALUES (NULL, ?, ?, 1, datetime('now', 'localtime'))"
    )
    .run(source.name, path)
  return Number(result.lastInsertRowid)
}

async function cacheCover(source: MusicSource, coverId?: string): Promise<string | null> {
  if (!coverId) return null
  const directory = join(getDataPath(), 'covers', 'remote')
  mkdirSync(directory, { recursive: true })
  const filePath = join(directory, `${source.id}-${coverId.replace(/[^a-zA-Z0-9._-]/g, '_')}.jpg`)
  if (existsSync(filePath)) return filePath
  const response = await fetch(sourceUrl(source, 'getCoverArt', { id: coverId, size: '600' }))
  if (!response.ok) return null
  writeFileSync(filePath, Buffer.from(await response.arrayBuffer()))
  return filePath
}

async function upsertSong(
  source: MusicSource,
  folderId: number,
  song: SubsonicSong
): Promise<void> {
  const cover = await cacheCover(source, song.coverArt)
  const db = getDatabase()
  db.prepare(
    `INSERT INTO song (
      title, artist, album, duration, cover, audio, folder_id, year, genre, bitrate,
      sample_rate, bit_depth, channels, format, file_name, file_size, track_no, disk_no,
      source_id, remote_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(audio) DO UPDATE SET
      title = excluded.title, artist = excluded.artist, album = excluded.album,
      duration = excluded.duration, cover = excluded.cover, year = excluded.year,
      genre = excluded.genre, bitrate = excluded.bitrate, sample_rate = excluded.sample_rate,
      bit_depth = excluded.bit_depth, channels = excluded.channels, format = excluded.format,
      file_name = excluded.file_name, file_size = excluded.file_size, track_no = excluded.track_no,
      disk_no = excluded.disk_no`
  ).run(
    song.title || '',
    song.artist || null,
    song.album || null,
    song.duration || null,
    cover,
    `remote://${source.id}/${song.id}`,
    folderId,
    song.year || null,
    song.genre || null,
    song.bitRate || null,
    song.samplingRate || null,
    song.bitDepth || null,
    song.channelCount || null,
    song.suffix || null,
    song.path ? basename(song.path) : null,
    song.size || null,
    song.track || null,
    song.discNumber || null,
    source.id,
    song.id
  )
}

/** Imports the complete Navidrome library into the local song index. */
export async function syncNavidromeSource(
  sourceId: number
): Promise<{ imported: number; total: number }> {
  const source = getSource(sourceId)
  validateSource(source)
  const folderId = remoteFolderId(source)
  const artistsResult = await request<{
    artists?: { index?: Array<{ artist?: Array<{ id: string }> }> }
  }>(source, 'getArtists')
  const artistIds = artistsResult.artists?.index?.flatMap((index) => index.artist || []) || []
  let imported = 0
  let total = 0
  for (const artist of artistIds) {
    const artistResult = await request<{ artist?: { album?: Array<{ id: string }> } }>(
      source,
      'getArtist',
      { id: artist.id }
    )
    for (const album of artistResult.artist?.album || []) {
      const albumResult = await request<{ album?: { song?: SubsonicSong[] } }>(source, 'getAlbum', {
        id: album.id
      })
      const songs = albumResult.album?.song || []
      total += songs.length
      for (const song of songs) {
        await upsertSong(source, folderId, song)
        imported++
      }
    }
  }
  touchSource(sourceId)
  updateSourceStats(sourceId, imported, total)
  return { imported, total }
}

function cacheDirectory(): string {
  const configured = getAppSetting('remote.cache-directory')
  return typeof configured === 'string' && configured.trim()
    ? configured
    : join(getDataPath(), 'cache')
}

function cleanupCache(directory: string): void {
  const configured = getAppSetting('remote.cache-limit-gb')
  const maxBytes = (typeof configured === 'number' ? configured : 2) * 1024 * 1024 * 1024
  const files = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(directory, entry.name)
      const stat = statSync(path)
      return { path, size: stat.size, mtime: stat.mtimeMs }
    })
  let total = files.reduce((sum, file) => sum + file.size, 0)
  for (const file of files.sort((a, b) => a.mtime - b.mtime)) {
    if (total <= maxBytes) break
    unlinkSync(file.path)
    total -= file.size
  }
}

/** Returns a local file path, downloading the Navidrome stream on a cache miss. */
export async function cacheRemoteSong(songId: number): Promise<string> {
  const song = getSong(songId)
  if (!song?.sourceId || !song.remoteId) throw new Error('远程歌曲不存在')
  const source = getSource(song.sourceId)
  validateSource(source)
  const directory = cacheDirectory()
  mkdirSync(directory, { recursive: true })
  const extension =
    (song.format || extname(song.fileName || '') || 'mp3')
      .replace(/^\./, '')
      .replace(/[^a-zA-Z0-9]/g, '') || 'mp3'
  const filePath = join(
    directory,
    `navidrome-${source.id}-${song.remoteId.replace(/[^a-zA-Z0-9._-]/g, '_')}.${extension}`
  )
  if (existsSync(filePath)) return filePath
  const response = await fetch(sourceUrl(source, 'stream', { id: song.remoteId }))
  if (!response.ok) throw new Error(`下载远程歌曲失败（${response.status}）`)
  const temporaryPath = `${filePath}.part`
  writeFileSync(temporaryPath, Buffer.from(await response.arrayBuffer()))
  if (existsSync(filePath)) unlinkSync(filePath)
  renameSync(temporaryPath, filePath)
  cleanupCache(directory)
  return filePath
}
