import { getDatabase } from '../index'
import type { Tag, TagInput } from '../types'

export function listTags(songId?: number): Tag[] {
  const db = getDatabase()
  if (songId === undefined)
    return db
      .prepare(
        'SELECT id, name, color, description, tag_order AS tagOrder FROM tag ORDER BY tag_order, id'
      )
      .all() as Tag[]
  return db
    .prepare(
      `SELECT t.id, t.name, t.color, t.description, t.tag_order AS tagOrder, st.song_id IS NOT NULL AS isIncluded FROM tag t LEFT JOIN song_tag st ON st.tag_id = t.id AND st.song_id = ? ORDER BY t.tag_order, t.id`
    )
    .all(songId)
    .map((row) => ({
      ...(row as Tag),
      isIncluded: Boolean((row as { isIncluded: number }).isIncluded)
    }))
}

export function createTag(input: TagInput): Tag {
  const db = getDatabase()
  const result = db
    .prepare(
      `INSERT INTO tag (name, color, description, tag_order) VALUES (?, ?, ?, (SELECT COALESCE(MAX(tag_order), 0) + 1 FROM tag))`
    )
    .run(input.name.trim(), input.color ?? '#888888', input.description ?? null)
  return db
    .prepare('SELECT id, name, color, description, tag_order AS tagOrder FROM tag WHERE id = ?')
    .get(Number(result.lastInsertRowid)) as Tag
}

export function updateTag(id: number, input: TagInput): boolean {
  return (
    getDatabase()
      .prepare('UPDATE tag SET name = ?, color = ?, description = ? WHERE id = ?')
      .run(input.name.trim(), input.color ?? '#888888', input.description ?? null, id).changes > 0
  )
}

export function deleteTag(id: number): boolean {
  return getDatabase().prepare('DELETE FROM tag WHERE id = ?').run(id).changes > 0
}

export function setSongTag(tagId: number, songIds: number[], included: boolean): void {
  const stmt = getDatabase().prepare(
    included
      ? 'INSERT OR IGNORE INTO song_tag (song_id, tag_id) VALUES (?, ?)'
      : 'DELETE FROM song_tag WHERE song_id = ? AND tag_id = ?'
  )
  getDatabase().transaction(() => songIds.forEach((songId) => stmt.run(songId, tagId)))()
}

export function reorderTags(ids: number[]): void {
  const stmt = getDatabase().prepare('UPDATE tag SET tag_order = ? WHERE id = ?')
  getDatabase().transaction(() => ids.forEach((id, index) => stmt.run(index + 1, id)))()
}

export function toggleSongTag(tagId: number, songId: number): boolean {
  const db = getDatabase()
  const exists = db
    .prepare('SELECT 1 FROM song_tag WHERE tag_id = ? AND song_id = ?')
    .get(tagId, songId)
  if (exists) {
    db.prepare('DELETE FROM song_tag WHERE tag_id = ? AND song_id = ?').run(tagId, songId)
    return false
  }
  db.prepare('INSERT INTO song_tag (tag_id, song_id) VALUES (?, ?)').run(tagId, songId)
  return true
}
