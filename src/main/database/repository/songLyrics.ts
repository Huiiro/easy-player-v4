import { getDatabase } from '../index'
import { defaultSongLyricSettings, normalizeLyricOffset } from '../../../shared/songLyrics'
import type { SongLyricSettings, SongLyricSettingsPatch } from '../../../shared/songLyrics'

export function getSongLyricSettings(songId: number): SongLyricSettings {
  if (!Number.isInteger(songId) || songId <= 0) throw new Error('Invalid song ID')
  const row = getDatabase()
    .prepare(
      'SELECT offset_ms AS offsetMs, disable_network_lyrics AS disableNetwork, instrumental FROM song WHERE id = ?'
    )
    .get(songId) as
    { offsetMs: number | null; disableNetwork: number; instrumental: number } | undefined
  return row
    ? {
        songId,
        offsetMs: row.offsetMs,
        disableNetwork: row.disableNetwork === 1,
        instrumental: row.instrumental === 1
      }
    : defaultSongLyricSettings(songId)
}

export function setSongLyricSettings(
  songId: number,
  patch: SongLyricSettingsPatch
): SongLyricSettings {
  if (!Number.isInteger(songId) || songId <= 0 || !patch || typeof patch !== 'object')
    throw new Error('Invalid lyric settings')
  for (const key of ['disableNetwork', 'instrumental'] as const)
    if (patch[key] !== undefined && typeof patch[key] !== 'boolean')
      throw new Error('Invalid lyric flag')
  if (
    patch.offsetMs !== undefined &&
    patch.offsetMs !== null &&
    (typeof patch.offsetMs !== 'number' || !Number.isFinite(patch.offsetMs))
  )
    throw new Error('Invalid lyric offset')
  const db = getDatabase()
  return db.transaction(() => {
    if (!db.prepare('SELECT id FROM song WHERE id = ?').get(songId))
      throw new Error('Song not found')
    const current = getSongLyricSettings(songId)
    const next = {
      ...current,
      offsetMs:
        patch.offsetMs === undefined
          ? current.offsetMs
          : patch.offsetMs === null
            ? null
            : normalizeLyricOffset(patch.offsetMs),
      disableNetwork: patch.disableNetwork ?? current.disableNetwork,
      instrumental: patch.instrumental ?? current.instrumental
    }
    db.prepare(
      'UPDATE song SET offset_ms = ?, disable_network_lyrics = ?, instrumental = ? WHERE id = ?'
    ).run(next.offsetMs, Number(next.disableNetwork), Number(next.instrumental), songId)
    return next
  })()
}

export function songAllowsNetworkLyrics(songId: number | undefined): boolean {
  if (songId === undefined) return true
  const settings = getSongLyricSettings(songId)
  return !settings.disableNetwork && !settings.instrumental
}

export function setSongsLyricFlags(
  songIds: number[],
  patch: Pick<SongLyricSettingsPatch, 'disableNetwork' | 'instrumental'>
): number[] {
  if (
    !Array.isArray(songIds) ||
    songIds.length > 10000 ||
    songIds.some((id) => !Number.isInteger(id) || id <= 0)
  )
    throw new Error('Invalid song IDs')
  if (
    !patch ||
    !Object.keys(patch).length ||
    Object.keys(patch).some((key) => !['disableNetwork', 'instrumental'].includes(key))
  )
    throw new Error('Invalid lyric flags')
  for (const value of Object.values(patch))
    if (typeof value !== 'boolean') throw new Error('Invalid lyric flag')
  const ids = [...new Set(songIds)]
  const db = getDatabase()
  return db.transaction(() => {
    const exists = db.prepare('SELECT id FROM song WHERE id = ?')
    const fields = Object.keys(patch) as Array<'disableNetwork' | 'instrumental'>
    const update = db.prepare(
      `UPDATE song SET ${fields.map((key) => `${key === 'disableNetwork' ? 'disable_network_lyrics' : 'instrumental'} = ?`).join(', ')} WHERE id = ?`
    )
    for (const id of ids) {
      if (!exists.get(id)) throw new Error('Song not found')
      update.run(...fields.map((key) => Number(patch[key])), id)
    }
    return ids
  })()
}
