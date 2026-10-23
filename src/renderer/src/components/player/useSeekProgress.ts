import { computed, onBeforeUnmount, ref, watch } from 'vue'

interface SeekPlayer {
  currentFile: string | null
  positionMs: number
  durationMs: number
  seek: (positionMs: number) => Promise<boolean>
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useSeekProgress(player: SeekPlayer) {
  const preview = ref<number | null>(null)
  let sourceFile: string | null | undefined
  let revision = 0
  const displayPositionMs = computed(() => preview.value ?? player.positionMs)
  const displayPositionFormatted = computed(() => {
    const seconds = Math.max(0, Math.floor(displayPositionMs.value / 1000))
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
  })

  function targetPosition(event: Event): number | null {
    const value = Number((event.target as HTMLInputElement).value)
    if (!Number.isFinite(value) || player.durationMs <= 0) return null
    return Math.max(0, Math.min(player.durationMs, value))
  }
  function restoreInput(event?: Event): void {
    const input = event?.target
    if (!(input instanceof HTMLInputElement)) return
    const ratio =
      player.durationMs > 0 ? Math.max(0, Math.min(1, player.positionMs / player.durationMs)) : 0
    input.value = String(player.positionMs)
    input.style.setProperty('--ep-range-progress', String(ratio))
    input.style.setProperty('--ep-range-has-progress', ratio > 0 ? '1' : '0')
    input.style.setProperty('--fill', `${ratio * 100}%`)
  }
  function cancelSeek(event?: Event): void {
    revision++
    sourceFile = undefined
    preview.value = null
    restoreInput(event)
  }
  function previewSeek(event: Event): void {
    const target = targetPosition(event)
    if (target === null) return
    if (sourceFile === undefined) sourceFile = player.currentFile
    if (sourceFile !== player.currentFile) {
      restoreInput(event)
      return
    }
    revision++
    preview.value = target
  }
  async function commitSeek(event: Event): Promise<void> {
    if (preview.value === null && sourceFile === undefined) return
    const target = targetPosition(event)
    if (target === null || (sourceFile !== undefined && sourceFile !== player.currentFile)) {
      cancelSeek(event)
      return
    }
    const request = ++revision
    sourceFile = undefined
    preview.value = target
    try {
      await player.seek(target)
    } catch (error) {
      console.warn('[player] Failed to seek:', error)
    } finally {
      if (request === revision) cancelSeek()
    }
  }
  watch(
    () => player.currentFile,
    () => {
      // Retain the gesture's source until release so an old drag cannot seek
      // the next song. Only the visual preview is discarded on a track change.
      revision++
      preview.value = null
    },
    { flush: 'sync' }
  )
  onBeforeUnmount(cancelSeek)
  return { displayPositionMs, displayPositionFormatted, previewSeek, commitSeek, cancelSeek }
}
