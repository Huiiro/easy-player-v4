<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { type LyricLine, resolveLyrics } from '@/services/lyrics'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
import eventBus from '@/utils/eventBus'

const player = usePlayerStore()
const ui = useUIStore()
const lyrics = ref<LyricLine[]>([])
// Timestamp-only rows mark pauses in the full lyric view, but must not occupy
// either of the two text slots in the desktop overlay.
const displayLyrics = computed(() => lyrics.value.filter((line) => line.text.trim()))
let requestId = 0
let lyricRevision = 0
let disposed = false

async function loadLyrics(): Promise<void> {
  const id = ++requestId
  const song = player.currentQueueSong
  if (!song) {
    lyrics.value = []
    return
  }
  const result = await resolveLyrics(
    song,
    ui.lyricSourceOrder,
    ui.lyricSourceMode,
    ui.autoSearchNetworkLyrics,
    ui.preferWordTimedNetworkLyrics
  )
  if (id === requestId) {
    lyrics.value = result.lines
    lyricRevision += 1
    publish()
  }
}

function currentIndex(): number {
  for (let index = displayLyrics.value.length - 1; index >= 0; index -= 1)
    if (player.positionMs >= displayLyrics.value[index].timeMs) return index
  return 0
}

function activeLines(): LyricLine[] {
  return displayLyrics.value.filter((line, index) => {
    if (line.untimed || player.positionMs < line.timeMs) return false
    const endMs = line.endMs ?? displayLyrics.value[index + 1]?.timeMs ?? line.timeMs + 5000
    return player.positionMs < endMs
  })
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
  if (disposed || !ui.useDesktopLyrics) return
  const active = activeLines()
  const fallbackIndex = currentIndex()
  const current =
    active.find((line) => !line.isBackground) ?? active[0] ?? displayLyrics.value[fallbackIndex]
  const index = current ? displayLyrics.value.indexOf(current) : fallbackIndex
  const overlapping = active.find((line) => line !== current)
  const next = overlapping ?? displayLyrics.value[index + 1]
  const sweepRange = lyricSweepRange(current, next)
  const estimatedLastLineEnd = current
    ? current.timeMs + Math.max(3000, Array.from(current.text).length * 180)
    : undefined
  const currentEndMs = current
    ? !next && !current.words?.length && (current.endMs ?? 0) <= current.timeMs + 300
      ? Math.min(
          estimatedLastLineEnd ?? current.timeMs + 3000,
          player.durationMs > current.timeMs ? player.durationMs : Number.POSITIVE_INFINITY
        )
      : (current.endMs ?? next?.timeMs ?? estimatedLastLineEnd)
    : undefined
  window.api.desktopLyrics.update({
    songId: player.currentQueueSong?.id,
    revision: lyricRevision,
    current: current?.text || player.currentQueueSong?.title || '',
    currentStartMs: current?.untimed ? undefined : current?.timeMs,
    currentEndMs: current?.untimed ? undefined : currentEndMs,
    next: next?.text || '',
    translation:
      !overlapping && ui.desktopLyricsStyles.showTranslation ? current?.translation || '' : '',
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
function handleLyricsUpdated(songId: number): void {
  if (songId === player.currentQueueSong?.id) void loadLyrics()
}

onMounted(() => {
  eventBus.on('lyricsUpdated', handleLyricsUpdated)
  cleanups.push(() => eventBus.off('lyricsUpdated', handleLyricsUpdated))
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
onBeforeUnmount(() => {
  disposed = true
  requestId += 1
  cleanups.forEach((cleanup) => cleanup())
  // The parent's v-if unmounts this component before its disabled-state watcher can run.
  void window.api.desktopLyrics.close()
})

watch(
  () => [
    player.currentQueueSong?.id,
    ui.lyricSourceOrder.join('|'),
    ui.lyricSourceMode,
    ui.autoSearchNetworkLyrics,
    ui.preferWordTimedNetworkLyrics
  ],
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
