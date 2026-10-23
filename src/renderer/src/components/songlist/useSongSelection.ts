import { computed, ref, type Ref } from 'vue'
import type { LibrarySong } from '@/types/library'

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function useSongSelection(filteredSongs: Readonly<Ref<LibrarySong[]>>) {
  const selectionMode = ref(false)
  const selectedIds = ref<Set<number>>(new Set())
  const allSelected = computed(
    () =>
      filteredSongs.value.length > 0 &&
      filteredSongs.value.every((song) => selectedIds.value.has(song.id))
  )

  const toggleSelection = (): void => {
    selectionMode.value = !selectionMode.value
    if (!selectionMode.value) selectedIds.value = new Set()
  }
  const toggleSelect = (id: number): void => {
    const next = new Set(selectedIds.value)
    next.has(id) ? next.delete(id) : next.add(id)
    selectedIds.value = next
  }
  const toggleAll = (): void => {
    selectedIds.value = allSelected.value
      ? new Set()
      : new Set(filteredSongs.value.map((song) => song.id))
  }
  const selectNewest = (): void => {
    selectedIds.value = new Set(
      filteredSongs.value.filter((song) => song.isNewest).map((song) => song.id)
    )
  }
  return {
    selectionMode,
    selectedIds,
    allSelected,
    toggleSelection,
    toggleSelect,
    toggleAll,
    selectNewest
  }
}
