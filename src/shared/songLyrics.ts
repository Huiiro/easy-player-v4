export interface SongLyricSettings {
  songId: number
  offsetMs: number | null
  disableNetwork: boolean
  instrumental: boolean
}
export type SongLyricSettingsPatch = Partial<Omit<SongLyricSettings, 'songId'>>
export const normalizeLyricOffset = (value: number): number =>
  Math.max(-5000, Math.min(5000, Math.round(value / 100) * 100))
export const defaultSongLyricSettings = (songId: number): SongLyricSettings => ({
  songId,
  offsetMs: null,
  disableNetwork: false,
  instrumental: false
})
