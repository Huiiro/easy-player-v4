import type { SongLyricSettings, SongLyricSettingsPatch } from '../../../shared/songLyrics'
import eventBus from '@/utils/eventBus'

export async function readSongLyricSettings(songId: number): Promise<SongLyricSettings> {
  const response = await window.api.database.command('getSongLyricSettings', { songId })
  if (!response.success) throw new Error(response.error || 'Failed to load lyric settings')
  if (!response.data) throw new Error('Failed to load lyric settings')
  return response.data as SongLyricSettings
}
export async function writeSongLyricSettings(
  songId: number,
  patch: SongLyricSettingsPatch
): Promise<SongLyricSettings> {
  const response = await window.api.database.command('setSongLyricSettings', {
    songId,
    patch: { ...patch }
  })
  if (!response.success) throw new Error(response.error || 'Failed to save lyric settings')
  if (!response.data) throw new Error('Failed to save lyric settings')
  eventBus.emit('songLyricSettingsChanged', songId)
  return response.data as SongLyricSettings
}
