<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
import eventBus from '@/utils/eventBus'
import SongListHeader from './SongListHeader.vue'
import SongListItem from './SongListItem.vue'
import TagManagerDialog from '@/components/tag/TagManagerDialog.vue'
import SongTagDialog from '@/components/tag/SongTagDialog.vue'
import BatchTagDialog from '@/components/tag/BatchTagDialog.vue'
import type { LibrarySong, PagedLibrarySongs, SongDetails } from '@/types/library'
import { useMessage } from '@/components/ui/useMessage'
import BaseDialog from '@/components/ui/BaseDialog.vue'

type SongListSource =
  | { type: 'songs' | 'local' | 'remote' | 'history' }
  | { type: 'playlist'; id: number }
  | { type: 'folder'; id: number }
  | { type: 'album'; album: string; artist?: string }
  | { type: 'artist'; artist: string }
  | { type: 'genre'; genre: string }
type SortField = 'title' | 'artist' | 'album' | 'duration'
interface PlaylistTarget {
  id: number
  name: string
}
interface MusicSourceOption {
  id: number
  name: string
}

const props = withDefaults(defineProps<{ source?: SongListSource }>(), {
  source: () => ({ type: 'songs' })
})

const player = usePlayerStore()
const uiStore = useUIStore()
const { t } = useI18n()
const { success, warning, error: showError } = useMessage()
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
const songsPendingDelete = ref<LibrarySong[]>([])
const deleteLocalFile = ref(false)
const songDetailsOpen = ref(false)
const songDetailsLoading = ref(false)
const songDetails = ref<SongDetails | null>(null)
const remoteSources = ref<MusicSourceOption[]>([])
const canFilterByTags = computed(() =>
  ['songs', 'local', 'remote', 'playlist', 'folder'].includes(props.source.type)
)
const sourceOptions = computed(() => [
  { label: t('songList.sourceAll'), value: 'all' },
  { label: t('songList.sourceLocal'), value: 'local' },
  { label: t('songList.sourceRemote'), value: 'remote' },
  ...remoteSources.value.map((source) => ({
    label: `${t('songList.sourceRemote')} · ${source.name}`,
    value: `remote:${source.id}`
  }))
])
const canFilterBySource = computed(() => props.source.type === 'songs')
const sourceFilter = computed({
  get: () =>
    uiStore.musicSource === 'remote' && uiStore.musicSourceId > 0
      ? `remote:${uiStore.musicSourceId}`
      : uiStore.musicSource,
  set: (value: string) => {
    if (value.startsWith('remote:')) {
      uiStore.musicSource = 'remote'
      uiStore.musicSourceId = Number(value.slice('remote:'.length)) || 0
      return
    }
    uiStore.musicSource = value === 'local' || value === 'remote' ? value : 'all'
    uiStore.musicSourceId = 0
  }
})

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
      : source.type === 'folder'
        ? await window.api.database.command('getLocalFolderSongs', { folderId: source.id })
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
                      source.type === 'local'
                        ? 'local'
                        : source.type === 'remote'
                          ? 'remote'
                          : sourceFilter.value === 'local'
                            ? 'local'
                            : sourceFilter.value.startsWith('remote:') ||
                                sourceFilter.value === 'remote'
                              ? 'remote'
                              : 'all',
                    sourceId: sourceFilter.value.startsWith('remote:')
                      ? Number(sourceFilter.value.slice('remote:'.length))
                      : undefined
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
async function refreshSongs(): Promise<void> {
  await load()
  success(t('songList.refreshed'))
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
  // Search is an ad-hoc view, not a new playlist. Insert the selected result
  // into the current queue (or reuse it when already queued) and play it.
  if (keyword.value.trim()) {
    let queueIndex = player.queue.findIndex((queuedSong) => queuedSong.id === song.id)
    if (queueIndex < 0) {
      player.addToQueue([song], true)
      queueIndex = player.queue.findIndex((queuedSong) => queuedSong.id === song.id)
    }
    if (queueIndex >= 0) await player.playQueueItem(queueIndex)
    return
  }
  await player.playCollection(filteredSongs.value, song.id)
}
const playSelected = (): void => {
  const selectedSongs = filteredSongs.value.filter((song) => selectedIds.value.has(song.id))
  if (selectedSongs[0]) void player.playCollection(selectedSongs, selectedSongs[0].id)
}
const addActiveMenuSongToQueue = (): void => {
  const song = activeMenuSong.value
  if (song) {
    if (player.queue.some((queuedSong) => queuedSong.id === song.id)) {
      warning(t('songList.alreadyInQueue'))
    } else {
      player.addToQueue([song], true)
      success(t('songList.addedToQueue'))
    }
  }
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
    const result = response.data as { added: number; duplicates: number }
    if (result.added > 0) eventBus.emit('playlistsChanged')
    if (result.added > 0 && result.duplicates > 0) {
      success(t('songList.addedToPlaylistWithDuplicates', result))
    } else if (result.added > 0) {
      success(t('songList.addedToPlaylist', { count: result.added }))
    } else {
      warning(t('songList.alreadyInPlaylist'))
    }
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
    await removeDeletedSongsFromQueue(songIds)
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
async function openActiveMenuSongFolder(): Promise<void> {
  const songId = activeMenuSong.value?.id
  closeMenu()
  if (!songId) return
  const response = await window.api.library.showSongInFolder(songId)
  if (!response.success) showError(response.error || t('songList.openFolderFailed'))
}
function requestDeleteActiveMenuSong(): void {
  const song = activeMenuSong.value
  closeMenu()
  if (!song) return
  songsPendingDelete.value = [song]
  deleteLocalFile.value = false
}
function requestDeleteSelectedSongs(): void {
  const selectedSongs = filteredSongs.value.filter((song) => selectedIds.value.has(song.id))
  if (!selectedSongs.length) return
  songsPendingDelete.value = selectedSongs
  deleteLocalFile.value = false
}
async function removeDeletedSongsFromQueue(songIds: number[]): Promise<void> {
  const deleted = new Set(songIds)
  for (let index = player.queue.length - 1; index >= 0; index--) {
    if (deleted.has(player.queue[index].id)) await player.removeQueueItem(index)
  }
}
async function confirmDeleteSong(): Promise<void> {
  const songIds = songsPendingDelete.value.map((song) => song.id)
  if (!songIds.length) return
  try {
    const response = await window.api.database.command('deleteSongs', {
      songIds,
      deleteLocalFiles: deleteLocalFile.value
    })
    if (!response.success) {
      showError(response.error || t('songList.deleteFailed'))
      return
    }
    const result = response.data as { deleted: number; failedFiles: string[] }
    await removeDeletedSongsFromQueue(songIds)
    selectedIds.value = new Set()
    await load()
    eventBus.emit('playlistsChanged')
    eventBus.emit('tagsChanged')
    success(t('songList.deleted'))
    if (result.failedFiles.length) warning(t('songList.deleteLocalFileFailed'))
    songsPendingDelete.value = []
  } catch (error) {
    showError(error instanceof Error ? error.message : t('songList.deleteFailed'))
  }
}
function openSongTags(): void {
  if (!activeMenuSong.value) return
  tagSongId.value = activeMenuSong.value.id
  songTagDialogOpen.value = true
  closeMenu()
}
function formatDetailDuration(seconds: number | null): string {
  if (seconds === null || seconds < 0) return '—'
  const total = Math.floor(seconds)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
function formatFileSize(bytes: number | null): string {
  if (bytes === null || bytes < 0) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
async function openSongDetails(): Promise<void> {
  const songId = activeMenuSong.value?.id
  closeMenu()
  if (!songId) return
  songDetailsOpen.value = true
  songDetailsLoading.value = true
  songDetails.value = null
  try {
    const response = await window.api.database.command('getSong', { id: songId })
    if (!response.success || !response.data) {
      showError(
        response.success
          ? t('songDetails.loadFailed')
          : response.error || t('songDetails.loadFailed')
      )
      songDetailsOpen.value = false
      return
    }
    songDetails.value = response.data as SongDetails
  } finally {
    songDetailsLoading.value = false
  }
}
function openBatchTags(): void {
  if (!selectedIds.value.size) return
  batchTagDialogOpen.value = true
}
const onScanFinished = (): void => void load()
const onTagsChanged = (): void => void load()
async function loadRemoteSources(): Promise<void> {
  const response = await window.api.database.command('listSources')
  if (response.success) remoteSources.value = response.data as MusicSourceOption[]
}
onMounted(() => {
  void load()
  void loadRemoteSources()
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
watch(sourceFilter, () => canFilterBySource.value && void load())
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
      :show-tag-manager="canFilterByTags"
      :active-tag-filter-count="canFilterByTags ? selectedTagIds.length : 0"
      :source-filter="canFilterBySource ? sourceFilter : undefined"
      :source-options="canFilterBySource ? sourceOptions : []"
      @refresh="refreshSongs"
      @sort="toggleSort"
      @toggle-selection="toggleSelection"
      @toggle-all="toggleAll"
      @batch-play="playSelected"
      @batch-add-to-playlist="addSelectedToPlaylist"
      @batch-edit-tags="openBatchTags"
      @batch-delete="requestDeleteSelectedSongs"
      @open-tag-manager="tagManagerOpen = true"
      @clear-tag-filters="selectedTagIds = []"
      @update:source-filter="sourceFilter = String($event)"
    />
    <div v-if="loading" class="p-6 text-sm text-[var(--color-text-l)]">
      {{ t('songList.loading') }}
    </div>
    <div v-else-if="filteredSongs.length === 0" class="p-6 text-sm text-[var(--color-text-l)]">
      {{ t('songList.empty') }}
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
          @click="openSongDetails"
        >
          {{ t('songList.details') }}
        </button>
        <button
          class="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
          @click="openActiveMenuSongFolder"
        >
          {{ t('songList.openFolder') }}
        </button>
        <button
          v-if="source.type === 'playlist'"
          class="block w-full rounded-md px-3 py-1.5 text-left text-sm text-red-400 hover:bg-[var(--color-hover)]"
          @click="removeActiveMenuSong"
        >
          {{ t('songList.removeFromPlaylist') }}
        </button>
        <button
          class="block w-full rounded-md px-3 py-1.5 text-left text-sm text-red-400 hover:bg-[var(--color-hover)]"
          @click="requestDeleteActiveMenuSong"
        >
          {{ t('songList.delete') }}
        </button>
      </div>
    </Teleport>
    <TagManagerDialog v-model="tagManagerOpen" v-model:selected-ids="selectedTagIds" />
    <SongTagDialog v-model="songTagDialogOpen" :song-id="tagSongId" @changed="load" />
    <BatchTagDialog v-model="batchTagDialogOpen" :song-ids="[...selectedIds]" @changed="load" />
    <BaseDialog v-model="songDetailsOpen" :title="t('songDetails.title')" width="max-w-3xl">
      <p v-if="songDetailsLoading" class="py-8 text-center text-sm text-[var(--color-text-l)]">
        {{ t('songDetails.loading') }}
      </p>
      <div v-else-if="songDetails" class="space-y-5">
        <section>
          <h3 class="mb-2 text-sm font-semibold">{{ songDetails.title }}</h3>
          <div class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <p>
              <span class="detail-label">{{ t('songDetails.artist') }}</span
              >{{ songDetails.artist || '—' }}
            </p>
            <p>
              <span class="detail-label">{{ t('songDetails.album') }}</span
              >{{ songDetails.album || '—' }}
            </p>
            <p>
              <span class="detail-label">{{ t('songDetails.genre') }}</span
              >{{ songDetails.genre || '—' }}
            </p>
            <p>
              <span class="detail-label">{{ t('songDetails.year') }}</span
              >{{ songDetails.year ?? '—' }}
            </p>
            <p>
              <span class="detail-label">{{ t('songDetails.track') }}</span
              >{{ songDetails.trackNo ?? '—' }}
            </p>
            <p>
              <span class="detail-label">{{ t('songDetails.disc') }}</span
              >{{ songDetails.diskNo ?? '—' }}
            </p>
          </div>
        </section>
        <section>
          <h3 class="mb-2 text-sm font-semibold">{{ t('songDetails.audio') }}</h3>
          <div class="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
            <p>
              <span class="detail-label">{{ t('songDetails.format') }}</span
              >{{ songDetails.format || '—' }}
            </p>
            <p>
              <span class="detail-label">{{ t('songDetails.duration') }}</span
              >{{ formatDetailDuration(songDetails.duration) }}
            </p>
            <p>
              <span class="detail-label">{{ t('songDetails.fileSize') }}</span
              >{{ formatFileSize(songDetails.fileSize) }}
            </p>
            <p>
              <span class="detail-label">{{ t('songDetails.bitrate') }}</span
              >{{ songDetails.bitrate ? `${songDetails.bitrate} kbps` : '—' }}
            </p>
            <p>
              <span class="detail-label">{{ t('songDetails.sampleRate') }}</span
              >{{ songDetails.sampleRate ? `${songDetails.sampleRate} Hz` : '—' }}
            </p>
            <p>
              <span class="detail-label">{{ t('songDetails.bitDepth') }}</span
              >{{ songDetails.bitDepth ? `${songDetails.bitDepth} bit` : '—' }}
            </p>
            <p>
              <span class="detail-label">{{ t('songDetails.channels') }}</span
              >{{ songDetails.channels ?? '—' }}
            </p>
            <p>
              <span class="detail-label">{{ t('songDetails.playTimes') }}</span
              >{{ songDetails.playTimes }}
            </p>
          </div>
        </section>
        <section>
          <h3 class="mb-2 text-sm font-semibold">{{ t('songDetails.source') }}</h3>
          <div class="space-y-2 text-sm">
            <p>
              <span class="detail-label">{{ t('songDetails.filePath') }}</span
              ><span class="break-all">{{ songDetails.audio }}</span>
            </p>
            <p>
              <span class="detail-label">{{ t('songDetails.fileName') }}</span
              >{{ songDetails.fileName || '—' }}
            </p>
            <p>
              <span class="detail-label">{{ t('songDetails.createdAt') }}</span
              >{{ songDetails.createdAt }}
            </p>
            <p v-if="songDetails.remoteId">
              <span class="detail-label">{{ t('songDetails.remoteId') }}</span
              >{{ songDetails.remoteId }}
            </p>
          </div>
        </section>
        <section v-if="songDetails.tags?.length">
          <h3 class="mb-2 text-sm font-semibold">{{ t('songDetails.tags') }}</h3>
          <div class="flex flex-wrap gap-1.5">
            <span
              v-for="tag in songDetails.tags"
              :key="tag.id"
              class="rounded-full px-2 py-0.5 text-xs text-white"
              :style="{ backgroundColor: tag.color || '#7c3aed' }"
              >{{ tag.name }}</span
            >
          </div>
        </section>
      </div>
    </BaseDialog>
    <BaseDialog
      :model-value="songsPendingDelete.length > 0"
      :title="t('songList.delete')"
      width="max-w-sm"
      :close-on-overlay="false"
      @update:model-value="!$event && (songsPendingDelete = [])"
    >
      <p class="text-sm text-[var(--color-text-l)]">
        <template v-if="songsPendingDelete.length === 1">
          {{ t('songList.confirmDelete', { title: songsPendingDelete[0]?.title ?? '' }) }}
        </template>
        <template v-else>{{
          t('songList.confirmDeleteBatch', { count: songsPendingDelete.length })
        }}</template>
      </p>
      <label
        v-if="songsPendingDelete.some((song) => song.sourceId === null)"
        class="mt-4 flex cursor-pointer items-center gap-2 text-sm"
      >
        <input v-model="deleteLocalFile" type="checkbox" class="accent-[var(--color-primary)]" />
        {{ t('songList.deleteLocalFile') }}
      </label>
      <template #footer>
        <button class="btn-hover rounded-lg px-3 py-1.5 text-sm" @click="songsPendingDelete = []">
          {{ t('common.cancel') }}
        </button>
        <button
          class="btn-hover rounded-lg bg-red-500 px-3 py-1.5 text-sm text-white"
          @click="confirmDeleteSong"
        >
          {{ t('songList.delete') }}
        </button>
      </template>
    </BaseDialog>
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

<style scoped>
.detail-label {
  display: block;
  margin-bottom: 0.125rem;
  font-size: 0.75rem;
  color: var(--color-text-l);
}
</style>
