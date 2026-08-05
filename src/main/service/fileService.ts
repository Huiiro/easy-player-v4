import AdmZip from 'adm-zip'
import { existsSync, mkdirSync, promises as fs, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { parseFile } from 'music-metadata'
import { getDataPath } from '../utils/pathUtils'
import { getDatabase } from '../database'

type BackupPart = 'songs' | 'playlists' | 'tags' | 'settings'
type BackupManifest = {
  version: '1.0'
  exportedAt: string
  contents: Partial<Record<BackupPart, { file: string; count: number }>>
}

export async function recoverMovedSongs(
  root: string
): Promise<{ total: number; recovered: number }> {
  const db = getDatabase()
  const localSongs = db
    .prepare(
      'SELECT id, audio, file_name AS fileName, file_size AS fileSize FROM song WHERE source_id IS NULL'
    )
    .all() as Array<{ id: number; audio: string; fileName: string | null; fileSize: number | null }>
  const missing = localSongs.filter((song) => !existsSync(song.audio))
  const markMissing = db.prepare('UPDATE song SET song_status = 0 WHERE id = ?')
  for (const song of missing) markMissing.run(song.id)
  if (!missing.length) return { total: 0, recovered: 0 }
  const files = new Map<string, string[]>()
  const names = new Map<string, string[]>()
  const visit = async (directory: string): Promise<void> => {
    for (const name of await fs.readdir(directory)) {
      const fullPath = join(directory, name)
      const stat = await fs.stat(fullPath)
      if (stat.isDirectory()) await visit(fullPath)
      else {
        for (const fileName of new Set([name, basename(name, extname(name))])) {
          const key = `${fileName}\0${stat.size}`
          files.set(key, [...(files.get(key) ?? []), fullPath])
          names.set(fileName, [...(names.get(fileName) ?? []), fullPath])
        }
      }
    }
  }
  await visit(root)
  const update = db.prepare(
    'UPDATE song SET audio = ?, file_name = ?, file_size = ?, song_status = 1 WHERE id = ?'
  )
  let recovered = 0
  for (const song of missing) {
    if (!song.fileName || song.fileSize === null) continue
    const candidates = files.get(`${song.fileName}\0${song.fileSize}`) ?? []
    const fallback = names.get(song.fileName) ?? []
    const filePath =
      candidates.length === 1 ? candidates[0] : fallback.length === 1 ? fallback[0] : null
    if (filePath) {
      update.run(filePath, basename(filePath), (await fs.stat(filePath)).size, song.id)
      recovered++
    }
  }
  return { total: missing.length, recovered }
}

export function exportLibrary(filePath: string, parts: BackupPart[]): { filePath: string } {
  const db = getDatabase()
  const temp = join(tmpdir(), `easy-player-export-${Date.now()}`)
  mkdirSync(temp, { recursive: true })
  const manifest: BackupManifest = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    contents: {}
  }
  const save = (part: BackupPart, value: unknown, count: number): void => {
    const file = `${part}.json`
    writeFileSync(join(temp, file), JSON.stringify(value))
    manifest.contents[part] = { file, count }
  }
  if (parts.includes('songs')) {
    const rows = db.prepare('SELECT * FROM song').all()
    save('songs', rows, rows.length)
  }
  if (parts.includes('playlists')) {
    const playlists = db.prepare('SELECT * FROM song_list').all()
    save(
      'playlists',
      { playlists, relations: db.prepare('SELECT * FROM song_list_item').all() },
      playlists.length
    )
  }
  if (parts.includes('tags')) {
    const tags = db.prepare('SELECT * FROM tag').all()
    save('tags', { tags, relations: db.prepare('SELECT * FROM song_tag').all() }, tags.length)
  }
  if (parts.includes('settings')) {
    const rows = db.prepare('SELECT * FROM app_setting').all()
    save('settings', rows, rows.length)
  }
  writeFileSync(join(temp, 'manifest.json'), JSON.stringify(manifest))
  const zip = new AdmZip()
  for (const name of readdirSync(temp)) zip.addLocalFile(join(temp, name))
  zip.writeZip(filePath)
  rmSync(temp, { recursive: true, force: true })
  return { filePath }
}

export async function importLibrary(
  filePath: string,
  progress?: (current: number, total: number) => void
): Promise<{ added: number; skipped: number }> {
  if (!existsSync(filePath)) throw new Error('Backup file not found')
  const zip = new AdmZip(filePath)
  const manifest = JSON.parse(zip.readAsText('manifest.json')) as BackupManifest
  if (manifest.version !== '1.0') throw new Error('Unsupported backup version')
  const db = getDatabase()
  const imported: Array<{ id: number; audio: string }> = []
  const songIdMap = new Map<number, number>()
  let added = 0
  let skipped = 0
  const songs = manifest.contents.songs
    ? (JSON.parse(zip.readAsText('songs.json')) as Array<Record<string, unknown>>)
    : []
  const known = new Set(
    (db.prepare('SELECT audio FROM song').all() as Array<{ audio: string }>).map((row) => row.audio)
  )
  const insert = db.prepare(
    'INSERT INTO song (title,artist,album,duration,cover,audio,folder_id,is_newest,lrc,translation,year,genre,bitrate,sample_rate,bit_depth,channels,format,file_name,file_size,play_times,track_no,disk_no,song_status,source_id,remote_id) VALUES (@title,@artist,@album,@duration,@cover,@audio,@folder_id,@is_newest,@lrc,@translation,@year,@genre,@bitrate,@sample_rate,@bit_depth,@channels,@format,@file_name,@file_size,@play_times,@track_no,@disk_no,@song_status,@source_id,@remote_id)'
  )
  db.transaction(() => {
    const getFolderId = (fullPath: string): number => {
      const existing = db.prepare('SELECT id FROM folder WHERE full_path = ?').get(fullPath) as
        { id: number } | undefined
      if (existing) return existing.id
      const parentPath = dirname(fullPath)
      const parentId = parentPath === fullPath ? null : getFolderId(parentPath)
      return Number(
        db
          .prepare(
            'INSERT INTO folder (pid, name, full_path, is_root_path, import_time) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)'
          )
          .run(parentId, basename(fullPath) || fullPath, fullPath, parentId === null ? 1 : 0)
          .lastInsertRowid
      )
    }
    for (const song of songs) {
      const audio = String(song.audio ?? '')
      const sourceId = Number(song.id)
      const duplicate = db.prepare('SELECT id FROM song WHERE audio = ?').get(audio) as
        { id: number } | undefined
      if (!audio || duplicate || known.has(audio)) {
        if (duplicate && Number.isInteger(sourceId)) songIdMap.set(sourceId, duplicate.id)
        skipped++
        continue
      }
      const result = insert.run({
        ...song,
        folder_id: getFolderId(dirname(audio)),
        cover: null,
        is_newest: song.is_newest ?? 0,
        song_status: existsSync(audio) ? 1 : 0,
        source_id: null,
        remote_id: null
      })
      imported.push({ id: Number(result.lastInsertRowid), audio })
      if (Number.isInteger(sourceId)) songIdMap.set(sourceId, Number(result.lastInsertRowid))
      known.add(audio)
      added++
    }
    if (manifest.contents.playlists) {
      const payload = JSON.parse(zip.readAsText('playlists.json')) as {
        playlists: Array<{ id: number; name: string; description?: string; position?: number }>
        relations: Array<{ song_list_id: number; song_id: number; position?: number }>
      }
      const playlistIdMap = new Map<number, number>()
      const create = db.prepare(
        'INSERT INTO song_list (name, description, position) VALUES (?, ?, ?)'
      )
      const names = new Set(
        (db.prepare('SELECT name FROM song_list').all() as Array<{ name: string }>).map(
          (row) => row.name
        )
      )
      for (const playlist of payload.playlists) {
        let name = playlist.name || 'Imported Playlist'
        let index = 1
        while (names.has(name)) name = `${playlist.name}_${index++}`
        names.add(name)
        playlistIdMap.set(
          playlist.id,
          Number(
            create.run(name, playlist.description ?? null, playlist.position ?? 0).lastInsertRowid
          )
        )
      }
      const add = db.prepare(
        'INSERT OR IGNORE INTO song_list_item (song_list_id, song_id, position) VALUES (?, ?, ?)'
      )
      for (const relation of payload.relations) {
        const listId = playlistIdMap.get(relation.song_list_id)
        const songId = songIdMap.get(relation.song_id)
        if (listId && songId) add.run(listId, songId, relation.position ?? 0)
      }
    }
  })()
  const updateCover = db.prepare('UPDATE song SET cover = ? WHERE id = ?')
  const coverDir = join(getDataPath(), 'covers')
  mkdirSync(coverDir, { recursive: true })
  for (const [index, song] of imported.entries()) {
    try {
      const picture = (await parseFile(song.audio)).common.picture?.[0]
      if (picture) {
        const cover = join(coverDir, `${randomUUID()}.jpg`)
        writeFileSync(cover, picture.data)
        updateCover.run(cover, song.id)
      }
    } finally {
      progress?.(index + 1, imported.length)
    }
  }
  return { added, skipped }
}
