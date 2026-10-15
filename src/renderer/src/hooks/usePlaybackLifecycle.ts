import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import i18n from '@/i18n'
import { useShortcuts } from '@/hooks/useShortcuts'
import { useMessage } from '@/components/ui/useMessage'

export function usePlaybackLifecycle(): {
  ui: ReturnType<typeof useUIStore>
  player: ReturnType<typeof usePlayerStore>
} {
  const ui = useUIStore()
  const player = usePlayerStore()
  const { error: showError } = useMessage()
  let stopFileListener: (() => void) | undefined
  let stopFileErrorListener: (() => void) | undefined
  let filePlayback = Promise.resolve()
  useShortcuts()

  watch(
    () => ui.locale,
    (locale) => {
      i18n.global.locale = locale
      window.api.system.setLocale(locale)
    },
    { immediate: true }
  )

  // Hide the native caption area while the immersive player is open. On Windows
  // the main process collapses the Window Controls Overlay itself.
  watch(
    () => ui.showPlayer,
    (showPlayer) => window.api.window.setTrafficLightVisible(!showPlayer),
    { immediate: true }
  )

  onMounted(async () => {
    await player.setExtremePlayback(ui.extremePlayback, false)
    if (!ui.extremePlayback) await ui.initializeTheme()
    player.subscribeToEvents()
    await player.loadSmartShuffleConfig()
    await player.loadRhythmVisualConfig()
    await player.initializePersistentState()
    const hasPendingFiles = await window.api.system.hasPendingAudioFiles()
    await player.restorePlaybackSession(ui.autoPlayOnRestore && !hasPendingFiles)
    await player.attachRenderer()
    stopFileListener = window.api.system.onOpenAudioFiles((songs) => {
      filePlayback = filePlayback
        .then(async () => {
          if (!songs.length) return
          player.addToQueue(songs, true)
          const index = player.queue.findIndex((song) => song.id === songs[0].id)
          if (index < 0 || !(await player.playQueueItem(index))) {
            showError(i18n.global.t('settings.openAudioFailed'))
          }
        })
        .catch(() => {
          showError(i18n.global.t('settings.openAudioFailed'))
        })
    })
    stopFileErrorListener = window.api.system.onOpenFilesError(() =>
      showError(i18n.global.t('settings.openAudioFailed'))
    )
    window.api.system.audioFilesReady(true)
    window.addEventListener('beforeunload', player.finishHistoryOnUnload)
    window.addEventListener('beforeunload', player.savePlaybackSessionSync)
  })
  onBeforeUnmount(() => {
    window.api.system.audioFilesReady(false)
    stopFileListener?.()
    stopFileErrorListener?.()
    window.removeEventListener('beforeunload', player.savePlaybackSessionSync)
    window.removeEventListener('beforeunload', player.finishHistoryOnUnload)
    player.savePlaybackSessionSync()
    player.unsubscribe()
  })

  return { ui, player }
}
