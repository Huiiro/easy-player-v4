<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import eventBus from '@/utils/eventBus'
import SongListHeader from './SongListHeader.vue'
import SongListItem from './SongListItem.vue'
import TagManagerDialog from '@/components/tag/TagManagerDialog.vue'
import SongTagDialog from '@/components/tag/SongTagDialog.vue'
import BatchTagDialog from '@/components/tag/BatchTagDialog.vue'
import type { LibrarySong, PagedLibrarySongs } from '@/types/library'
import { useMessage } from '@/components/ui/useMessage'

type SongListSource =
  | { type: 'songs' | 'local' | 'remote' | 'history' }
  | { type: 'playlist'; id: number }
  | { type: 'album'; album: string; artist?: string }
  | { type: 'artist'; artist: string }
  | { type: 'genre'; genre: string }
type SortField = 'title' | 'artist' | 'album' | 'duration'
interface PlaylistTarget {
  id: number
  name: string
}

const props = withDefaults(defineProps<{ source?: SongListSource }>(), {
  source: () => ({ type: 'songs' })
})

const player = usePlayerStore()
const { t } = useI18n()
const { success, error: showError } = useMessage()
const songs = ref<LibrarySong[]>([])
const loading = ref(false)
const keyword = ref('')
const sortBy = ref<SortField>('title')
const sortOrder = ref<'asc' | 'desc'>('asc')
const selectionMode = ref(false)
const selectedIds = ref<Set<number>>(new Set())
const activeMenuSong = ref<LibrarySong | null>(null)
const menuPosition = ref({ left: '0px', top: '0px' })
const playlistPickerOpen = ref(false)
const playlistTargets = ref<PlaylistTarget[]>([])
const pickerSongIds = ref<number[]>([])
const playlistPickerLoading = ref(false)
const playlistPickerError = ref('')
const tagManagerOpen = ref(false)
const songTagDialogOpen = ref(false)
const batchTagDialogOpen = ref(false)
const selectedTagIds = ref<number[]>([])
const tagSongId = ref<number | null>(null)
const canFilterByTags = computed(() =>
  ['songs', 'local', 'remote', 'playlist'].includes(props.source.type)
)

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
      ? await window.api.database.command('queryPlaylistSongs', {
          playlistId: source.id,
          query: { size: 500, tags: [...selectedTagIds.value] }
        })
      : source.type === 'album'
        ? await window.api.database.command('getSongsByAlbum', {
            album: source.album,
            artist: source.artist
          })
        : source.type === 'artist'
          ? await window.api.database.command('getSongsByArtist', { artist: source.artist })
          : source.type === 'genre'
            ? await window.api.database.command('getSongsByGenre', { genre: source.genre })
            : source.type === 'history'
              ? await window.api.database.command('queryRecentPlayedSongs', { size: 500 })
              : await window.api.database.command('querySongs', {
                  size: 500,
                  tags: [...selectedTagIds.value],
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
const openMenu = (song: LibrarySong, position: { left: string; top: string }): void => {
  activeMenuSong.value = activeMenuSong.value?.id === song.id ? null : song
  menuPosition.value = position
}
const closeMenu = (): void => {
  activeMenuSong.value = null
}
const playSong = async (song: LibrarySong): Promise<void> => {
  if (song.songStatus === 0) return
  await player.playCollection(filteredSongs.value, song.id)
}
const playSelected = (): void => {
  const selectedSongs = filteredSongs.value.filter((song) => selectedIds.value.has(song.id))
  if (selectedSongs[0]) void player.playCollection(selectedSongs, selectedSongs[0].id)
}
const addActiveMenuSongToQueue = (): void => {
  if (activeMenuSong.value) player.addToQueue([activeMenuSong.value], true)
  closeMenu()
}
const playActiveMenuSong = (): void => {
  if (activeMenuSong.value) void playSong(activeMenuSong.value)
  closeMenu()
}

async function openPlaylistPicker(songIds: number[]): Promise<void> {
  pickerSongIds.value = songIds
  playlistPickerOpen.value = true
  playlistPickerLoading.value = true
  playlistPickerError.value = ''
  try {
    const response = await window.api.database.command('listPlaylists')
    if (!response.success) {
      playlistPickerError.value = response.error || '无法读取歌单'
      showError(playlistPickerError.value)
      return
    }
    playlistTargets.value = response.data as PlaylistTarget[]
  } catch (error) {
    playlistPickerError.value = error instanceof Error ? error.message : '无法读取歌单'
    showError(playlistPickerError.value)
  } finally {
    playlistPickerLoading.value = false
  }
}
async function addToPlaylist(playlistId: number): Promise<void> {
  playlistPickerError.value = ''
  try {
    const response = await window.api.database.command('addSongsToPlaylist', {
      playlistId,
      // Vue wraps ref arrays in a Proxy; Electron IPC requires cloneable plain data.
      songIds: [...pickerSongIds.value]
    })
    if (!response.success) {
      playlistPickerError.value = response.error || '添加歌曲失败'
      showError(playlistPickerError.value)
      return
    }
    eventBus.emit('playlistsChanged')
    success('已添加到歌单')
    playlistPickerOpen.value = false
  } catch (error) {
    playlistPickerError.value = error instanceof Error ? error.message : '添加歌曲失败'
    showError(playlistPickerError.value)
  }
}
async function removeSongsFromCurrentPlaylist(songIds: number[]): Promise<void> {
  if (props.source.type !== 'playlist' || !songIds.length) return
  const response = await window.api.database.command('removeSongsFromPlaylist', {
    playlistId: props.source.id,
    songIds: [...songIds]
  })
  if (response.success) {
    selectedIds.value = new Set()
    await load()
    eventBus.emit('playlistsChanged')
    success('已从歌单移除歌曲')
  }
}
async function addActiveMenuSongToPlaylist(): Promise<void> {
  const songId = activeMenuSong.value?.id
  closeMenu()
  if (songId) await openPlaylistPicker([songId])
}
function addSelectedToPlaylist(): void {
  void openPlaylistPicker([...selectedIds.value])
}
function removeActiveMenuSong(): void {
  if (activeMenuSong.value) void removeSongsFromCurrentPlaylist([activeMenuSong.value.id])
  closeMenu()
}
function openSongTags(): void {
  if (!activeMenuSong.value) return
  tagSongId.value = activeMenuSong.value.id
  songTagDialogOpen.value = true
  closeMenu()
}
function openBatchTags(): void {
  if (!selectedIds.value.size) return
  batchTagDialogOpen.value = true
}
const onScanFinished = (): void => void load()
const onTagsChanged = (): void => void load()
onMounted(() => {
  void load()
  eventBus.on('scanFinished', onScanFinished)
  eventBus.on('tagsChanged', onTagsChanged)
  window.addEventListener('click', closeMenu)
})
onBeforeUnmount(() => {
  eventBus.off('scanFinished', onScanFinished)
  eventBus.off('tagsChanged', onTagsChanged)
  window.removeEventListener('click', closeMenu)
})
watch(
  () => props.source,
  () => void load(),
  { deep: true }
)
watch(selectedTagIds, () => canFilterByTags.value && void load())
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
      @batch-add-to-playlist="addSelectedToPlaylist"
      @batch-edit-tags="openBatchTags"
      @batch-delete="removeSongsFromCurrentPlaylist([...selectedIds])"
    />
    <div
      v-if="canFilterByTags"
      class="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] px-5 py-2"
    >
      <button
        class="btn-hover rounded-lg border border-[var(--color-border)] px-3 py-1 text-sm"
        @click="tagManagerOpen = true"
      >
        {{ t('tags.manageAndFilter') }}
      </button>
      <span
        v-if="selectedTagIds.length"
        class="rounded-full border border-primary px-2 py-0.5 text-xs text-primary"
        >{{ t('tags.activeFilterCount', { count: selectedTagIds.length }) }}</span
      >
      <button
        v-if="selectedTagIds.length"
        class="btn-hover text-xs text-[var(--color-text-l)]"
        @click="selectedTagIds = []"
      >
        {{ t('tags.clearFilter') }}
      </button>
    </div>
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
        :current="player.currentQueueSong?.id === item.id"
        @play="playSong"
        @toggle-select="toggleSelect"
        @request-menu="openMenu"
      />
    </RecycleScroller>
    <Teleport to="body">
      <div
        v-if="activeMenuSong"
        class="fixed z-[9999] w-40 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-1 text-left shadow-xl"
        :style="menuPosition"
        @click.stop
        @dblclick.stop
      >
        <button
          class="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
          @click="playActiveMenuSong"
        >
          {{ t('songList.play') }}
        </button>
        <button
          class="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
          @click="addActiveMenuSongToQueue"
        >
          {{ t('songList.addToQueue') }}
        </button>
        <button
          class="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
          @click="addActiveMenuSongToPlaylist"
        >
          {{ t('songList.addToPlaylist') }}
        </button>
        <button
          class="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
          @click="openSongTags"
        >
          {{ t('songList.editTags') }}
        </button>
        <button
          class="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
          @click="closeMenu"
        >
          {{ t('songList.details') }}
        </button>
        <button
          class="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
          @click="closeMenu"
        >
          {{ t('songList.openFolder') }}
        </button>
        <button
          v-if="source.type === 'playlist'"
          class="block w-full rounded-md px-3 py-1.5 text-left text-sm text-red-400 hover:bg-[var(--color-hover)]"
          @click="removeActiveMenuSong"
        >
          从歌单移除
        </button>
      </div>
    </Teleport>
    <TagManagerDialog v-model="tagManagerOpen" v-model:selected-ids="selectedTagIds" />
    <SongTagDialog v-model="songTagDialogOpen" :song-id="tagSongId" @changed="load" />
    <BatchTagDialog v-model="batchTagDialogOpen" :song-ids="[...selectedIds]" @changed="load" />
    <Teleport to="body">
      <div
        v-if="playlistPickerOpen"
        class="fixed inset-0 z-[10000] grid place-items-center bg-black/40 p-4"
        @click.self="playlistPickerOpen = false"
      >
        <section
          class="w-full max-w-sm rounded-2xl border border-[var(--color-border)] bg-[var(--color-bg)] p-4 shadow-2xl"
        >
          <div class="mb-3 flex items-center justify-between">
            <h2 class="font-semibold">添加到歌单</h2>
            <button class="btn-hover" @click="playlistPickerOpen = false">关闭</button>
          </div>
          <p
            v-if="playlistPickerLoading"
            class="py-5 text-center text-sm text-[var(--color-text-l)]"
          >
            正在加载歌单…
          </p>
          <p
            v-else-if="!playlistTargets.length"
            class="py-5 text-center text-sm text-[var(--color-text-l)]"
          >
            还没有歌单，请先在侧边栏新建。
          </p>
          <p v-if="playlistPickerError" class="mb-2 text-sm text-red-400">
            {{ playlistPickerError }}
          </p>
          <button
            v-for="playlist in playlistTargets"
            :key="playlist.id"
            class="block w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-[var(--color-hover)]"
            :disabled="playlistPickerLoading"
            @click="addToPlaylist(playlist.id)"
          >
            {{ playlist.name }}
          </button>
        </section>
      </div>
    </Teleport>
  </section>
</template>
