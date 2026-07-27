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

export type RemoteProviderId = 'navidrome' | 'jellyfin'

interface RemoteTrack {
  id: string
  title: string
  artist?: string
  album?: string
  duration?: number
  coverId?: string
  year?: number
  genre?: string
  bitrate?: number
  sampleRate?: number
  bitDepth?: number
  channels?: number
  format?: string
  path?: string
  size?: number
  track?: number
  discNumber?: number
}

interface RemoteProvider {
  readonly id: RemoteProviderId
  test(config: RemoteConnection): Promise<{ version: string }>
  listTracks(source: ConfiguredSource): Promise<RemoteTrack[]>
  fetchCover(source: ConfiguredSource, coverId: string): Promise<Response>
  fetchStream(source: ConfiguredSource, trackId: string): Promise<Response>
}

type RemoteConnection = { baseUrl: string; user: string; secret: string; type: RemoteProviderId }
type ConfiguredSource = MusicSource & RemoteConnection

function normalizedBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/$/, '')
}

function providerFor(type: string | null | undefined): RemoteProvider {
  const provider = providers[type as RemoteProviderId]
  if (!provider) throw new Error(`不支持的远程音源类型：${type || 'unknown'}`)
  return provider
}

function validateSource(source: MusicSource | null): asserts source is ConfiguredSource {
  if (!source?.baseUrl || !source.user || !source.secret) throw new Error('远程音源配置不完整')
  providerFor(source.type)
}

function subsonicUrl(
  source: RemoteConnection,
  endpoint: string,
  parameters: Record<string, string> = {}
): string {
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
  return `${normalizedBaseUrl(source.baseUrl)}/rest/${endpoint}.view?${query}`
}

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
  'subsonic-response'?: T & { status?: string; version?: string; error?: { message?: string } }
}

/** Some reverse proxies return an empty page or HTML on an authentication error. */
async function readJson<T>(response: Response): Promise<T | undefined> {
  const text = await response.text()
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

async function subsonicRequest<T>(
  source: RemoteConnection,
  endpoint: string,
  parameters: Record<string, string> = {}
): Promise<T> {
  const response = await fetch(subsonicUrl(source, endpoint, parameters))
  const body = await readJson<SubsonicResponse<T>>(response)
  const result = body?.['subsonic-response']
  if (!response.ok || result?.status !== 'ok')
    throw new Error(result?.error?.message || `请求 ${endpoint} 失败`)
  return result as T
}

const navidromeProvider: RemoteProvider = {
  id: 'navidrome',
  async test(config) {
    const result = await subsonicRequest<{ version?: string }>(config, 'ping')
    return { version: result.version || '' }
  },
  async listTracks(source) {
    const artists = await subsonicRequest<{
      artists?: { index?: Array<{ artist?: Array<{ id: string }> }> }
    }>(source, 'getArtists')
    const tracks: RemoteTrack[] = []
    for (const artist of artists.artists?.index?.flatMap((index) => index.artist || []) || []) {
      const artistResult = await subsonicRequest<{ artist?: { album?: Array<{ id: string }> } }>(
        source,
        'getArtist',
        { id: artist.id }
      )
      for (const album of artistResult.artist?.album || []) {
        const albumResult = await subsonicRequest<{ album?: { song?: SubsonicSong[] } }>(
          source,
          'getAlbum',
          { id: album.id }
        )
        tracks.push(
          ...(albumResult.album?.song || []).map((song) => ({
            id: song.id,
            title: song.title || '',
            artist: song.artist,
            album: song.album,
            duration: song.duration,
            coverId: song.coverArt,
            year: song.year,
            genre: song.genre,
            bitrate: song.bitRate,
            sampleRate: song.samplingRate,
            bitDepth: song.bitDepth,
            channels: song.channelCount,
            format: song.suffix,
            path: song.path,
            size: song.size,
            track: song.track,
            discNumber: song.discNumber
          }))
        )
      }
    }
    return tracks
  },
  fetchCover: (source, coverId) =>
    fetch(subsonicUrl(source, 'getCoverArt', { id: coverId, size: '600' })),
  fetchStream: (source, trackId) => fetch(subsonicUrl(source, 'stream', { id: trackId }))
}

interface JellyfinItem {
  Id: string
  Name?: string
  Album?: string
  AlbumId?: string
  Artists?: string[]
  AlbumArtists?: string[]
  RunTimeTicks?: number
  ProductionYear?: number
  Genres?: string[]
  Container?: string
  Path?: string
  Size?: number
  IndexNumber?: number
  ParentIndexNumber?: number
  ImageTags?: { Primary?: string }
  MediaStreams?: Array<{
    Type?: string
    BitRate?: number
    SampleRate?: number
    BitDepth?: number
    Channels?: number
  }>
}
interface JellyfinAuth {
  AccessToken?: string
  ServerId?: string
}

async function jellyfinToken(connection: RemoteConnection): Promise<string> {
  const response = await fetch(
    `${normalizedBaseUrl(connection.baseUrl)}/Users/AuthenticateByName`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization:
          'MediaBrowser Client="EasyPlayer", Device="EasyPlayer Desktop", DeviceId="easy-player-desktop", Version="3.0.0"'
      },
      body: JSON.stringify({ Username: connection.user, Pw: connection.secret })
    }
  )
  const result = (await readJson<JellyfinAuth & { Message?: string }>(response)) || {}
  if (!response.ok || !result.AccessToken) throw new Error(result.Message || 'Jellyfin 认证失败')
  return result.AccessToken
}

async function jellyfinFetch(
  connection: RemoteConnection,
  path: string,
  options: RequestInit = {}
): Promise<Response> {
  const token = await jellyfinToken(connection)
  return fetch(`${normalizedBaseUrl(connection.baseUrl)}${path}`, {
    ...options,
    headers: { ...options.headers, 'X-Emby-Token': token }
  })
}

const jellyfinProvider: RemoteProvider = {
  id: 'jellyfin',
  async test(config) {
    const token = await jellyfinToken(config)
    const response = await fetch(`${normalizedBaseUrl(config.baseUrl)}/System/Info`, {
      headers: { 'X-Emby-Token': token }
    })
    const info = (await readJson<{ Version?: string; Message?: string }>(response)) || {}
    if (!response.ok) throw new Error(info.Message || 'Jellyfin 连接失败')
    return { version: info.Version || '' }
  },
  async listTracks(source) {
    const tracks: RemoteTrack[] = []
    for (let startIndex = 0; ; startIndex += 200) {
      const query = new URLSearchParams({
        IncludeItemTypes: 'Audio',
        Recursive: 'true',
        Fields: 'Genres,MediaStreams,Path,Size,ProductionYear,AlbumArtists',
        StartIndex: String(startIndex),
        Limit: '200'
      })
      const response = await jellyfinFetch(source, `/Items?${query}`)
      const page =
        (await readJson<{
          Items?: JellyfinItem[]
          TotalRecordCount?: number
          Message?: string
        }>(response)) || {}
      if (!response.ok) throw new Error(page.Message || '读取 Jellyfin 曲库失败')
      const items = page.Items || []
      for (const item of items) {
        const audio = item.MediaStreams?.find((stream) => stream.Type === 'Audio')
        tracks.push({
          id: item.Id,
          title: item.Name || '',
          artist: item.Artists?.join(', ') || item.AlbumArtists?.join(', '),
          album: item.Album,
          duration: item.RunTimeTicks ? Math.round(item.RunTimeTicks / 10_000_000) : undefined,
          coverId: item.ImageTags?.Primary ? item.Id : item.AlbumId,
          year: item.ProductionYear,
          genre: item.Genres?.join(', '),
          bitrate: audio?.BitRate ? Math.round(audio.BitRate / 1000) : undefined,
          sampleRate: audio?.SampleRate,
          bitDepth: audio?.BitDepth,
          channels: audio?.Channels,
          format: item.Container,
          path: item.Path,
          size: item.Size,
          track: item.IndexNumber,
          discNumber: item.ParentIndexNumber
        })
      }
      if (items.length === 0 || tracks.length >= (page.TotalRecordCount || 0)) break
    }
    return tracks
  },
  fetchCover: (source, coverId) =>
    jellyfinFetch(source, `/Items/${encodeURIComponent(coverId)}/Images/Primary?maxWidth=600`),
  fetchStream: (source, trackId) =>
    jellyfinFetch(source, `/Audio/${encodeURIComponent(trackId)}/stream?static=true`)
}

const providers: Record<RemoteProviderId, RemoteProvider> = {
  navidrome: navidromeProvider,
  jellyfin: jellyfinProvider
}

export async function testRemoteSource(config: RemoteConnection): Promise<{ version: string }> {
  if (!config.baseUrl.trim() || !config.user.trim() || !config.secret)
    throw new Error('远程音源配置不完整')
  return providerFor(config.type).test(config)
}

function remoteFolderId(source: MusicSource): number {
  const db = getDatabase()
  const path = `remote://${source.id}`
  const existing = db.prepare('SELECT id FROM folder WHERE full_path = ?').get(path) as
    { id: number } | undefined
  if (existing) return existing.id
  return Number(
    db
      .prepare(
        "INSERT INTO folder (pid, name, full_path, is_root_path, import_time) VALUES (NULL, ?, ?, 1, datetime('now', 'localtime'))"
      )
      .run(source.name, path).lastInsertRowid
  )
}

async function cacheCover(source: ConfiguredSource, coverId?: string): Promise<string | null> {
  if (!coverId) return null
  const directory = join(getDataPath(), 'covers', 'remote')
  mkdirSync(directory, { recursive: true })
  const filePath = join(directory, `${source.id}-${coverId.replace(/[^a-zA-Z0-9._-]/g, '_')}.jpg`)
  if (existsSync(filePath)) return filePath
  const response = await providerFor(source.type).fetchCover(source, coverId)
  if (!response.ok) return null
  writeFileSync(filePath, Buffer.from(await response.arrayBuffer()))
  return filePath
}

async function upsertSong(
  source: ConfiguredSource,
  folderId: number,
  song: RemoteTrack
): Promise<void> {
  const cover = await cacheCover(source, song.coverId)
  const db = getDatabase()
  db.prepare(
    `INSERT INTO song (title, artist, album, duration, cover, audio, folder_id, year, genre, bitrate, sample_rate, bit_depth, channels, format, file_name, file_size, track_no, disk_no, source_id, remote_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(audio) DO UPDATE SET title = excluded.title, artist = excluded.artist, album = excluded.album, duration = excluded.duration, cover = excluded.cover, year = excluded.year, genre = excluded.genre, bitrate = excluded.bitrate, sample_rate = excluded.sample_rate, bit_depth = excluded.bit_depth, channels = excluded.channels, format = excluded.format, file_name = excluded.file_name, file_size = excluded.file_size, track_no = excluded.track_no, disk_no = excluded.disk_no`
  ).run(
    song.title,
    song.artist || null,
    song.album || null,
    song.duration || null,
    cover,
    `remote://${source.id}/${song.id}`,
    folderId,
    song.year || null,
    song.genre || null,
    song.bitrate || null,
    song.sampleRate || null,
    song.bitDepth || null,
    song.channels || null,
    song.format || null,
    song.path ? basename(song.path) : null,
    song.size || null,
    song.track || null,
    song.discNumber || null,
    source.id,
    song.id
  )
}

/** Imports a provider library into the local song index. */
export async function syncRemoteSource(
  sourceId: number
): Promise<{ imported: number; total: number }> {
  const source = getSource(sourceId)
  validateSource(source)
  const tracks = await providerFor(source.type).listTracks(source)
  const folderId = remoteFolderId(source)
  for (const track of tracks) await upsertSong(source, folderId, track)
  touchSource(sourceId)
  updateSourceStats(sourceId, tracks.length, tracks.length)
  return { imported: tracks.length, total: tracks.length }
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

/** Returns a local file path, downloading a provider stream on a cache miss. */
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
    `${source.type}-${source.id}-${song.remoteId.replace(/[^a-zA-Z0-9._-]/g, '_')}.${extension}`
  )
  if (existsSync(filePath)) return filePath
  const response = await providerFor(source.type).fetchStream(source, song.remoteId)
  if (!response.ok) throw new Error(`下载远程歌曲失败（${response.status}）`)
  const temporaryPath = `${filePath}.part`
  writeFileSync(temporaryPath, Buffer.from(await response.arrayBuffer()))
  if (existsSync(filePath)) unlinkSync(filePath)
  renameSync(temporaryPath, filePath)
  cleanupCache(directory)
  return filePath
}
