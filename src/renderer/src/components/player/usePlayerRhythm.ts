import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { usePlayerStore } from '@/stores/player/playerStore'
import type { useUIStore } from '@/stores/ui/uiStore'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function usePlayerRhythm(
  player: ReturnType<typeof usePlayerStore>,
  ui: ReturnType<typeof useUIStore>
) {
  const rhythmAmount = ref(0)
  const isPanelVisible = ref(!document.hidden && document.hasFocus())
  let lastVisualUpdateAt = 0

  function syncPanelVisibility(): void {
    isPanelVisible.value = !document.hidden && document.hasFocus()
  }

  const targetRhythmAmount = computed(() => {
    if (
      !player.isPlaying ||
      !isPanelVisible.value ||
      !player.rhythmVisualConfig.enabled ||
      player.rhythmVisualConfig.reducedMotion ||
      ui.reduceMotion
    )
      return 0
    const { rms, lowEnergy, onsetStrength } = player.audioAnalysis
    const energy = Math.max(0, Math.min(1, Math.max(rms, lowEnergy, onsetStrength)))
    return Math.min(1, energy * player.rhythmVisualConfig.intensity * 1.8)
  })
  watch(
    targetRhythmAmount,
    (target) => {
      if (target === 0) {
        rhythmAmount.value = 0
        return
      }
      const now = performance.now()
      if (now - lastVisualUpdateAt < 1000 / 30) return
      lastVisualUpdateAt = now
      rhythmAmount.value += (target - rhythmAmount.value) * 0.72
    },
    { immediate: true }
  )
  onMounted(() => {
    document.addEventListener('visibilitychange', syncPanelVisibility)
    window.addEventListener('focus', syncPanelVisibility)
    window.addEventListener('blur', syncPanelVisibility)
  })
  onBeforeUnmount(() => {
    document.removeEventListener('visibilitychange', syncPanelVisibility)
    window.removeEventListener('focus', syncPanelVisibility)
    window.removeEventListener('blur', syncPanelVisibility)
  })
  return { rhythmAmount, isPanelVisible }
}
