import { nextTick } from 'vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useStatisticsStore } from '@/stores/statistics/statisticsStore'
import { flushPlayerDataStorage } from '@/stores/persistence'

export async function restoreDefaultPreferences(): Promise<void> {
  const ui = useUIStore()
  const player = usePlayerStore()
  const statistics = useStatisticsStore()
  if (statistics.busy || player.playbackModeChanging) throw new Error('Settings are busy')
  if (ui.extremePlayback) {
    await player.setExtremePlayback(false, false)
    if (ui.extremePlayback) throw new Error('Unable to leave playback-only mode')
  }
  if (ui.nativeMaterialEnabled) {
    await ui.setNativeWindowMaterial('none')
    if (ui.nativeMaterialEnabled) throw new Error('Unable to disable window material')
  }
  const audio = await player.resetAudioProcessingSettings()
  if (!audio.success) throw new Error(audio.error || 'Unable to reset audio settings')
  await player.setSmartShuffleEnabled(false)
  if (player.smartShuffleEnabled) throw new Error('Unable to reset smart shuffle')
  player.rhythmVisualConfig = { enabled: true, intensity: 0.65, reducedMotion: false }
  await player.saveRhythmVisualConfig()
  await statistics.setEnabled(true)
  const results = await Promise.all([
    window.api.system.setCloseToTray(false),
    window.api.system.setAutoStart(false),
    window.api.log.setLevel('info'),
    window.api.database.command('setSetting', { key: 'remote.cache-limit-gb', value: 2 })
  ])
  if (results.some((result) => !result.success)) throw new Error('Unable to reset system settings')
  ui.resetPreferences()
  await nextTick()
  flushPlayerDataStorage()
}
