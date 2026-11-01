import { computed, ref, watch } from 'vue'
import type { usePlayerStore } from '@/stores/player/playerStore'
import type { useUIStore } from '@/stores/ui/uiStore'
import { useAnimationActivity } from '@/hooks/useAnimationActivity'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function usePlayerRhythm(
  player: ReturnType<typeof usePlayerStore>,
  ui: ReturnType<typeof useUIStore>
) {
  const rhythmAmount = ref(0)
  const isPanelVisible = useAnimationActivity(() => ui.pauseAnimationsOnBlur !== false)
  let lastVisualUpdateAt = 0

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
  return { rhythmAmount, isPanelVisible }
}
