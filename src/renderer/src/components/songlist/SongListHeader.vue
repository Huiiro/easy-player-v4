<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import BaseMenu from '@/components/ui/BaseMenu.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import type {
  OptionalSongColumn,
  SongListColumns,
  SongSortField as SortField
} from '@/utils/songListLayout'

interface SourceOption {
  label: string
  value: string
  group?: string
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
  small?: boolean
  hideDividers?: boolean
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
  toggleSize: []
  toggleDividers: []
  toggleColumn: [column: OptionalSongColumn]
  batchPlay: []
  batchAddToPlaylist: []
  batchEditTags: []
  batchPreference: [preference: -1 | 0 | 1]
  batchLyricFlag: [flag: 'disableNetwork' | 'instrumental', enabled: boolean]
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
const sortIcon = computed(() =>
  props.sortOrder === 'asc' ? 'common-sort' : 'common-sort-converse'
)
const sortDirectionIcon = computed(() =>
  props.sortOrder === 'asc' ? 'arrow-arrow-sm-up' : 'arrow-arrow-sm-down'
)
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
    label,
    trailingIcon: field === props.sortBy ? sortDirectionIcon.value : undefined,
    onClick: () => emit('sort', field)
  }))
  return [
    ...items.filter((item) => item.value !== 'playTimes'),
    { type: 'divider' as const },
    { type: 'group' as const, children: items.filter((item) => item.value === 'playTimes') }
  ]
})
const activeSourceLabel = computed(
  () =>
    props.sourceOptions?.find((option) => option.value === (props.sourceFilter || 'all'))?.label ??
    t('songList.sourceFilter')
)
const sourceMenuItems = computed(() => {
  const options = props.sourceOptions ?? []
  const ungrouped = options.filter((option) => !option.group)
  const groups = [
    ...new Set(options.filter((option) => option.group).map((option) => option.group))
  ]
  return [
    ...ungrouped,
    ...groups.flatMap((label, index) => [
      ...(ungrouped.length || index ? [{ type: 'divider' as const }] : []),
      {
        type: 'group' as const,
        label,
        children: options.filter((option) => option.group === label)
      }
    ])
  ]
})
const columnMenuLabels = {
  genre: { show: 'songList.showGenreColumn', hide: 'songList.hideGenreColumn' },
  year: { show: 'songList.showYearColumn', hide: 'songList.hideYearColumn' },
  playTimes: { show: 'songList.showPlayTimesColumn', hide: 'songList.hidePlayTimesColumn' },
  disableNetworkLyrics: {
    show: 'songList.showDisableNetworkLyrics',
    hide: 'songList.hideDisableNetworkLyrics'
  },
  instrumental: { show: 'songList.showInstrumental', hide: 'songList.hideInstrumental' },
  preference: { show: 'songList.showPreferenceColumn', hide: 'songList.hidePreferenceColumn' },
  remoteSource: { show: 'songList.showRemoteSourceColumn', hide: 'songList.hideRemoteSourceColumn' }
}
function columnMenuItems(columns: OptionalSongColumn[]): {
  label: string
  onClick: () => void
}[] {
  return columns.map((column) => ({
    label: t(columnMenuLabels[column][props.columns?.[column] ? 'hide' : 'show']),
    onClick: () => emit('toggleColumn', column)
  }))
}
const moreMenuItems = computed(() => [
  {
    type: 'group' as const,
    label: t('songList.displayOptions'),
    children: [
      {
        label: t(props.small ? 'songList.standardLayout' : 'songList.smallLayout'),
        onClick: () => emit('toggleSize')
      },
      {
        label: props.compact ? t('songList.normalMode') : t('songList.compactMode'),
        onClick: () => emit('toggleCompact')
      },
      {
        label: props.showFileName ? t('songList.showTitle') : t('songList.showFileName'),
        onClick: () => emit('toggleFileName')
      },
      {
        label: t(props.hideDividers ? 'songList.showDividers' : 'songList.hideDividers'),
        onClick: () => emit('toggleDividers')
      }
    ]
  },
  { type: 'divider' as const },
  {
    type: 'group' as const,
    label: t('songList.informationColumns'),
    children: columnMenuItems(['genre', 'year', 'playTimes'])
  },
  { type: 'divider' as const },
  {
    type: 'group' as const,
    label: t('songList.flagColumns'),
    children: columnMenuItems([
      'disableNetworkLyrics',
      'instrumental',
      'preference',
      'remoteSource'
    ])
  }
])
const batchMenuItems = computed(() => [
  {
    type: 'group' as const,
    label: t('songList.preferenceColumn'),
    children: [
      {
        label: t('songList.like'),
        icon: 'play-like',
        disabled: props.selectedCount === 0,
        onClick: () => emit('batchPreference', 1)
      },
      {
        label: t('songList.dislike'),
        icon: 'play-dislike',
        disabled: props.selectedCount === 0,
        onClick: () => emit('batchPreference', -1)
      },
      {
        label: t('songList.clearFeedback'),
        icon: 'common-close',
        disabled: props.selectedCount === 0,
        onClick: () => emit('batchPreference', 0)
      }
    ]
  },
  ...(['disableNetwork', 'instrumental'] as const).flatMap((flag) => [
    { type: 'divider' as const },
    {
      type: 'group' as const,
      label: t(flag === 'disableNetwork' ? 'lyrics.source.network' : 'lyrics.instrumental'),
      children: [
        {
          label: t(
            flag === 'disableNetwork' ? 'songList.addDisableNetwork' : 'songList.addInstrumental'
          ),
          icon: flag === 'disableNetwork' ? 'common-no-internet-add' : 'common-music-notes-add',
          disabled: props.selectedCount === 0,
          onClick: () => emit('batchLyricFlag', flag, true)
        },
        {
          label: t(
            flag === 'disableNetwork'
              ? 'songList.removeDisableNetwork'
              : 'songList.removeInstrumental'
          ),
          icon:
            flag === 'disableNetwork' ? 'common-no-internet-remove' : 'common-music-notes-remove',
          disabled: props.selectedCount === 0,
          onClick: () => emit('batchLyricFlag', flag, false)
        }
      ]
    }
  ])
])
</script>

<template>
  <header class="border-b border-border">
    <div class="flex flex-wrap items-center justify-between gap-2.5 px-5 py-2.5">
      <div class="flex items-center gap-1">
        <!-- multi select -->
        <button
          class="header-button header-control header-icon-control"
          :aria-label="selectionMode ? t('songList.cancelSelection') : t('songList.select')"
          :title="selectionMode ? t('songList.cancelSelection') : t('songList.select')"
          @click="emit('toggleSelection')"
        >
          <SvgIcon :name="selectionMode ? 'common-back-left' : 'common-task'" class-name="size-4" />
          <span class="sr-only">
            {{ selectionMode ? t('songList.cancelSelection') : t('songList.select') }}
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
            class="ep-input ep-control--sm w-64 border text-xs outline-none search-input"
            :placeholder="t('songList.search')"
            :aria-label="t('songList.search')"
            @input="emit('update:keyword', ($event.target as HTMLInputElement).value)"
            @compositionstart="emit('compositionChange', true)"
            @compositionend="finishSearchComposition"
          />
          <button
            v-if="keyword"
            class="header-button absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center"
            :aria-label="t('songList.clearSearch')"
            :title="t('songList.clearSearch')"
            @click="emit('update:keyword', '')"
          >
            <SvgIcon name="common-close" class-name="size-3" />
          </button>
        </div>
        <!-- count text -->
        <p class="header-control text-text-l ml-1.5 cursor-default">
          {{ t('songList.total', { count: total }) }}
        </p>
      </div>
      <div class="flex flex-wrap items-center justify-end gap-1.5">
        <!-- order -->
        <BaseMenu
          :model-value="sortBy"
          :items="sortMenuItems"
          size="sm"
          width="w-48"
          :max-height="360"
        >
          <template #trigger>
            <button class="header-button header-control px-2" :aria-label="t('songList.sort')">
              <SvgIcon :name="sortIcon" class-name="size-4.5" />
              {{ activeSortLabel }}
            </button>
          </template>
        </BaseMenu>
        <!-- source -->
        <BaseMenu
          v-if="sourceOptions?.length"
          :model-value="sourceFilter || 'all'"
          :items="sourceMenuItems"
          size="sm"
          width="w-56"
          :max-height="360"
          @update:model-value="emit('update:sourceFilter', $event)"
        >
          <template #trigger>
            <button
              class="header-button header-control px-2"
              :aria-label="t('songList.sourceFilter')"
              :title="activeSourceLabel"
            >
              <SvgIcon name="common-database" class-name="size-4 shrink-0" />
              <span class="max-w-44 truncate">{{ activeSourceLabel }}</span>
            </button>
          </template>
        </BaseMenu>
        <!-- tag -->
        <button
          v-if="showTagManager"
          class="header-button header-control header-icon-control"
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
          class="header-button header-control px-2 text-text-l"
          @click="emit('clearTagFilters')"
        >
          {{ t('tags.clearFilter') }}
        </button>
        <!-- refresh -->
        <button
          class="header-button header-control header-icon-control"
          :aria-label="t('songList.refresh')"
          :title="t('songList.refresh')"
          @click="emit('refresh')"
        >
          <SvgIcon name="common-refresh" class-name="size-[15px]" />
          <span class="sr-only">{{ t('songList.refresh') }}</span>
        </button>
        <!-- more -->
        <BaseMenu :items="moreMenuItems" size="sm" width="w-56" :max-height="440">
          <template #trigger>
            <button
              class="header-button header-control header-icon-control"
              :aria-label="t('songList.more')"
              :title="t('songList.more')"
            >
              <SvgIcon name="menu-more-horizontal" class-name="size-4.5" />
            </button>
          </template>
        </BaseMenu>
      </div>
    </div>

    <div v-if="selectionMode" class="flex flex-wrap items-center gap-0.5 px-5 pb-2.5 text-xs">
      <BaseButton class="header-button" size="sm" variant="ghost" @click="emit('toggleAll')">
        <template #left>
          <SvgIcon
            :name="allSelected ? 'common-close' : 'common-check'"
            :class-name="allSelected ? 'size-3' : 'size-4'"
          />
        </template>
        {{ allSelected ? t('songList.clearSelection') : t('songList.selectAll') }}
      </BaseButton>
      <BaseButton class="header-button" size="sm" variant="ghost" @click="emit('selectNewest')">
        <template #left><SvgIcon name="common-select-multiple" class-name="size-3.5" /></template>
        {{ t('songList.selectNewest') }}
      </BaseButton>
      <BaseButton
        class="header-button"
        size="sm"
        variant="ghost"
        :disabled="selectedCount === 0"
        @click="emit('batchPlay')"
      >
        <template #left><SvgIcon name="play-play" class-name="size-4" /></template>
        {{ t('songList.play') }}
      </BaseButton>
      <BaseButton
        class="header-button"
        size="sm"
        variant="ghost"
        :disabled="selectedCount === 0"
        @click="emit('batchAddToPlaylist')"
      >
        <template #left><SvgIcon name="common-plus" class-name="size-4" /></template>
        {{ t('songList.addToPlaylist') }}
      </BaseButton>
      <BaseButton
        class="header-button"
        size="sm"
        variant="ghost"
        :disabled="selectedCount === 0"
        @click="emit('batchEditTags')"
      >
        <template #left><SvgIcon name="common-edit" class-name="size-4" /></template>
        {{ t('songList.editTags') }}
      </BaseButton>
      <BaseMenu :items="batchMenuItems" size="sm" width="w-60" :max-height="400">
        <template #trigger>
          <BaseButton
            class="header-button"
            size="sm"
            variant="ghost"
            :disabled="selectedCount === 0"
          >
            <template #left><SvgIcon name="common-preference" class-name="size-3" /></template>
            {{ t('songList.batchFeedback') }}
            <template #right><SvgIcon name="arrow-arrow-down" class-name="size-3" /></template>
          </BaseButton>
        </template>
      </BaseMenu>
      <BaseButton
        class="header-button"
        size="sm"
        variant="ghost"
        :disabled="selectedCount === 0"
        @click="emit('batchReloadFromDisk')"
      >
        <template #left><SvgIcon name="common-refresh" class-name="size-3.5" /></template>
        {{ t('songList.reloadFromDisk') }}
      </BaseButton>
      <BaseButton
        size="sm"
        variant="ghost"
        :disabled="selectedCount === 0"
        class="header-button text-danger!"
        @click="emit('batchDelete')"
      >
        <template #left><SvgIcon name="common-delete" class-name="size-4" /></template>
        {{ t('songList.delete') }}
      </BaseButton>
      <span class="header-control px-2 text-text-l cursor-default">
        {{ t('songList.selected', { count: selectedCount }) }}
      </span>
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
        <span v-if="columns?.year" class="text-center">{{ t('songList.year') }}</span>
        <span v-if="columns?.playTimes" class="text-center">{{ t('songList.playTimes') }}</span>
        <span
          v-if="columns?.disableNetworkLyrics"
          class="flex items-center justify-center"
          :title="t('lyrics.disableNetwork')"
          :aria-label="t('lyrics.disableNetwork')"
          role="img"
        >
          <SvgIcon name="common-no-internet" class-name="size-3.5" />
        </span>
        <span
          v-if="columns?.instrumental"
          class="flex items-center justify-center"
          :title="t('lyrics.instrumental')"
          :aria-label="t('lyrics.instrumental')"
          role="img"
        >
          <SvgIcon name="common-music-notes" class-name="size-3.5" />
        </span>
        <span
          v-if="columns?.preference"
          class="flex items-center justify-center"
          :title="t('songList.preferenceColumn')"
          :aria-label="t('songList.preferenceColumn')"
          role="img"
        >
          <SvgIcon name="play-like" class-name="size-3.5" />
        </span>
        <span
          v-if="columns?.remoteSource"
          class="flex items-center justify-center"
          :title="t('songList.remoteSourceColumn')"
          :aria-label="t('songList.remoteSourceColumn')"
          role="img"
        >
          <SvgIcon name="menu-remote" class-name="size-3.5" />
        </span>
        <span class="text-right">{{ t('songList.duration') }}</span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.song-list-columns {
  column-gap: var(--song-list-gap, 0.75rem);
  padding-inline: var(--song-list-padding-inline, 1.25rem);
  min-width: var(--song-list-min-width, 38.5rem);
  grid-template-columns: var(
    --song-list-grid-columns,
    2.5rem minmax(12rem, 2fr) minmax(7rem, 1fr) minmax(8rem, 1.2fr) 3.5rem
  );
}
.header-button {
  background: transparent;
  font-weight: 400;
  transition: color var(--motion-duration-standard);
}
.header-button.ep-button {
  padding-inline: 0.5rem;
  gap: 0.25rem;
}
.header-button.header-control:not(.header-icon-control) {
  padding-inline: 0.375rem;
}
.header-button:enabled {
  cursor: pointer;
}
.header-button:enabled:hover {
  background: transparent;
  color: var(--color-primary);
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
  transition-property: color, opacity;
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
