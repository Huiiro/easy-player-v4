<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { type LyricLine, resolveLyrics } from '@/services/lyrics'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'

const player = usePlayerStore()
const ui = useUIStore()
const lyrics = ref<LyricLine[]>([])
let requestId = 0
let lyricRevision = 0

async function loadLyrics(): Promise<void> {
  const id = ++requestId
  const song = player.currentQueueSong
  if (!song) {
    lyrics.value = []
    return
  }
  const result = await resolveLyrics(song, ui.lyricSourceOrder, ui.lyricSourceMode)
  if (id === requestId) {
    lyrics.value = result.lines
    lyricRevision += 1
    publish()
  }
}

function currentIndex(): number {
  for (let index = lyrics.value.length - 1; index >= 0; index -= 1)
    if (player.positionMs >= lyrics.value[index].timeMs) return index
  return 0
}

function lyricSweepRange(
  current: LyricLine | undefined,
  next: LyricLine | undefined
): { startMs: number; endMs: number } | null {
  if (!current) return null
  const startMs = current.words?.[0]?.startMs ?? current.timeMs
  const endMs =
    current.words?.at(-1)?.endMs ??
    current.endMs ??
    next?.timeMs ??
    Math.max(startMs + 1, current.timeMs + 3000)
  return { startMs, endMs: Math.max(startMs + 1, endMs) }
}

function publish(): void {
  if (!ui.useDesktopLyrics) return
  const index = currentIndex()
  const current = lyrics.value[index]
  const next = lyrics.value[index + 1]
  const sweepRange = lyricSweepRange(current, next)
  window.api.desktopLyrics.update({
    songId: player.currentQueueSong?.id,
    revision: lyricRevision,
    current: current?.text || player.currentQueueSong?.title || '',
    next: next?.text || '',
    translation: ui.desktopLyricsStyles.showTranslation ? current?.translation || '' : '',
    positionMs: player.positionMs,
    sweepStartMs: sweepRange?.startMs,
    sweepEndMs: sweepRange?.endMs,
    isPlaying: player.isPlaying,
    styles: {
      ...ui.desktopLyricsStyles,
      fontFamily: ui.resolveFontStack(ui.desktopLyricsStyles.fontFamily || ui.customFontFamily)
    }
  })
}

async function toggleWindow(enabled: boolean): Promise<void> {
  if (enabled) {
    await window.api.desktopLyrics.open()
    publish()
  } else {
    await window.api.desktopLyrics.close()
  }
}

function handleAction(action: 'previous' | 'toggle' | 'next'): void {
  if (action === 'previous') void player.playPrevious()
  else if (action === 'next') void player.playNext()
  else if (player.isPlaying) void player.pause()
  else if (player.currentFile) void player.play()
}

const cleanups: Array<() => void> = []
onMounted(() => {
  cleanups.push(window.api.desktopLyrics.onAction(handleAction))
  cleanups.push(window.api.desktopLyrics.onRequestState(publish))
  cleanups.push(
    window.api.desktopLyrics.onFontSizeChanged((fontSize) => {
      if (fontSize !== ui.desktopLyricsStyles.fontSize) ui.desktopLyricsStyles.fontSize = fontSize
    })
  )
  cleanups.push(
    window.api.desktopLyrics.onClosed(() => {
      ui.useDesktopLyrics = false
    })
  )
})
onBeforeUnmount(() => cleanups.forEach((cleanup) => cleanup()))

watch(
  () => [player.currentQueueSong?.id, ui.lyricSourceOrder.join('|'), ui.lyricSourceMode],
  () => void loadLyrics(),
  { immediate: true }
)
watch(lyrics, publish, { deep: true })
watch(
  [
    () => ui.useDesktopLyrics,
    () => player.positionMs,
    () => player.isPlaying,
    () => player.currentQueueSong?.id,
    () => ui.desktopLyricsStyles
  ],
  () => publish(),
  { deep: true }
)
watch(
  () => ui.useDesktopLyrics,
  (enabled) => void toggleWindow(enabled),
  { immediate: true }
)
</script>

<template><span class="hidden" /></template>
