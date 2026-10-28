import { ref, watch, onScopeDispose } from 'vue'
import type { Ref } from 'vue'
import type { SongLyricSettings } from '../../../shared/songLyrics'

interface SongLyricController {
  songLyricSettings: Ref<SongLyricSettings>
  lyricsOffsetMs: Ref<number>
  lyricsSettingsReady: Ref<boolean>
  setLyricsOffset(value: number): void
  saveLyricsOffset(value?: number | null): Promise<void>
}
import { defaultSongLyricSettings, normalizeLyricOffset } from '../../../shared/songLyrics'
import { readSongLyricSettings, writeSongLyricSettings } from './songLyricSettings'
import eventBus from '@/utils/eventBus'

/** Lives with playback, so closing the player panel cannot leak an offset into the next song. */
export function createSongLyricController(
  song: Readonly<Ref<{ id: number } | null>>,
  ui: { lyricsOffsetMs: number; lyricsOffsetPerSong: boolean }
): SongLyricController {
  const settings = ref(defaultSongLyricSettings(0))
  const offsetMs = ref(0)
  const ready = ref(false)
  let revision = 0
  let offsetRevision = 0
  async function load(reset: boolean): Promise<void> {
    const songId = song.value?.id
    const call = ++revision
    const edit = offsetRevision
    if (reset) {
      settings.value = defaultSongLyricSettings(songId ?? 0)
      offsetMs.value = ui.lyricsOffsetPerSong ? 0 : normalizeLyricOffset(ui.lyricsOffsetMs || 0)
      ready.value = false
    }
    if (!songId) return
    try {
      const result = await readSongLyricSettings(songId)
      if (call !== revision || song.value?.id !== songId) return
      if (edit === offsetRevision && (reset || result.offsetMs !== settings.value.offsetMs))
        offsetMs.value =
          result.offsetMs ??
          (ui.lyricsOffsetPerSong ? 0 : normalizeLyricOffset(ui.lyricsOffsetMs || 0))
      settings.value = result
      ready.value = true
    } catch (error) {
      if (call === revision) console.warn('[Lyrics] Could not load song settings', error)
    }
  }
  watch(
    () => song.value?.id,
    () => {
      void load(true)
    },
    { immediate: true, flush: 'sync' }
  )
  watch(
    () => ui.lyricsOffsetPerSong,
    () => {
      offsetRevision++
      offsetMs.value =
        settings.value.offsetMs ??
        (ui.lyricsOffsetPerSong ? 0 : normalizeLyricOffset(ui.lyricsOffsetMs || 0))
    }
  )
  watch(
    () => ui.lyricsOffsetMs,
    (offset) => {
      if (!ui.lyricsOffsetPerSong && settings.value.offsetMs === null)
        offsetMs.value = normalizeLyricOffset(offset || 0)
    }
  )
  function setOffset(value: number): void {
    if (!Number.isFinite(value)) return
    offsetRevision++
    offsetMs.value = normalizeLyricOffset(value)
    if (!ui.lyricsOffsetPerSong) ui.lyricsOffsetMs = offsetMs.value
  }
  async function saveOffset(value: number | null = offsetMs.value): Promise<void> {
    const songId = song.value?.id
    if (!songId) return
    await writeSongLyricSettings(songId, { offsetMs: value })
  }
  const changed = (songId: number): void => {
    if (songId === song.value?.id) void load(false)
  }
  eventBus.on('songLyricSettingsChanged', changed)
  onScopeDispose(() => {
    revision++
    eventBus.off('songLyricSettingsChanged', changed)
  })
  return {
    songLyricSettings: settings,
    lyricsOffsetMs: offsetMs,
    lyricsSettingsReady: ready,
    setLyricsOffset: setOffset,
    saveLyricsOffset: saveOffset
  }
}
