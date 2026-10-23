import { onBeforeUnmount, onMounted, watch } from 'vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
import { useMessage } from '@/components/ui/useMessage'
import { formatShortcut, normalizeShortcut } from '@/utils/shortcut'
import { useI18n } from 'vue-i18n'
import eventBus from '@/utils/eventBus'

import { SHORTCUT_ACTIONS, type ShortcutAction } from '../../../shared/shortcuts'

export function useShortcuts(): void {
  const ui = useUIStore()
  const player = usePlayerStore()
  const { warning } = useMessage()
  const { t } = useI18n()
  let preferenceBusy = false
  const run = async (action: ShortcutAction): Promise<void> => {
    try {
      if (action === 'openSearch') {
        if (document.documentElement.dataset.playbackView === 'extreme') {
          warning(t('settings.searchRequiresFullView'))
          return
        }
        eventBus.emit('openGlobalSearch')
      } else if (action === 'previous') await player.playPrevious()
      else if (action === 'next') await player.playNext()
      else if (action === 'toggle') {
        if (player.isPlaying) await player.pause()
        else await player.play()
      } else if (action === 'volumeUp' || action === 'volumeDown') {
        await player.setVolume(
          Math.max(0, Math.min(1, player.volume + (action === 'volumeUp' ? 0.05 : -0.05)))
        )
      } else if (action === 'seekBackward' || action === 'seekForward') {
        if (!player.currentFile || player.durationMs <= 0) return
        const offset = action === 'seekForward' ? 5000 : -5000
        await player.seek(Math.max(0, Math.min(player.durationMs, player.positionMs + offset)))
      } else if (action === 'like' || action === 'dislike') {
        const song = player.currentQueueSong
        if (!song || preferenceBusy) return
        preferenceBusy = true
        try {
          // Lightweight mode suspends recommendation caches; read the saved preference directly.
          const result = await window.api.database.command('getSong', { id: song.id })
          if (!result.success || !result.data) throw new Error('Song unavailable')
          const current = (result.data as { preference?: number }).preference ?? 0
          const preference = action === 'like' ? 1 : -1
          if (!(await player.setPreference(song.id, current === preference ? 0 : preference))) {
            throw new Error('Unable to save song preference')
          }
        } finally {
          preferenceBusy = false
        }
      } else if (action === 'toggleDesktopLyrics') {
        if (ui.extremePlayback && !ui.useDesktopLyrics) {
          warning(t('settings.desktopLyricsLightweight'))
          return
        }
        ui.useDesktopLyrics = !ui.useDesktopLyrics
      } else if (
        action === 'enableLightweight' &&
        document.documentElement.dataset.playbackView !== 'extreme'
      ) {
        // A persisted mode flag does not guarantee that the lightweight window is open.
        await player.setExtremePlayback(true)
      }
    } catch {
      warning(t('settings.shortcutActionFailed'))
    }
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null
    if (event.defaultPrevented || event.isComposing) return
    const shortcut = normalizeShortcut(event)
    if (!shortcut) return
    const action = SHORTCUT_ACTIONS.find(
      (key) => ui.shortcutKeys[key]?.toLowerCase() === shortcut.toLowerCase()
    )
    if (
      action !== 'openSearch' &&
      target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
    )
      return
    if (action) {
      event.preventDefault()
      if (
        event.repeat &&
        ['like', 'dislike', 'toggleDesktopLyrics', 'enableLightweight', 'openSearch'].includes(
          action
        )
      )
        return
      void run(action)
    }
  }
  const registerGlobal = async (): Promise<void> => {
    if (!ui.useGlobalShortcutKeys) {
      await window.api.shortcuts.unregisterGlobal()
      return
    }
    const result = await window.api.shortcuts.registerGlobal({ ...ui.globalShortcutKeys })
    if (!result.success) {
      warning(result.error || t('settings.globalShortcutFailed', { shortcuts: '' }), 5000)
      return
    }
    const failed = result.data?.failed || []
    if (failed.length) {
      warning(
        t('settings.globalShortcutFailed', {
          shortcuts: failed.map((shortcut) => formatShortcut(shortcut)).join(', ')
        }),
        5000
      )
    }
  }
  let offGlobal: (() => void) | undefined
  onMounted(() => {
    window.addEventListener('keydown', onKeyDown)
    offGlobal = window.api.shortcuts.onAction((action) => {
      if (SHORTCUT_ACTIONS.includes(action as ShortcutAction)) void run(action as ShortcutAction)
    })
    void registerGlobal()
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    offGlobal?.()
    void window.api.shortcuts.unregisterGlobal()
  })
  watch(
    () => [ui.useGlobalShortcutKeys, { ...ui.globalShortcutKeys }],
    () => void registerGlobal(),
    { deep: true }
  )
}
