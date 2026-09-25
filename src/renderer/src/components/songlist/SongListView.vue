<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
import eventBus from '@/utils/eventBus'
import SongListHeader from './SongListHeader.vue'
import SongListItem from './SongListItem.vue'
import TagManagerDialog from '@/components/tag/TagManagerDialog.vue'
import SongTagDialog from '@/components/tag/SongTagDialog.vue'
import BatchTagDialog from '@/components/tag/BatchTagDialog.vue'
import type { LibrarySong, PagedLibrarySongs } from '@/types/library'
import { useMessage } from '@/components/ui/useMessage'
import SongDetailsDialog from './SongDetailsDialog.vue'
import DeleteSongsDialog from './DeleteSongsDialog.vue'
import AddSongsToPlaylistDialog from './AddSongsToPlaylistDialog.vue'
import MetadataEditDialog from './MetadataEditDialog.vue'

type SongListSource =
  | { type: 'songs' | 'local' | 'remote' | 'history' }
  | { type: 'playlist'; id: number }
  | { type: 'folder'; id: number }
  | { type: 'album'; album: string; artist?: string }
  | { type: 'artist'; artist: string }
  | { type: 'genre'; genre: string }
type SortField =
  'id' | 'title' | 'artist' | 'album' | 'duration' | 'playTime' | 'diskNo' | 'trackNo'
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
const scroller = ref<{ scrollToItem?: (index: number) => void } | null>(null)
const showBackTop = ref(false)
const loading = ref(false)
const keyword = ref('')
const sortBy = ref<SortField>(props.source.type === 'history' ? 'playTime' : 'id')
const sortOrder = ref<'asc' | 'desc'>('desc')
const showFileName = ref(false)
const selectionMode = ref(false)
const selectedIds = ref<Set<number>>(new Set())
const activeMenuSong = ref<LibrarySong | null>(null)
const menuElement = ref<HTMLElement | null>(null)
const menuPosition = ref({ left: '0px', top: '0px' })
const playlistDialogOpen = ref(false)
const playlistSongIds = ref<number[]>([])
const tagManagerOpen = ref(false)
const songTagDialogOpen = ref(false)
const batchTagDialogOpen = ref(false)
const selectedTagIds = ref<number[]>([])
const tagSongId = ref<number | null>(null)
const songsPendingDelete = ref<LibrarySong[]>([])
const songDetailsOpen = ref(false)
const songDetailsId = ref<number | null>(null)
const metadataEditOpen = ref(false)
const metadataEditSongId = ref<number | null>(null)
const metadataEditCoverUrl = ref<string | null>(null)
const remoteSources = ref<MusicSourceOption[]>([])
const canFilterByTags = computed(() =>
  ['songs', 'local', 'remote', 'playlist', 'folder'].includes(props.source.type)
)
const sourceOptions = computed(() => [
  { label: t('songList.sourceAll'), value: 'all' },
  { label: t('songList.sourceLocal'), value: 'local' },
  { label: t('songList.sourceRemote'), value: 'remote' },
  ...remoteSources.value.map((source) => ({
    label: `${source.name}`,
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

const songTextCollator = new Intl.Collator(undefined, {
  usage: 'sort',
  sensitivity: 'base',
  numeric: true
})

function compareSongs(left: LibrarySong, right: LibrarySong): number {
  const field = sortBy.value
  let result = 0

  if (field === 'diskNo' || field === 'trackNo') {
    const otherField = field === 'diskNo' ? 'trackNo' : 'diskNo'
    for (const numberField of [field, otherField] as const) {
      const leftNumber = left[numberField]
      const rightNumber = right[numberField]
      if (leftNumber == null || rightNumber == null) {
        if (leftNumber == null && rightNumber == null) continue
        return leftNumber == null ? 1 : -1
      }
      result = leftNumber - rightNumber
      if (result !== 0) return result * (sortOrder.value === 'asc' ? 1 : -1)
    }
    return right.id - left.id
  } else if (field === 'id' || field === 'duration') {
    result = Number(left[field] ?? 0) - Number(right[field] ?? 0)
  } else {
    const leftValue =
      field === 'title' && showFileName.value ? left.fileName || left.title : left[field]
    const rightValue =
      field === 'title' && showFileName.value ? right.fileName || right.title : right[field]
    result = songTextCollator.compare(String(leftValue ?? ''), String(rightValue ?? ''))
  }

  if (result !== 0) return result * (sortOrder.value === 'asc' ? 1 : -1)
  return right.id - left.id
}

const filteredSongs = computed(() => {
  const search = keyword.value.trim().toLocaleLowerCase()
  return songs.value
    .filter(
      (song) =>
        !search ||
        [song.title, song.artist, song.album, song.fileName].some((value) =>
          value?.toLocaleLowerCase().includes(search)
        )
    )
    .sort(compareSongs)
})
const allSelected = computed(
  () =>
    filteredSongs.value.length > 0 &&
    filteredSongs.value.every((song) => selectedIds.value.has(song.id))
)

const getSongs = async (): Promise<LibrarySong[]> => {
  const { source } = props
  const { type } = source

  const getCommand = (): { name: string; params: unknown } => {
    switch (type) {
      case 'playlist':
        return {
          name: 'queryPlaylistSongs',
          params: {
            playlistId: source.id,
            query: { tags: [...selectedTagIds.value] }
          }
        }
      case 'folder':
        return {
          name: 'getLocalFolderSongs',
          params: { folderId: source.id }
        }
      case 'album':
        return {
          name: 'getSongsByAlbum',
          params: {
            album: source.album,
            artist: source.artist
          }
        }
      case 'artist':
        return {
          name: 'getSongsByArtist',
          params: {
            artist: source.artist,
            separator: uiStore.artistSeparator
          }
        }
      case 'genre':
        return {
          name: 'getSongsByGenre',
          params: { genre: source.genre }
        }
      case 'history':
        return {
          name: 'queryRecentPlayedSongs',
          params: {}
        }
      default: {
        const sourceParam =
          type === 'local'
            ? 'local'
            : type === 'remote'
              ? 'remote'
              : sourceFilter.value === 'local'
                ? 'local'
                : sourceFilter.value.startsWith('remote:') || sourceFilter.value === 'remote'
                  ? 'remote'
                  : 'all'

        return {
          name: 'querySongs',
          params: {
            tags: [...selectedTagIds.value],
            source: sourceParam,
            sourceId: sourceFilter.value.startsWith('remote:')
              ? Number(sourceFilter.value.slice('remote:'.length))
              : undefined
          }
        }
      }
    }
  }

  const { name, params } = getCommand()
  const response = await window.api.database.command(name, params)

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
const selectNewest = (): void => {
  selectedIds.value = new Set(
    filteredSongs.value.filter((song) => song.isNewest).map((song) => song.id)
  )
}
const openMenu = async (song: LibrarySong, x: number, y: number): Promise<void> => {
  activeMenuSong.value = song
  menuPosition.value = { left: `${x}px`, top: `${y}px` }
  eventBus.emit('songActionsMenuOpened', 'songlist')
  await nextTick()
  const menu = menuElement.value
  if (!menu) return
  menuPosition.value = {
    left: `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`,
    top: `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`
  }
}
const closeMenu = (): void => {
  activeMenuSong.value = null
}
const onListScroll = (event: Event): void => {
  closeMenu()
  showBackTop.value = (event.target as HTMLElement).scrollTop > 320
}
const backToTop = (): void => {
  scroller.value?.scrollToItem?.(0)
  showBackTop.value = false
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
async function copyActiveMenuSongName(): Promise<void> {
  const song = activeMenuSong.value
  closeMenu()
  const name = song?.title.trim() || (song?.fileName ?? '').trim()
  if (!name) return
  try {
    await navigator.clipboard.writeText(name)
  } catch {
    const input = document.createElement('textarea')
    input.value = name
    input.style.position = 'fixed'
    input.style.opacity = '0'
    document.body.appendChild(input)
    input.select()
    const copied = document.execCommand('copy')
    input.remove()
    if (!copied) {
      showError(t('songList.copyNameFailed'))
      return
    }
  }
  success(t('songList.nameCopied'))
}

function openPlaylistPicker(songIds: number[]): void {
  if (!songIds.length) return
  playlistSongIds.value = [...songIds]
  playlistDialogOpen.value = true
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
    success(t('songList.removedFromPlaylist'))
  }
}
async function addActiveMenuSongToPlaylist(): Promise<void> {
  const songId = activeMenuSong.value?.id
  closeMenu()
  if (songId) openPlaylistPicker([songId])
}
function addSelectedToPlaylist(): void {
  openPlaylistPicker([...selectedIds.value])
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
}
function requestDeleteSelectedSongs(): void {
  const selectedSongs = filteredSongs.value.filter((song) => selectedIds.value.has(song.id))
  if (!selectedSongs.length) return
  songsPendingDelete.value = selectedSongs
}
async function removeDeletedSongsFromQueue(songIds: number[]): Promise<void> {
  const deleted = new Set(songIds)
  for (let index = player.queue.length - 1; index >= 0; index--) {
    if (deleted.has(player.queue[index].id)) await player.removeQueueItem(index)
  }
}
async function onSongsDeleted(songIds: number[]): Promise<void> {
  await removeDeletedSongsFromQueue(songIds)
  selectedIds.value = new Set()
  songsPendingDelete.value = []
  await load()
  eventBus.emit('playlistsChanged')
  eventBus.emit('tagsChanged')
}
function openSongTags(): void {
  if (!activeMenuSong.value) return
  tagSongId.value = activeMenuSong.value.id
  songTagDialogOpen.value = true
  closeMenu()
}
async function openSongDetails(): Promise<void> {
  const songId = activeMenuSong.value?.id
  closeMenu()
  if (!songId) return
  songDetailsId.value = songId
  songDetailsOpen.value = true
}
function openMetadataEdit(): void {
  const song = activeMenuSong.value
  closeMenu()
  if (!song) return
  if (song.sourceId) {
    warning(t('metadataEdit.remoteNotSupported'))
    return
  }
  metadataEditSongId.value = song.id
  metadataEditCoverUrl.value = song.cover
    ? `easy-player-media://cover?path=${encodeURIComponent(song.cover)}`
    : null
  metadataEditOpen.value = true
}
function onMetadataSaved(): void {
  void load()
}
function openBatchTags(): void {
  if (!selectedIds.value.size) return
  batchTagDialogOpen.value = true
}
async function reloadSongsFromDisk(songIds: number[]): Promise<void> {
  if (!songIds.length) return
  const response = await window.api.metadata.reload(songIds)
  if (!response.success) {
    showError(response.error || t('songList.reloadFromDiskFailed'))
    return
  }
  await load()
  const result = response.data
  success(t('songList.reloadedFromDisk', { count: result?.reloaded || 0 }))
  if (result?.failed) warning(t('songList.reloadFromDiskPartial', { count: result.failed }))
}
function reloadActiveMenuSongFromDisk(): void {
  const song = activeMenuSong.value
  closeMenu()
  if (!song) return
  void reloadSongsFromDisk([song.id])
}
function reloadSelectedSongsFromDisk(): void {
  const localIds = filteredSongs.value
    .filter((song) => selectedIds.value.has(song.id) && song.sourceId === null)
    .map((song) => song.id)
  if (!localIds.length) {
    warning(t('songList.remoteReloadNotSupported'))
    return
  }
  void reloadSongsFromDisk(localIds)
}
const onScanFinished = (): void => void load()
const onTagsChanged = (): void => void load()
const onSongActionsMenuOpened = (source: 'footer' | 'songlist'): void => {
  if (source !== 'songlist') closeMenu()
}
const locateCurrentSong = (): void => {
  const id = player.currentQueueSong?.id
  if (!id) return
  const index = filteredSongs.value.findIndex((song) => song.id === id)
  if (index >= 0) scroller.value?.scrollToItem?.(index)
}
async function loadRemoteSources(): Promise<void> {
  const response = await window.api.database.command('listSources')
  if (response.success) remoteSources.value = response.data as MusicSourceOption[]
}
onMounted(() => {
  void load()
  void loadRemoteSources()
  eventBus.on('scanFinished', onScanFinished)
  eventBus.on('tagsChanged', onTagsChanged)
  eventBus.on('songActionsMenuOpened', onSongActionsMenuOpened)
  eventBus.on('locateCurrentSong', locateCurrentSong)
  window.addEventListener('click', closeMenu)
  window.addEventListener('contextmenu', closeMenu)
})
onBeforeUnmount(() => {
  eventBus.off('scanFinished', onScanFinished)
  eventBus.off('tagsChanged', onTagsChanged)
  eventBus.off('songActionsMenuOpened', onSongActionsMenuOpened)
  eventBus.off('locateCurrentSong', locateCurrentSong)
  window.removeEventListener('click', closeMenu)
  window.removeEventListener('contextmenu', closeMenu)
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
  <section class="relative flex h-full min-h-0 flex-col text-text">
    <SongListHeader
      v-model:keyword="keyword"
      :total="songs.length"
      :sort-by="sortBy"
      :sort-order="sortOrder"
      :show-album-sorts="source.type === 'album'"
      :show-play-time-sort="source.type === 'history'"
      :selection-mode="selectionMode"
      :selected-count="selectedIds.size"
      :all-selected="allSelected"
      :show-file-name="showFileName"
      :compact="uiStore.compactSongList"
      :show-tag-manager="canFilterByTags"
      :active-tag-filter-count="canFilterByTags ? selectedTagIds.length : 0"
      :source-filter="canFilterBySource ? sourceFilter : undefined"
      :source-options="canFilterBySource ? sourceOptions : []"
      @refresh="refreshSongs"
      @sort="toggleSort"
      @toggle-selection="toggleSelection"
      @toggle-all="toggleAll"
      @select-newest="selectNewest"
      @toggle-file-name="showFileName = !showFileName"
      @toggle-compact="uiStore.compactSongList = !uiStore.compactSongList"
      @batch-play="playSelected"
      @batch-add-to-playlist="addSelectedToPlaylist"
      @batch-edit-tags="openBatchTags"
      @batch-reload-from-disk="reloadSelectedSongsFromDisk"
      @batch-delete="requestDeleteSelectedSongs"
      @open-tag-manager="tagManagerOpen = true"
      @clear-tag-filters="selectedTagIds = []"
      @update:source-filter="sourceFilter = String($event)"
    />
    <div v-if="loading" class="p-6 text-sm text-text-l">
      {{ t('songList.loading') }}
    </div>
    <div v-else-if="filteredSongs.length === 0" class="p-6 text-sm text-text-l">
      {{ t('songList.empty') }}
    </div>
    <RecycleScroller
      v-else
      ref="scroller"
      v-slot="{ item, index }"
      class="custom-scrollbar min-h-0 flex-1 overflow-y-auto"
      :items="filteredSongs"
      :item-size="uiStore.compactSongList ? 56 : 64"
      key-field="id"
      @scroll.passive="onListScroll"
    >
      <SongListItem
        :song="item"
        :index="index"
        :selection-mode="selectionMode"
        :selected="selectedIds.has(item.id)"
        :current="player.currentQueueSong?.id === item.id"
        :keyword="keyword"
        :show-file-name="showFileName"
        :compact="uiStore.compactSongList"
        @play="playSong"
        @toggle-select="toggleSelect"
        @request-menu="openMenu"
      />
    </RecycleScroller>
    <button
      v-if="showBackTop && !loading && filteredSongs.length"
      type="button"
      class="absolute right-5 bottom-4 z-10 grid size-9 place-items-center rounded-full border border-border bg-bg-l text-text shadow-lg transition-colors hover:bg-hover-bg"
      :aria-label="t('songList.backToTop')"
      :title="t('songList.backToTop')"
      @click="backToTop"
    >
      <svgIcon name="arrow-arrow-up" class-name="size-5" />
    </button>
    <!-- menu -->
    <Teleport to="body">
      <div
        v-if="activeMenuSong"
        ref="menuElement"
        class="fixed z-[9999] w-47 max-h-[calc(100vh-16px)] overflow-y-auto rounded-lg border border-border bg-bg p-1 text-left shadow-xl"
        :style="menuPosition"
        @click.stop
        @dblclick.stop
        @contextmenu.prevent.stop
      >
        <button
          class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
          @click="playActiveMenuSong"
        >
          <svgIcon name="play-play" class-name="size-4" />
          {{ t('songList.play') }}
        </button>
        <button
          class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
          @click="addActiveMenuSongToQueue"
        >
          <svgIcon name="common-plus" class-name="size-4" />
          {{ t('songList.addToQueue') }}
        </button>
        <button
          class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
          @click="addActiveMenuSongToPlaylist"
        >
          <svgIcon name="common-plus" class-name="size-4" />
          {{ t('songList.addToPlaylist') }}
        </button>
        <button
          class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
          @click="openSongTags"
        >
          <svgIcon name="common-tag" class-name="size-4" />
          {{ t('songList.editTags') }}
        </button>
        <button
          class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
          @click="openMetadataEdit"
        >
          <svgIcon name="common-edit" class-name="size-4" />
          {{ t('songList.editMetadata') }}
        </button>
        <button
          class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
          @click="openSongDetails"
        >
          <svgIcon name="common-detail" class-name="size-4" />
          {{ t('songList.details') }}
        </button>
        <button
          class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
          @click="openActiveMenuSongFolder"
        >
          <svgIcon name="common-folder" class-name="size-4" />
          {{ t('songList.openFolder') }}
        </button>
        <button
          v-if="activeMenuSong.sourceId === null"
          class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
          @click="reloadActiveMenuSongFromDisk"
        >
          <svgIcon name="common-refresh" class-name="size-4" />
          {{ t('songList.reloadFromDisk') }}
        </button>
        <button
          v-if="source.type === 'playlist'"
          class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm text-red-400 hover:bg-hover"
          @click="removeActiveMenuSong"
        >
          <svgIcon name="common-delete" class-name="size-4" />
          {{ t('songList.removeFromPlaylist') }}
        </button>
        <button
          class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-hover"
          @click="copyActiveMenuSongName"
        >
          <svgIcon name="common-text-case" class-name="size-4" />
          {{ t('songList.copyName') }}
        </button>
        <button
          class="flex items-center gap-2 w-full rounded-md px-3 py-1.5 text-left text-sm text-red-400 hover:bg-hover"
          @click="requestDeleteActiveMenuSong"
        >
          <svgIcon name="common-delete" class-name="size-4" />
          {{ t('songList.delete') }}
        </button>
      </div>
    </Teleport>
    <TagManagerDialog v-model="tagManagerOpen" v-model:selected-ids="selectedTagIds" />
    <SongTagDialog v-model="songTagDialogOpen" :song-id="tagSongId" @changed="load" />
    <BatchTagDialog v-model="batchTagDialogOpen" :song-ids="[...selectedIds]" @changed="load" />
    <SongDetailsDialog v-model="songDetailsOpen" :song-id="songDetailsId" />
    <MetadataEditDialog
      v-model="metadataEditOpen"
      :song-id="metadataEditSongId"
      :cover-url="metadataEditCoverUrl"
      @saved="onMetadataSaved"
    />
    <DeleteSongsDialog
      :model-value="songsPendingDelete.length > 0"
      :songs="songsPendingDelete"
      @update:model-value="!$event && (songsPendingDelete = [])"
      @deleted="onSongsDeleted"
    />
    <AddSongsToPlaylistDialog v-model="playlistDialogOpen" :song-ids="playlistSongIds" />
  </section>
</template>
