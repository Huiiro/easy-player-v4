import { basename, dirname } from 'node:path'
import { getDatabase } from '../index'
import { buildSongSearchFilter } from '../../search/searchQuery'
import type { LibraryFolder, Song } from '../types'
import { songColumns, relevanceOrder, attachTags, mapSong, type SongRow } from './songHelpers'
import { deleteSongs } from './songs'

export function listLocalFolders(): LibraryFolder[] {
  return getDatabase()
    .prepare(
      `WITH RECURSIVE folder_descendants(folder_id, descendant_id) AS (
        SELECT id, id
        FROM folder
        WHERE full_path NOT LIKE 'remote://%'
        UNION ALL
        SELECT fd.folder_id, child.id
        FROM folder_descendants fd
        JOIN folder child ON child.pid = fd.descendant_id
        WHERE child.full_path NOT LIKE 'remote://%'
       )
       SELECT f.id, f.pid, f.name, f.full_path AS fullPath, f.is_root_path AS isRootPath,
        COUNT(s.id) AS songCount
       FROM folder f
       LEFT JOIN folder_descendants fd ON fd.folder_id = f.id
       LEFT JOIN song s ON s.folder_id = fd.descendant_id AND s.source_id IS NULL
       WHERE f.full_path NOT LIKE 'remote://%'
       GROUP BY f.id
       ORDER BY f.is_root_path DESC, f.name COLLATE NOCASE`
    )
    .all()
    .map((row) => ({
      ...(row as Omit<LibraryFolder, 'isRootPath'>),
      isRootPath: (row as { isRootPath: number }).isRootPath === 1
    }))
}

export function rebuildLocalFolders(): number {
  const db = getDatabase()
  const songs = db.prepare('SELECT id, audio FROM song WHERE source_id IS NULL').all() as Array<{
    id: number
    audio: string
  }>
  const findFolder = db.prepare('SELECT id FROM folder WHERE full_path = ?')
  const insertFolder = db.prepare(
    'INSERT INTO folder (pid, name, full_path, is_root_path, import_time) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)'
  )
  const updateSong = db.prepare('UPDATE song SET folder_id = ? WHERE id = ?')
  const getFolder = (fullPath: string): number => {
    const existing = findFolder.get(fullPath) as { id: number } | undefined
    if (existing) return existing.id
    const parentPath = dirname(fullPath)
    const parentId = parentPath === fullPath ? null : getFolder(parentPath)
    return Number(
      insertFolder.run(
        parentId,
        basename(fullPath) || fullPath,
        fullPath,
        parentId === null ? 1 : 0
      ).lastInsertRowid
    )
  }
  db.transaction(() => {
    for (const song of songs) updateSong.run(getFolder(dirname(song.audio)), song.id)
  })()
  return songs.length
}

export function getLocalFolderSongs(folderId: number, search = ''): Song[] {
  const filter = buildSongSearchFilter(getDatabase(), search)
  const rows = getDatabase()
    .prepare(
      `WITH RECURSIVE descendants(id) AS (
        SELECT id FROM folder WHERE id = @folderId
        UNION ALL
        SELECT f.id FROM folder f JOIN descendants d ON f.pid = d.id
      )
      SELECT ${songColumns}, ${filter.score} AS searchScore FROM song
      WHERE source_id IS NULL AND folder_id IN (SELECT id FROM descendants)
      ${filter.sql ? `AND ${filter.sql}` : ''}
      ORDER BY ${relevanceOrder(filter.sql)}id DESC`
    )
    .all({ folderId, ...filter.params })
  return attachTags(rows.map((row) => mapSong(row as SongRow)))
}

export function deleteLocalFolderSongs(folderId: number): {
  deleted: number
  removedFolders: number
  songIds: number[]
} {
  const db = getDatabase()
  const folder = db
    .prepare('SELECT id, pid FROM folder WHERE id = ? AND full_path NOT LIKE ?')
    .get(folderId, 'remote://%') as { id: number; pid: number | null } | undefined
  if (!folder) return { deleted: 0, removedFolders: 0, songIds: [] }

  const descendants = db
    .prepare(
      `WITH RECURSIVE descendants(id, depth) AS (
        SELECT id, 0 FROM folder WHERE id = ?
        UNION ALL
        SELECT child.id, parent.depth + 1
        FROM folder child JOIN descendants parent ON child.pid = parent.id
      )
      SELECT id FROM descendants ORDER BY depth DESC`
    )
    .all(folderId) as Array<{ id: number }>
  const songIds = db
    .prepare(
      `WITH RECURSIVE descendants(id) AS (
        SELECT id FROM folder WHERE id = ?
        UNION ALL
        SELECT child.id FROM folder child JOIN descendants parent ON child.pid = parent.id
      )
      SELECT song.id FROM song JOIN descendants ON song.folder_id = descendants.id
      WHERE song.source_id IS NULL`
    )
    .all(folderId) as Array<{ id: number }>

  let deleted = 0
  for (let start = 0; start < songIds.length; start += 500) {
    deleted += deleteSongs(
      songIds.slice(start, start + 500).map((song) => song.id),
      false
    ).deleted
  }

  const removeIfEmpty = db.prepare(
    `DELETE FROM folder WHERE id = ?
      AND NOT EXISTS (SELECT 1 FROM song WHERE folder_id = ?)
      AND NOT EXISTS (SELECT 1 FROM folder WHERE pid = ?)`
  )
  let removedFolders = 0
  db.transaction(() => {
    for (const { id } of descendants) removedFolders += removeIfEmpty.run(id, id, id).changes
    let parentId = folder.pid
    while (parentId !== null) {
      const parent = db.prepare('SELECT pid FROM folder WHERE id = ?').get(parentId) as
        { pid: number | null } | undefined
      if (!parent || !removeIfEmpty.run(parentId, parentId, parentId).changes) break
      removedFolders++
      parentId = parent.pid
    }
  })()
  return { deleted, removedFolders, songIds: songIds.map((song) => song.id) }
}
