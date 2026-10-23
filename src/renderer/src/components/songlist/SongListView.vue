<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
import { useStatisticsStore } from '@/stores/statistics/statisticsStore'
import { querySongList, type SongListSource } from '@/services/songListQuery'
import { playSearchResult } from '@/services/searchPlayback'
import eventBus from '@/utils/eventBus'
import { createSongTextComparator, songSortText } from '@/utils/songTextSort'
import SongListHeader from './SongListHeader.vue'
import { useSongSelection } from './useSongSelection'
import SongListItem from './SongListItem.vue'
import SongListActions from './SongListActions.vue'
import TagManagerDialog from '@/components/tag/TagManagerDialog.vue'
import type { LibrarySong } from '@/types/library'
import { useMessage } from '@/components/ui/useMessage'
import { LIKED_PLAYLIST_ID } from '@/constants/playlists'

type SortField =
  'id' | 'title' | 'artist' | 'album' | 'duration' | 'playTime' | 'diskNo' | 'trackNo' | 'relevance'
interface MusicSourceOption {
  id: number
  name: string
}

const props = withDefaults(defineProps<{ source?: SongListSource }>(), {
  source: () => ({ type: 'songs' })
})

const collectionPlaylistId = computed(() =>
  props.source.type === 'playlist'
    ? props.source.id
    : props.source.type === 'liked'
      ? LIKED_PLAYLIST_ID
      : null
)
const playbackOrigin = computed(() =>
  props.source.type === 'recommendation' ? ('recommendation' as const) : ('manual' as const)
)
const player = usePlayerStore()
const uiStore = useUIStore()
const statistics = useStatisticsStore()
const { t } = useI18n()
const { success, warning, error: showError } = useMessage()
const songs = ref<LibrarySong[]>([])
const scroller = ref<{ scrollToItem?: (index: number) => void } | null>(null)
const showBackTop = ref(false)
const loading = ref(false)
const keyword = ref('')
const composing = ref(false)
let appliedSearch = ''
let searchTimer: ReturnType<typeof setTimeout> | undefined
let loadRevision = 0
let disposed = false
let offSearchIndex: (() => void) | undefined
const sortBy = ref<SortField>(props.source.type === 'history' ? 'playTime' : 'id')
const sortOrder = ref<'asc' | 'desc'>('desc')
const hasSearch = ref(false)
let browsingSort: { field: SortField; order: 'asc' | 'desc' } = {
  field: sortBy.value,
  order: sortOrder.value
}
const showFileName = ref(false)
const tagManagerOpen = ref(false)
const selectedTagIds = ref<number[]>([])
const actions = ref<InstanceType<typeof SongListActions> | null>(null)
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
const compareSongNames = createSongTextComparator()
const nameSortValues = computed(() => {
  const field = sortBy.value
  if (field !== 'title' && field !== 'artist' && field !== 'album') return new Map<number, string>()
  return new Map(
    songs.value.map((song) => [
      song.id,
      songSortText(
        song,
        field === 'title' && showFileName.value && song.fileName ? 'fileName' : field
      )
    ])
  )
})
const recommendationOrder = computed(
  () => new Map(songs.value.map((song, index) => [song.id, index]))
)

function compareSongs(left: LibrarySong, right: LibrarySong): number {
  const field = sortBy.value
  let result = 0

  if (field === 'id' && props.source.type === 'recommendation') {
    result =
      (recommendationOrder.value.get(right.id) ?? 0) - (recommendationOrder.value.get(left.id) ?? 0)
    return result * (sortOrder.value === 'asc' ? 1 : -1)
  }

  if (field === 'relevance') {
    result = (left.searchScore ?? 0) - (right.searchScore ?? 0)
    return result ? result * (sortOrder.value === 'asc' ? 1 : -1) : right.id - left.id
  }

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
    const leftValue = field === 'playTime' ? left.playTime : nameSortValues.value.get(left.id)
    const rightValue = field === 'playTime' ? right.playTime : nameSortValues.value.get(right.id)
    const compare = field === 'playTime' ? songTextCollator.compare : compareSongNames
    result = compare(String(leftValue ?? ''), String(rightValue ?? ''))
  }

  if (result !== 0) return result * (sortOrder.value === 'asc' ? 1 : -1)
  return right.id - left.id
}

const filteredSongs = computed(() => songs.value.slice().sort(compareSongs))
const {
  selectionMode,
  selectedIds,
  allSelected,
  toggleSelection,
  toggleSelect,
  toggleAll,
  selectNewest
} = useSongSelection(filteredSongs)

const getSongs = (): Promise<LibrarySong[]> =>
  querySongList({
    source: props.source,
    search: appliedSearch,
    tags: [...selectedTagIds.value],
    sourceFilter: sourceFilter.value,
    artistSeparator: uiStore.artistSeparator,
    genreSeparator: uiStore.genreSeparator,
    statistics
  })

const load = async (): Promise<void> => {
  const revision = ++loadRevision
  loading.value = true
  try {
    const result = await getSongs()
    if (!disposed && revision === loadRevision) songs.value = result
  } catch (error) {
    if (!disposed && revision === loadRevision) showError(String(error))
  } finally {
    if (!disposed && revision === loadRevision) loading.value = false
  }
}
watch(
  () => [statistics.generation, statistics.enabled],
  () => {
    if (props.source.type === 'history' || props.source.type === 'recommendation') void load()
  }
)
async function refreshSongs(): Promise<void> {
  await load()
  success(t('songList.refreshed'))
}
const toggleSort = (field: SortField): void => {
  if (sortBy.value === field) sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  else {
    sortBy.value = field
    sortOrder.value = field === 'relevance' ? 'desc' : 'asc'
  }
  if (field !== 'relevance') browsingSort = { field, order: sortOrder.value }
}
const onListScroll = (event: Event): void => {
  actions.value?.closeMenu()
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
    await playSearchResult(player, song)
    return
  }
  await player.playCollection(
    filteredSongs.value,
    song.id,
    collectionPlaylistId.value,
    playbackOrigin.value
  )
}
const playSelected = (): void => {
  const selectedSongs = filteredSongs.value.filter((song) => selectedIds.value.has(song.id))
  if (selectedSongs[0])
    void player.playCollection(
      selectedSongs,
      null,
      collectionPlaylistId.value,
      playbackOrigin.value
    )
}
async function playAll(): Promise<void> {
  if (loading.value) return
  const playable = filteredSongs.value.filter((song) => song.songStatus !== 0)
  if (!playable.length) {
    warning(t('playlist.empty'))
    return
  }
  if (
    !(await player.playCollection(playable, null, collectionPlaylistId.value, playbackOrigin.value))
  )
    showError(t('playlist.playFailed'))
}
defineExpose({ playAll, loading })
const onScanFinished = (): void => void load()
const onTagsChanged = (): void => void load()
const onSongPreferenceChanged = ({
  songId,
  preference
}: {
  songId: number
  preference: -1 | 0 | 1
}): void => {
  if (props.source.type === 'liked') {
    void load()
    return
  }
  for (const song of songs.value) {
    if (song.id === songId) song.preference = preference
  }
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
  offSearchIndex = window.api.database.onSearchIndexChanged(() => {
    if (appliedSearch && !composing.value && !searchTimer) void load()
  })
  void load()
  void loadRemoteSources()
  eventBus.on('scanFinished', onScanFinished)
  eventBus.on('tagsChanged', onTagsChanged)
  eventBus.on('songPreferenceChanged', onSongPreferenceChanged)
  eventBus.on('locateCurrentSong', locateCurrentSong)
})
onBeforeUnmount(() => {
  disposed = true
  ++loadRevision
  if (searchTimer) clearTimeout(searchTimer)
  offSearchIndex?.()
  eventBus.off('scanFinished', onScanFinished)
  eventBus.off('tagsChanged', onTagsChanged)
  eventBus.off('songPreferenceChanged', onSongPreferenceChanged)
  eventBus.off('locateCurrentSong', locateCurrentSong)
})
watch(
  () => props.source,
  () => void load(),
  { deep: true }
)
watch(selectedTagIds, () => canFilterByTags.value && void load())
watch(sourceFilter, () => canFilterBySource.value && void load())
watch(
  () =>
    props.source.type === 'genre'
      ? uiStore.genreSeparator
      : props.source.type === 'artist'
        ? uiStore.artistSeparator
        : undefined,
  () => void load()
)
watch([keyword, composing], () => {
  ++loadRevision
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = undefined
  if (composing.value) return
  searchTimer = setTimeout(() => {
    searchTimer = undefined
    const nextSearch = keyword.value.trim()
    if (nextSearch && nextSearch !== appliedSearch) {
      if (!appliedSearch) browsingSort = { field: sortBy.value, order: sortOrder.value }
      sortBy.value = 'relevance'
      sortOrder.value = 'desc'
    } else if (!nextSearch && appliedSearch) {
      sortBy.value = browsingSort.field
      sortOrder.value = browsingSort.order
    }
    appliedSearch = nextSearch
    hasSearch.value = Boolean(appliedSearch)
    void load()
  }, 200)
})
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
      :show-relevance-sort="hasSearch"
      :selection-mode="selectionMode"
      :selected-count="selectedIds.size"
      :all-selected="allSelected"
      :show-file-name="showFileName"
      :compact="uiStore.compactSongList"
      :show-tag-manager="canFilterByTags"
      :active-tag-filter-count="canFilterByTags ? selectedTagIds.length : 0"
      :source-filter="canFilterBySource ? sourceFilter : undefined"
      :source-options="canFilterBySource ? sourceOptions : []"
      @composition-change="composing = $event"
      @refresh="refreshSongs"
      @sort="toggleSort"
      @toggle-selection="toggleSelection"
      @toggle-all="toggleAll"
      @select-newest="selectNewest"
      @toggle-file-name="showFileName = !showFileName"
      @toggle-compact="uiStore.compactSongList = !uiStore.compactSongList"
      @batch-play="playSelected"
      @batch-add-to-playlist="actions?.addSelectedToPlaylist()"
      @batch-edit-tags="actions?.openBatchTags()"
      @batch-reload-from-disk="actions?.reloadSelectedSongsFromDisk()"
      @batch-delete="actions?.requestDeleteSelectedSongs()"
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
      class="custom-scrollbar min-h-0 flex-1 overflow-y-auto"
      :items="filteredSongs"
      :item-size="uiStore.compactSongList ? 56 : 64"
      key-field="id"
      @scroll.passive="onListScroll"
    >
      <template #default="{ item, index }">
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
          @request-menu="(song, x, y) => actions?.openMenu(song, x, y)"
        />
      </template>
      <template #after>
        <div class="h-28" aria-hidden="true" />
      </template>
    </RecycleScroller>
    <button
      v-if="showBackTop && !loading && filteredSongs.length"
      type="button"
      class="absolute right-5 bottom-28 z-10 grid size-9 place-items-center rounded-full border border-border bg-bg-l text-text shadow-lg transition-colors hover:bg-hover-bg"
      :aria-label="t('songList.backToTop')"
      :title="t('songList.backToTop')"
      @click="backToTop"
    >
      <svgIcon name="arrow-arrow-up" class-name="size-5" />
    </button>
    <TagManagerDialog v-model="tagManagerOpen" v-model:selected-ids="selectedTagIds" />
    <SongListActions
      ref="actions"
      :source="source"
      :songs="filteredSongs"
      :selected-ids="selectedIds"
      :refresh="load"
      :play-song="playSong"
      @clear-selection="selectedIds = new Set()"
    />
  </section>
</template>
