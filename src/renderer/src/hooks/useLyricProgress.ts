import { ref, watch, onMounted, onUnmounted } from 'vue'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useLyricProgress(playStore, lyrics, currentIndex) {
  const progress = ref(0)

  // 平滑时间 s ms
  let baseAudioTime = 0
  let baseSystemTime = 0

  // 同步音频时间（低频）
  watch(
    () => playStore.currentTime,
    (t) => {
      baseAudioTime = t
      baseSystemTime = performance.now()
    },
    { immediate: true }
  )

  function getSmoothTime(): number {
    if (!playStore.isPlaying) {
      // 播放器暂停时，保持进度不变
      return baseAudioTime
    }
    const now = performance.now()
    const delta = (now - baseSystemTime) / 1000
    return baseAudioTime + delta
  }

  function getProgressByTime(current: number, index: number): number {
    const line = lyrics.value[index]
    if (!line) return 0

    const start = line.time
    const next = lyrics.value[index + 1]?.time ?? start + 3

    const duration = next - start
    if (duration <= 0) return 0

    let p = (current - start) / duration

    // clamp
    p = Math.min(Math.max(p, 0), 1)
    return p * 100
  }

  function update(): void {
    const smoothTime = getSmoothTime() // ms
    progress.value = getProgressByTime(smoothTime, currentIndex.value)
  }

  let rafId: number

  function loop(): void {
    update()
    rafId = requestAnimationFrame(loop)
  }

  onMounted(() => {
    loop()
  })

  onUnmounted(() => {
    cancelAnimationFrame(rafId)
  })

  return {
    progress
  }
}
