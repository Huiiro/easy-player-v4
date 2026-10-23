import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import type { EqBand } from '@/types/audio'
import type { usePlayerStore } from '@/stores/player/playerStore'
import type { useEqPresetStore } from '@/stores/player/eqPresetStore'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useEqEditor(
  player: ReturnType<typeof usePlayerStore>,
  eqPresets: ReturnType<typeof useEqPresetStore>,
  selected: Readonly<Ref<string>>
) {
  let eqCommitTimer: ReturnType<typeof setTimeout> | undefined
  const selectedEqIndex = ref(0)
  type EqHistoryEntry = {
    before: EqBand[]
    after: EqBand[]
    kind: 'edit' | 'bandUndo'
    bandIndex?: number
  }
  const eqHistory = ref<EqHistoryEntry[]>([])
  const eqFuture = ref<EqHistoryEntry[]>([])
  const eqComparison = ref<{ index: number; current: EqBand } | null>(null)
  let eqPendingSnapshot: EqBand[] | null = null

  function bandsMatch(left: EqBand[], right: EqBand[]): boolean {
    return (
      left.length === right.length &&
      left.every((band, index) => {
        const other = right[index]
        return (
          other &&
          band.enabled === other.enabled &&
          Math.abs(band.frequencyHz - other.frequencyHz) < 0.001 &&
          Math.abs(band.gainDb - other.gainDb) < 0.001 &&
          Math.abs(band.q - other.q) < 0.001
        )
      })
    )
  }
  function copyEqBands(bands = player.eqBands): EqBand[] {
    return bands.map((band) => ({ ...band }))
  }
  function sameEqBand(left: EqBand | undefined, right: EqBand | undefined): boolean {
    return !!left && !!right && bandsMatch([left], [right])
  }
  function applyEq(): void {
    if (eqCommitTimer) clearTimeout(eqCommitTimer)
    eqCommitTimer = undefined
    void player.commitEqBands().then(() => player.refreshAudioChain())
  }
  function stopEqComparison(): void {
    const comparison = eqComparison.value
    if (!comparison) return
    player.eqBands[comparison.index] = { ...comparison.current }
    eqComparison.value = null
    applyEq()
  }
  function beginEqEdit(): void {
    stopEqComparison()
    if (!eqPendingSnapshot) eqPendingSnapshot = copyEqBands()
  }
  function recordEqEdit(): void {
    const before = eqPendingSnapshot
    eqPendingSnapshot = null
    if (!before || bandsMatch(before, player.eqBands)) return
    eqHistory.value = [
      ...eqHistory.value.slice(-79),
      { before, after: copyEqBands(), kind: 'edit' }
    ]
    eqFuture.value = []
  }
  function commitEq(): void {
    recordEqEdit()
    applyEq()
  }
  function scheduleEq(): void {
    if (eqCommitTimer) clearTimeout(eqCommitTimer)
    eqCommitTimer = setTimeout(applyEq, 100)
  }
  function previousEqBand(index: number): EqBand | null {
    let undoneEdits = 0
    for (let cursor = eqHistory.value.length - 1; cursor >= 0; cursor--) {
      const entry = eqHistory.value[cursor]
      if (entry.kind === 'bandUndo' && entry.bandIndex === index) {
        undoneEdits++
      } else if (entry.kind === 'edit' && !sameEqBand(entry.before[index], entry.after[index])) {
        if (undoneEdits > 0) undoneEdits--
        else return { ...entry.before[index] }
      }
    }
    return null
  }
  const previousSelectedEqBand = computed(() => previousEqBand(selectedEqIndex.value))
  function undoEq(): void {
    stopEqComparison()
    if (eqPendingSnapshot) commitEq()
    const entry = eqHistory.value.at(-1)
    if (!entry) return
    eqHistory.value = eqHistory.value.slice(0, -1)
    eqFuture.value = [...eqFuture.value, entry]
    player.eqBands = copyEqBands(entry.before)
    applyEq()
  }
  function redoEq(): void {
    stopEqComparison()
    if (eqPendingSnapshot) commitEq()
    const entry = eqFuture.value.at(-1)
    if (!entry) return
    eqFuture.value = eqFuture.value.slice(0, -1)
    eqHistory.value = [...eqHistory.value, entry]
    player.eqBands = copyEqBands(entry.after)
    applyEq()
  }
  function undoSelectedEqBand(): void {
    stopEqComparison()
    if (eqPendingSnapshot) commitEq()
    const index = selectedEqIndex.value
    const previous = previousEqBand(index)
    if (!previous || sameEqBand(previous, player.eqBands[index])) return
    const before = copyEqBands()
    player.eqBands[index] = previous
    eqHistory.value = [
      ...eqHistory.value.slice(-79),
      { before, after: copyEqBands(), kind: 'bandUndo', bandIndex: index }
    ]
    eqFuture.value = []
    applyEq()
  }
  function toggleEqComparison(): void {
    if (eqComparison.value) {
      stopEqComparison()
      return
    }
    if (eqPendingSnapshot) commitEq()
    const index = selectedEqIndex.value
    const previous = previousEqBand(index)
    const current = player.eqBands[index]
    if (!previous || !current || sameEqBand(previous, current)) return
    eqComparison.value = { index, current: { ...current } }
    player.eqBands[index] = previous
    applyEq()
  }
  watch(selectedEqIndex, () => stopEqComparison())
  watch(selected, (id) => {
    if (id === 'eq') return
    stopEqComparison()
    if (eqPendingSnapshot) commitEq()
  })
  const selectedEqPreset = computed(
    () =>
      eqPresets.allPresets.find((preset) => bandsMatch(player.eqBands, preset.bands))?.id ??
      'modified'
  )
  function selectEqPreset(value: string | number | (string | number)[]): void {
    if (typeof value !== 'string') return
    const preset = eqPresets.allPresets.find((item) => item.id === value)
    if (!preset) return
    beginEqEdit()
    player.eqBands = copyEqBands(preset.bands)
    commitEq()
  }
  const selectedEqBand = computed(() => player.eqBands[selectedEqIndex.value])
  function eqFrequencyLimits(index: number): { min: number; max: number } {
    return {
      min: Math.max(20, (player.eqBands[index - 1]?.frequencyHz ?? 20 / 1.02) * 1.02),
      max: Math.min(20000, (player.eqBands[index + 1]?.frequencyHz ?? 20000 * 1.02) / 1.02)
    }
  }
  const selectedEqFrequencyLimits = computed(() => eqFrequencyLimits(selectedEqIndex.value))
  function updateEqBand(index: number, update: Partial<EqBand>): void {
    const band = player.eqBands[index]
    if (!band) return
    beginEqEdit()
    if (update.frequencyHz !== undefined) {
      const { min, max } = eqFrequencyLimits(index)
      band.frequencyHz = Math.min(max, Math.max(min, update.frequencyHz))
    }
    if (update.gainDb !== undefined) {
      band.gainDb = Math.max(-12, Math.min(12, update.gainDb))
      band.enabled = Math.abs(band.gainDb) >= 0.0001
    }
    if (update.q !== undefined) band.q = Math.max(0.1, Math.min(24, update.q))
    if (update.enabled !== undefined) band.enabled = update.enabled
    scheduleEq()
  }
  function resetEq(): void {
    beginEqEdit()
    player.eqBands.forEach((band) => {
      band.enabled = false
      band.gainDb = 0
      band.q = 1
    })
    commitEq()
  }
  function toggleEqBand(index: number): void {
    const band = player.eqBands[index]
    if (!band) return
    updateEqBand(index, { enabled: !band.enabled })
    commitEq()
  }
  function cancelPendingCommit(): void {
    if (eqCommitTimer) clearTimeout(eqCommitTimer)
    eqCommitTimer = undefined
  }
  function clearHistory(): void {
    eqPendingSnapshot = null
    eqHistory.value = []
    eqFuture.value = []
  }
  onBeforeUnmount(() => {
    stopEqComparison()
    if (eqPendingSnapshot) commitEq()
    else if (eqCommitTimer) applyEq()
  })
  return {
    selectedEqIndex,
    eqHistory,
    eqFuture,
    eqComparison,
    previousSelectedEqBand,
    selectedEqPreset,
    selectedEqBand,
    selectedEqFrequencyLimits,
    beginEqEdit,
    recordEqEdit,
    commitEq,
    stopEqComparison,
    undoEq,
    redoEq,
    undoSelectedEqBand,
    toggleEqComparison,
    selectEqPreset,
    updateEqBand,
    resetEq,
    toggleEqBand,
    cancelPendingCommit,
    clearHistory
  }
}
