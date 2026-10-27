<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import BaseMenu from '@/components/ui/BaseMenu.vue'
import type {
  OptionalSongColumn,
  SongListColumns,
  SongSortField as SortField
} from '@/utils/songListLayout'

interface SourceOption {
  label: string
  value: string
}

const props = defineProps<{
  total: number
  keyword: string
  sortBy: SortField
  sortOrder: 'asc' | 'desc'
  showAlbumSorts?: boolean
  showPlayTimeSort?: boolean
  showRelevanceSort?: boolean
  selectionMode: boolean
  selectedCount: number
  allSelected: boolean
  showFileName: boolean
  compact: boolean
  columns?: SongListColumns
  scrollLeft?: number
  contentWidth?: number
  showTagManager?: boolean
  activeTagFilterCount?: number
  sourceFilter?: string
  sourceOptions?: SourceOption[]
}>()

const emit = defineEmits<{
  'update:keyword': [value: string]
  compositionChange: [composing: boolean]
  sort: [field: SortField]
  refresh: []
  toggleSelection: []
  toggleAll: []
  selectNewest: []
  toggleFileName: []
  toggleCompact: []
  toggleColumn: [column: OptionalSongColumn]
  batchPlay: []
  batchAddToPlaylist: []
  batchEditTags: []
  batchReloadFromDisk: []
  batchDelete: []
  openTagManager: []
  clearTagFilters: []
  'update:sourceFilter': [value: string | number | (string | number)[]]
}>()

const { t } = useI18n()
function finishSearchComposition(event: CompositionEvent): void {
  emit('update:keyword', (event.target as HTMLInputElement).value)
  emit('compositionChange', false)
}
const direction = computed(() => (props.sortOrder === 'asc' ? '↑' : '↓'))
const sortFields = computed(() => [
  ...(props.showRelevanceSort
    ? [{ field: 'relevance' as const, label: t('songList.relevance') }]
    : []),
  { field: 'id' as const, label: t('songList.defaultSort') },
  {
    field: 'title' as const,
    label: props.showFileName ? t('songList.fileName') : t('songList.title')
  },
  { field: 'artist' as const, label: t('songList.artist') },
  { field: 'album' as const, label: t('songList.album') },
  { field: 'duration' as const, label: t('songList.duration') },
  { field: 'year' as const, label: t('songList.year') },
  { field: 'playTimes' as const, label: t('songList.playTimes') },
  ...(props.showAlbumSorts
    ? [
        { field: 'diskNo' as const, label: t('songList.discNumber') },
        { field: 'trackNo' as const, label: t('songList.trackNumber') }
      ]
    : []),
  ...(props.showPlayTimeSort ? [{ field: 'playTime' as const, label: t('songList.playTime') }] : [])
])
const activeSortLabel = computed(
  () =>
    sortFields.value.find((option) => option.field === props.sortBy)?.label ?? t('songList.sort')
)
const sortMenuItems = computed(() => {
  const items = sortFields.value.map(({ field, label }) => ({
    value: field,
    label: field === props.sortBy ? `${label} ${direction.value}` : label,
    onClick: () => emit('sort', field)
  }))
  return [
    ...items.filter((item) => item.value !== 'playTimes'),
    { type: 'divider' as const },
    { type: 'group' as const, children: items.filter((item) => item.value === 'playTimes') }
  ]
})
const columnMenuLabels = {
  genre: { show: 'songList.showGenreColumn', hide: 'songList.hideGenreColumn' },
  year: { show: 'songList.showYearColumn', hide: 'songList.hideYearColumn' },
  playTimes: { show: 'songList.showPlayTimesColumn', hide: 'songList.hidePlayTimesColumn' }
}
const moreMenuItems = computed(() => [
  {
    label: props.compact ? t('songList.normalMode') : t('songList.compactMode'),
    onClick: () => emit('toggleCompact')
  },
  {
    label: props.showFileName ? t('songList.showTitle') : t('songList.showFileName'),
    onClick: () => emit('toggleFileName')
  },
  { type: 'divider' as const },
  {
    type: 'group' as const,
    children: (['genre', 'year', 'playTimes'] as const).map((column) => ({
      label: t(columnMenuLabels[column][props.columns?.[column] ? 'hide' : 'show']),
      onClick: () => emit('toggleColumn', column)
    }))
  }
])
</script>

<template>
  <header class="border-b border-border">
    <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div class="flex items-center gap-1">
        <!-- multi select -->
        <button
          class="btn-hover header-control header-icon-control"
          :aria-label="selectionMode ? t('songList.cancelSelection') : t('songList.select')"
          :title="selectionMode ? t('songList.cancelSelection') : t('songList.select')"
          @click="emit('toggleSelection')"
        >
          <SvgIcon :name="selectionMode ? 'common-back-left' : 'common-task'" class-name="size-4" />
          <span class="sr-only"
            >{{ selectionMode ? t('songList.cancelSelection') : t('songList.select') }}
          </span>
        </button>
        <!-- search -->
        <div class="relative inline-block">
          <SvgIcon
            name="common-search"
            class="absolute left-2 top-1/2 -translate-y-1/2 text-text-l"
            class-name="size-4"
          />
          <input
            :value="keyword"
            class="ep-input ep-control--sm w-52 border text-xs outline-none search-input"
            :placeholder="t('songList.search')"
            :aria-label="t('songList.search')"
            @input="emit('update:keyword', ($event.target as HTMLInputElement).value)"
            @compositionstart="emit('compositionChange', true)"
            @compositionend="finishSearchComposition"
          />
          <button
            v-if="keyword"
            class="btn-hover absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center"
            :aria-label="t('songList.clearSearch')"
            :title="t('songList.clearSearch')"
            @click="emit('update:keyword', '')"
          >
            <SvgIcon name="common-close" class-name="size-3" />
          </button>
        </div>
        <!-- count text -->
        <p class="header-control text-text-l ml-2 cursor-default">
          {{ t('songList.total', { count: total }) }}
        </p>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <BaseMenu
          :model-value="sortBy"
          :items="sortMenuItems"
          size="sm"
          width="w-40"
          :max-height="360"
        >
          <template #trigger>
            <button class="btn-hover header-control px-2" :aria-label="t('songList.sort')">
              <SvgIcon name="common-sort" class-name="size-4" />
              {{ activeSortLabel }} {{ direction }}
            </button>
          </template>
        </BaseMenu>
        <!-- source -->
        <BaseSelect
          v-if="sourceOptions?.length"
          :model-value="sourceFilter || 'all'"
          :options="sourceOptions"
          :aria-label="t('songList.sourceFilter')"
          size="sm"
          class="w-40"
          @update:model-value="emit('update:sourceFilter', $event)"
        />
        <!-- tag -->
        <button
          v-if="showTagManager"
          class="btn-hover header-control header-icon-control"
          :aria-label="t('tags.manageAndFilter')"
          :title="t('tags.manageAndFilter')"
          @click="emit('openTagManager')"
        >
          <SvgIcon name="common-tag" class-name="size-4" />
          <span class="sr-only">{{ t('tags.manageAndFilter') }}</span>
        </button>
        <span
          v-if="activeTagFilterCount"
          class="rounded-full border border-primary px-2 py-0.5 text-xs text-primary"
        >
          {{ t('tags.activeFilterCount', { count: activeTagFilterCount }) }}
        </span>
        <button
          v-if="activeTagFilterCount"
          class="btn-hover header-control px-2 text-text-l"
          @click="emit('clearTagFilters')"
        >
          {{ t('tags.clearFilter') }}
        </button>
        <!-- refresh -->
        <button
          class="btn-hover header-control header-icon-control"
          :aria-label="t('songList.refresh')"
          :title="t('songList.refresh')"
          @click="emit('refresh')"
        >
          <SvgIcon name="common-refresh" class-name="size-4" />
          <span class="sr-only">{{ t('songList.refresh') }}</span>
        </button>
        <BaseMenu :items="moreMenuItems" size="sm" width="w-44">
          <template #trigger>
            <button
              class="btn-hover header-control header-icon-control"
              :aria-label="t('songList.more')"
              :title="t('songList.more')"
            >
              <SvgIcon name="menu-more-horizontal" class-name="size-4" />
            </button>
          </template>
        </BaseMenu>
      </div>
    </div>

    <div v-if="selectionMode" class="flex flex-wrap items-center gap-x-2 gap-y-2 px-5 pb-3 text-xs">
      <button class="btn-hover header-control px-2" @click="emit('toggleAll')">
        {{ allSelected ? t('songList.clearSelection') : t('songList.selectAll') }}
      </button>
      <button class="btn-hover header-control px-2" @click="emit('selectNewest')">
        {{ t('songList.selectNewest') }}
      </button>
      <button
        :disabled="selectedCount === 0"
        class="btn-hover header-control px-2 disabled:opacity-40"
        @click="emit('batchPlay')"
      >
        <SvgIcon name="play-play" class-name="size-4" />
        {{ t('songList.play') }}
      </button>
      <button
        :disabled="selectedCount === 0"
        class="btn-hover header-control px-2 disabled:opacity-40"
        @click="emit('batchAddToPlaylist')"
      >
        <SvgIcon name="common-plus" class-name="size-4" />
        {{ t('songList.addToPlaylist') }}
      </button>
      <button
        :disabled="selectedCount === 0"
        class="btn-hover header-control px-2 disabled:opacity-40"
        @click="emit('batchEditTags')"
      >
        <SvgIcon name="common-edit" class-name="size-4" />
        {{ t('songList.editTags') }}
      </button>
      <button
        :disabled="selectedCount === 0"
        class="btn-hover header-control px-2 disabled:opacity-40"
        @click="emit('batchReloadFromDisk')"
      >
        <SvgIcon name="common-refresh" class-name="size-4" />
        {{ t('songList.reloadFromDisk') }}
      </button>
      <button
        :disabled="selectedCount === 0"
        class="btn-hover header-control px-2 disabled:opacity-40"
        @click="emit('batchDelete')"
      >
        <SvgIcon name="common-delete" class-name="size-4" />
        {{ t('songList.delete') }}
      </button>
      <span class="text-text-l cursor-default">{{
        t('songList.selected', { count: selectedCount })
      }}</span>
    </div>

    <div class="overflow-hidden">
      <div
        class="song-list-columns grid items-center gap-3 px-5 py-2 text-xs text-text-l"
        :style="{
          width: contentWidth ? `${contentWidth}px` : undefined,
          transform: `translateX(-${scrollLeft || 0}px)`
        }"
      >
        <span>#</span>
        <span>{{ showFileName ? t('songList.fileName') : t('songList.title') }}</span>
        <span>{{ t('songList.artist') }}</span>
        <span>{{ t('songList.album') }}</span>
        <span v-if="columns?.genre">{{ t('songList.genre') }}</span>
        <span v-if="columns?.year" class="text-right">{{ t('songList.year') }}</span>
        <span v-if="columns?.playTimes" class="text-right">{{ t('songList.playTimes') }}</span>
        <span class="text-right">{{ t('songList.duration') }}</span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.song-list-columns {
  min-width: var(--song-list-min-width, 40.5rem);
  grid-template-columns: var(
    --song-list-grid-columns,
    3rem minmax(12rem, 1.8fr) minmax(8rem, 1fr) minmax(8rem, 1fr) 4rem
  );
}
.header-control {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  height: var(--ep-control-height-sm);
  min-height: var(--ep-control-height-sm);
  font-size: var(--text-xs);
  line-height: var(--text-xs--line-height);
  white-space: nowrap;
  transition-property: color, background-color, border-color, box-shadow, opacity;
}
.header-icon-control {
  width: var(--ep-control-height-sm);
  flex-shrink: 0;
}
.search-input {
  padding-left: 2rem !important;
  padding-right: 2rem !important;
}
</style>
