import { onBeforeUnmount, onMounted, watch } from 'vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
import { useMessage } from '@/components/ui/useMessage'
import { formatShortcut, normalizeShortcut } from '@/utils/shortcut'
import { useI18n } from 'vue-i18n'

type ShortcutAction = 'previous' | 'toggle' | 'next' | 'volumeUp' | 'volumeDown'
const actions: ShortcutAction[] = ['previous', 'toggle', 'next', 'volumeUp', 'volumeDown']

export function useShortcuts(): void {
  const ui = useUIStore()
  const player = usePlayerStore()
  const { warning } = useMessage()
  const { t } = useI18n()
  const run = (action: ShortcutAction): void => {
    if (action === 'previous') void player.playPrevious()
    else if (action === 'next') void player.playNext()
    else if (action === 'toggle') {
      if (player.isPlaying) void player.pause()
      else void player.play()
    } else
      void player.setVolume(
        Math.max(0, Math.min(1, player.volume + (action === 'volumeUp' ? 0.05 : -0.05)))
      )
  }
  const onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null
    if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
    const shortcut = normalizeShortcut(event)
    const action = actions.find(
      (key) => ui.shortcutKeys[key].toLowerCase() === shortcut.toLowerCase()
    )
    if (action) {
      event.preventDefault()
      run(action)
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
      if (actions.includes(action as ShortcutAction)) run(action as ShortcutAction)
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
