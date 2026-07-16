<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import eventBus from '@/utils/eventBus'
import SongListHeader from './SongListHeader.vue'
import SongListItem from './SongListItem.vue'
import type { LibrarySong, PagedLibrarySongs } from '@/types/library'

type SongListSource =
  | { type: 'songs' | 'local' | 'remote' | 'history' }
  | { type: 'playlist'; id: number }
  | { type: 'album'; album: string; artist?: string }
  | { type: 'artist'; artist: string }
  | { type: 'genre'; genre: string }
type SortField = 'title' | 'artist' | 'album' | 'duration'

const props = withDefaults(defineProps<{ source?: SongListSource }>(), {
  source: () => ({ type: 'songs' })
})

const player = usePlayerStore()
const songs = ref<LibrarySong[]>([])
const loading = ref(false)
const keyword = ref('')
const sortBy = ref<SortField>('title')
const sortOrder = ref<'asc' | 'desc'>('asc')
const selectionMode = ref(false)
const selectedIds = ref<Set<number>>(new Set())
const activeMenuId = ref<number | null>(null)

const filteredSongs = computed(() => {
  const search = keyword.value.trim().toLocaleLowerCase()
  const multiplier = sortOrder.value === 'asc' ? 1 : -1
  return songs.value
    .filter(
      (song) =>
        !search ||
        [song.title, song.artist, song.album].some((value) =>
          value?.toLocaleLowerCase().includes(search)
        )
    )
    .sort(
      (left, right) =>
        String(left[sortBy.value] ?? '').localeCompare(
          String(right[sortBy.value] ?? ''),
          undefined,
          { numeric: true }
        ) * multiplier
    )
})
const allSelected = computed(
  () =>
    filteredSongs.value.length > 0 &&
    filteredSongs.value.every((song) => selectedIds.value.has(song.id))
)

const getSongs = async (): Promise<LibrarySong[]> => {
  const { source } = props
  const response =
    source.type === 'playlist'
      ? await window.api.database.command('queryPlaylistSongs', { playlistId: source.id })
      : source.type === 'album'
        ? await window.api.database.command('getSongsByAlbum', source)
        : source.type === 'artist'
          ? await window.api.database.command('getSongsByArtist', source)
          : source.type === 'genre'
            ? await window.api.database.command('getSongsByGenre', source)
            : source.type === 'history'
              ? await window.api.database.command('queryRecentPlayedSongs', { size: 500 })
              : await window.api.database.command('querySongs', {
                  size: 500,
                  source:
                    source.type === 'local' ? 'local' : source.type === 'remote' ? 'remote' : 'all'
                })
  if (!response.success) return []
  const data = response.data as LibrarySong[] | PagedLibrarySongs
  return Array.isArray(data) ? data : data.data
}

const load = async (): Promise<void> => {
  loading.value = true
  try {
    songs.value = await getSongs()
  } finally {
    loading.value = false
  }
}
const toggleSort = (field: SortField): void => {
  if (sortBy.value === field) sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  else {
    sortBy.value = field
    sortOrder.value = 'asc'
  }
}
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
const toggleMenu = (id: number): void => {
  activeMenuId.value = activeMenuId.value === id ? null : id
}
const closeMenu = (): void => {
  activeMenuId.value = null
}
const playSong = async (song: LibrarySong): Promise<void> => {
  if (song.songStatus === 0) return
  if (await player.openFile(song.audio)) await player.play()
}
const playSelected = (): void => {
  const song = filteredSongs.value.find((item) => selectedIds.value.has(item.id))
  if (song) void playSong(song)
}

// TODO: Connect these actions to the migrated dialogs/services when they are available.
const todoAction = (): void => undefined
const onScanFinished = (): void => void load()
onMounted(() => {
  void load()
  eventBus.on('scanFinished', onScanFinished)
  window.addEventListener('click', closeMenu)
})
onBeforeUnmount(() => {
  eventBus.off('scanFinished', onScanFinished)
  window.removeEventListener('click', closeMenu)
})
watch(
  () => props.source,
  () => void load(),
  { deep: true }
)
</script>

<template>
  <section class="flex h-full min-h-0 flex-col text-[var(--color-text)]">
    <SongListHeader
      v-model:keyword="keyword"
      :total="songs.length"
      :sort-by="sortBy"
      :sort-order="sortOrder"
      :selection-mode="selectionMode"
      :selected-count="selectedIds.size"
      :all-selected="allSelected"
      @refresh="load"
      @sort="toggleSort"
      @toggle-selection="toggleSelection"
      @toggle-all="toggleAll"
      @batch-play="playSelected"
      @batch-add-to-playlist="todoAction"
      @batch-edit-tags="todoAction"
      @batch-delete="todoAction"
    />
    <div v-if="loading" class="p-6 text-sm text-[var(--color-text-l)]">
      {{ $t('songList.loading') }}
    </div>
    <div v-else-if="filteredSongs.length === 0" class="p-6 text-sm text-[var(--color-text-l)]">
      {{ $t('songList.empty') }}
    </div>
    <RecycleScroller
      v-else
      v-slot="{ item, index }"
      class="custom-scrollbar min-h-0 flex-1 overflow-y-auto"
      :items="filteredSongs"
      :item-size="64"
      key-field="id"
    >
      <SongListItem
        :song="item"
        :index="index"
        :selection-mode="selectionMode"
        :selected="selectedIds.has(item.id)"
        :active-menu-id="activeMenuId"
        @play="playSong"
        @toggle-select="toggleSelect"
        @add-to-queue="todoAction"
        @add-to-playlist="todoAction"
        @edit-tags="todoAction"
        @show-details="todoAction"
        @open-folder="todoAction"
        @delete="todoAction"
        @toggle-menu="toggleMenu"
        @close-menu="closeMenu"
      />
    </RecycleScroller>
  </section>
</template>
