<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
import { useStatisticsStore } from '@/stores/statistics/statisticsStore'
import { querySongList, type SongListSource } from '@/services/songListQuery'
import { playSearchResult } from '@/services/searchPlayback'
import eventBus from '@/utils/eventBus'
import { createSongTextComparator, songSortText } from '@/utils/songTextSort'
import {
  normalizeSongListColumns,
  songListLayout,
  songListRowHeight,
  songPlayCount,
  songYear,
  type OptionalSongColumn,
  type SongSortField as SortField
} from '@/utils/songListLayout'
import SongListHeader from './SongListHeader.vue'
import { useSongSelection } from './useSongSelection'
import SongListItem from './SongListItem.vue'
import SongListActions from './SongListActions.vue'
import TagManagerDialog from '@/components/tag/TagManagerDialog.vue'
import type { LibrarySong } from '@/types/library'
import { useMessage } from '@/components/ui/useMessage'
import BaseBackTop from '@/components/ui/BaseBackTop.vue'
import { useScrollPosition } from '@/hooks/useScrollPosition'
import { LIKED_PLAYLIST_ID } from '@/constants/playlists'

import type { MusicSource } from '../../../../shared/remoteSources'

type MusicSourceOption = Pick<MusicSource, 'id' | 'name'>

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
const scroller = ref<{
  el?: HTMLElement
  scrollToItem?: (index: number) => void
  scrollToPosition?: (position: number) => void
  updateVisibleItems?: (itemsChanged: boolean) => unknown
} | null>(null)
const backTopTarget = (): HTMLElement | null => scroller.value?.el ?? null
const rowHeight = computed(() => songListRowHeight(uiStore.compactSongList, uiStore.smallSongList))
const columns = computed(() => normalizeSongListColumns(uiStore.songListColumns))
const layoutStyle = computed(() => songListLayout(columns.value, uiStore.smallSongList === true))
const scrollLeft = ref(0)
const contentWidth = ref(0)
function syncScrollLayout(): void {
  const element = scroller.value?.el
  if (!element) return
  scrollLeft.value = element.scrollLeft
  contentWidth.value = element.clientWidth
}
function toggleColumn(column: OptionalSongColumn): void {
  uiStore.songListColumns = { ...columns.value, [column]: !columns.value[column] }
}
watch(columns, () => void nextTick(syncScrollLayout))
const loading = ref(true)
const keyword = ref('')
const composing = ref(false)
let appliedSearch = ''
const appliedSearchKey = ref('')
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
    value: `remote:${source.id}`,
    group: t('songList.customRemoteSources')
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
  } else if (field === 'year') {
    const leftYear = songYear(left)
    const rightYear = songYear(right)
    if (leftYear === null || rightYear === null) {
      if (leftYear !== rightYear) return leftYear === null ? 1 : -1
    } else result = leftYear - rightYear
  } else if (field === 'playTimes') {
    result = (songPlayCount(left) ?? 0) - (songPlayCount(right) ?? 0)
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
let layoutAnchor: { songId: number; rowFraction: number } | undefined
watch(
  rowHeight,
  async (height, previousHeight, onCleanup) => {
    let cancelled = false
    onCleanup(() => {
      cancelled = true
    })
    const element = scroller.value?.el
    if (!element || loading.value || !filteredSongs.value.length) {
      layoutAnchor = undefined
      return
    }
    // This pre-render watcher reads the old scroll position before the shorter
    // virtual content can clamp it. Keep the song, rather than its pixel index.
    const firstIndex = Math.min(
      Math.floor(element.scrollTop / previousHeight),
      filteredSongs.value.length - 1
    )
    const anchor = layoutAnchor ?? {
      songId: filteredSongs.value[firstIndex].id,
      rowFraction: (element.scrollTop % previousHeight) / previousHeight
    }
    layoutAnchor = anchor
    const revision = loadRevision
    await nextTick()
    if (cancelled || disposed) return
    layoutAnchor = undefined
    if (loading.value || revision !== loadRevision || scroller.value?.el !== element) return
    const index = filteredSongs.value.findIndex((song) => song.id === anchor.songId)
    if (index < 0) return
    const position = (index + anchor.rowFraction) * height
    if (scroller.value?.scrollToPosition) scroller.value.scrollToPosition(position)
    else element.scrollTop = position
    syncScrollLayout()
  },
  { flush: 'pre' }
)

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
    albumGroupByName: uiStore.albumGroupByName,
    statistics
  })

const {
  isRestoringScroll,
  saveScrollPosition,
  scheduleScrollPositionSave,
  clearSavedScrollPosition,
  restoreScrollPosition
} = useScrollPosition(
  computed(() => scroller.value?.el ?? null),
  computed(
    () =>
      `song-list-scroll-position:${JSON.stringify([
        props.source,
        appliedSearchKey.value,
        sortBy.value,
        sortOrder.value,
        selectedTagIds.value,
        canFilterBySource.value ? sourceFilter.value : '',
        uiStore.artistSeparator,
        uiStore.genreSeparator,
        uiStore.albumGroupByName
      ])}`
  ),
  {
    ready: computed(() => !loading.value),
    onRestore: () => {
      scroller.value?.updateVisibleItems?.(true)
      syncScrollLayout()
    }
  }
)

const load = async (resetScroll = false): Promise<void> => {
  if (resetScroll) clearSavedScrollPosition()
  else saveScrollPosition()
  const revision = ++loadRevision
  loading.value = true
  try {
    const result = await getSongs()
    if (!disposed && revision === loadRevision) {
      songs.value = result
      await nextTick()
      if (!disposed && revision === loadRevision) syncScrollLayout()
      if (resetScroll) {
        if (!disposed && revision === loadRevision) {
          scroller.value?.scrollToItem?.(0)
        }
      } else {
        await restoreScrollPosition()
      }
    }
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
    sortOrder.value = field === 'relevance' || field === 'playTimes' ? 'desc' : 'asc'
  }
  if (field !== 'relevance') browsingSort = { field, order: sortOrder.value }
}
const onListScroll = (event: Event): void => {
  scheduleScrollPositionSave()
  actions.value?.closeMenu()
  scrollLeft.value = (event.target as HTMLElement).scrollLeft
}
const backToTop = (): void => {
  if (scroller.value?.scrollToItem) scroller.value.scrollToItem(0)
  else scroller.value?.el?.scrollTo({ top: 0, behavior: 'auto' })
}
const playSong = async (song: LibrarySong): Promise<void> => {
  if (loading.value || song.songStatus === 0) return
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
  if (loading.value) return
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
const onSongPreferencesCleared = ({ songIds }: { songIds: number[] }): void => {
  const cleared = new Set(songIds)
  for (const song of songs.value) if (cleared.has(song.id)) song.preference = 0
}
const onSongsPreferenceChanged = ({
  songIds,
  preference
}: {
  songIds: number[]
  preference: -1 | 0 | 1
}): void => {
  if (props.source.type === 'liked') {
    void load()
    return
  }
  const ids = new Set(songIds)
  for (const song of songs.value) if (ids.has(song.id)) song.preference = preference
}
const onSongsLyricFlagsChanged = ({
  songIds,
  disableNetwork,
  instrumental
}: {
  songIds: number[]
  disableNetwork?: boolean
  instrumental?: boolean
}): void => {
  const ids = new Set(songIds)
  for (const song of songs.value)
    if (ids.has(song.id)) {
      if (disableNetwork !== undefined) song.disableNetworkLyrics = disableNetwork
      if (instrumental !== undefined) song.instrumental = instrumental
    }
}
const onSongLyricSettingsChanged = async (songId: number): Promise<void> => {
  if (!songs.value.some((song) => song.id === songId)) return
  const response = await window.api.database.command('getSongLyricSettings', { songId })
  if (response.success) {
    const settings = response.data as import('../../../../shared/songLyrics').SongLyricSettings
    onSongsLyricFlagsChanged({
      songIds: [songId],
      disableNetwork: settings.disableNetwork,
      instrumental: settings.instrumental
    })
  }
}
const locateCurrentSong = (): void => {
  const id = player.currentQueueSong?.id
  if (!id) return
  const index = filteredSongs.value.findIndex((song) => song.id === id)
  if (index >= 0) scroller.value?.scrollToItem?.(index)
}
let remoteSourcesRevision = 0
async function loadRemoteSources(): Promise<boolean> {
  const revision = ++remoteSourcesRevision
  try {
    const response = await window.api.database.command('listSources')
    if (disposed || revision !== remoteSourcesRevision || !response.success) return false
    remoteSources.value = response.data as MusicSourceOption[]
    if (
      canFilterBySource.value &&
      uiStore.musicSource === 'remote' &&
      uiStore.musicSourceId > 0 &&
      !remoteSources.value.some((source) => source.id === uiStore.musicSourceId)
    )
      uiStore.musicSourceId = 0
    return true
  } catch (error) {
    if (!disposed && revision === remoteSourcesRevision)
      console.warn('[SongList] Failed to load remote sources:', error)
    return false
  }
}
async function onMusicSourcesChanged(): Promise<void> {
  const previousFilter = sourceFilter.value
  if ((await loadRemoteSources()) && previousFilter === sourceFilter.value) void load()
}
onMounted(() => {
  offSearchIndex = window.api.database.onSearchIndexChanged(() => {
    if (appliedSearch && !composing.value && !searchTimer) void load()
  })
  void load()
  void loadRemoteSources()
  eventBus.on('scanFinished', onScanFinished)
  eventBus.on('tagsChanged', onTagsChanged)
  eventBus.on('musicSourcesChanged', onMusicSourcesChanged)
  eventBus.on('songPreferenceChanged', onSongPreferenceChanged)
  eventBus.on('songPreferencesCleared', onSongPreferencesCleared)
  eventBus.on('songsPreferenceChanged', onSongsPreferenceChanged)
  eventBus.on('songsLyricFlagsChanged', onSongsLyricFlagsChanged)
  eventBus.on('songLyricSettingsChanged', onSongLyricSettingsChanged)
  eventBus.on('locateCurrentSong', locateCurrentSong)
})
onBeforeUnmount(() => {
  disposed = true
  ++loadRevision
  if (searchTimer) clearTimeout(searchTimer)
  offSearchIndex?.()
  eventBus.off('scanFinished', onScanFinished)
  eventBus.off('tagsChanged', onTagsChanged)
  eventBus.off('musicSourcesChanged', onMusicSourcesChanged)
  eventBus.off('songPreferenceChanged', onSongPreferenceChanged)
  eventBus.off('songPreferencesCleared', onSongPreferencesCleared)
  eventBus.off('songsPreferenceChanged', onSongsPreferenceChanged)
  eventBus.off('songsLyricFlagsChanged', onSongsLyricFlagsChanged)
  eventBus.off('songLyricSettingsChanged', onSongLyricSettingsChanged)
  eventBus.off('locateCurrentSong', locateCurrentSong)
})
watch(
  () => props.source,
  () => void load(),
  { deep: true }
)
watch(selectedTagIds, () => canFilterByTags.value && void load(true))
watch(sourceFilter, () => canFilterBySource.value && void load(true))
watch(
  () =>
    props.source.type === 'genre'
      ? uiStore.genreSeparator
      : props.source.type === 'artist'
        ? uiStore.artistSeparator
        : props.source.type === 'album'
          ? uiStore.albumGroupByName
          : undefined,
  () => void load(true)
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
    appliedSearchKey.value = nextSearch
    hasSearch.value = Boolean(appliedSearch)
    void load(true)
  }, 200)
})
</script>

<template>
  <section
    class="relative flex h-full min-h-0 flex-col text-text"
    :aria-busy="loading || isRestoringScroll"
    :style="layoutStyle"
  >
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
      :small="uiStore.smallSongList"
      :hide-dividers="uiStore.hideSongListDividers"
      :columns="columns"
      :scroll-left="scrollLeft"
      :content-width="contentWidth"
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
      @toggle-size="uiStore.smallSongList = !uiStore.smallSongList"
      @toggle-dividers="uiStore.hideSongListDividers = !uiStore.hideSongListDividers"
      @toggle-column="toggleColumn"
      @batch-play="playSelected"
      @batch-add-to-playlist="actions?.addSelectedToPlaylist()"
      @batch-edit-tags="actions?.openBatchTags()"
      @batch-preference="actions?.setSelectedPreference($event)"
      @batch-lyric-flag="(flag, enabled) => actions?.setLyricFlag(flag, enabled)"
      @batch-reload-from-disk="actions?.reloadSelectedSongsFromDisk()"
      @batch-delete="actions?.requestDeleteSelectedSongs()"
      @open-tag-manager="tagManagerOpen = true"
      @clear-tag-filters="selectedTagIds = []"
      @update:source-filter="sourceFilter = String($event)"
    />
    <div class="relative min-h-0 flex-1 overflow-hidden">
      <div
        v-if="!loading && !filteredSongs.length"
        class="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-text-l"
        role="status"
      >
        {{ t('songList.empty') }}
      </div>
      <RecycleScroller
        ref="scroller"
        class="song-list-scroller custom-scrollbar overflow-y-auto"
        :class="{
          invisible: loading || isRestoringScroll || !filteredSongs.length,
          'song-list-scroller--small': uiStore.smallSongList
        }"
        :inert="loading || isRestoringScroll || !filteredSongs.length"
        :items="filteredSongs"
        :item-size="rowHeight"
        :disable-transform="uiStore.smallSongList === true"
        key-field="id"
        @scroll.passive="onListScroll"
        @resize="syncScrollLayout"
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
            :small="uiStore.smallSongList"
            :hide-dividers="uiStore.hideSongListDividers"
            :columns="columns"
            @play="playSong"
            @toggle-select="toggleSelect"
            @request-menu="(song, x, y) => actions?.openMenu(song, x, y)"
          />
        </template>
        <template #after>
          <div class="h-28" aria-hidden="true" />
        </template>
      </RecycleScroller>
    </div>
    <BaseBackTop
      v-if="!loading && filteredSongs.length"
      :target="backTopTarget"
      :scroll-to-top="backToTop"
      position="absolute"
      bottom="var(--ep-backtop-bottom, var(--song-list-backtop-bottom, 7rem))"
      class="song-list-backtop"
      :aria-label="t('songList.backToTop')"
    />
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

<style scoped>
.song-list-scroller {
  position: absolute;
  inset: 0;
}
.song-list-scroller :deep(.vue-recycle-scroller__item-wrapper) {
  min-width: var(--song-list-min-width);
}
/* Small text should not be promoted to a transform compositing layer. */
.song-list-scroller--small :deep(.vue-recycle-scroller__item-view) {
  will-change: auto;
}
</style>
