<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'

type SortField = 'id' | 'title' | 'artist' | 'album' | 'duration' | 'playTime'
interface SourceOption {
  label: string
  value: string
}

const props = defineProps<{
  total: number
  keyword: string
  sortBy: SortField
  sortOrder: 'asc' | 'desc'
  selectionMode: boolean
  selectedCount: number
  allSelected: boolean
  showFileName: boolean
  showTagManager?: boolean
  activeTagFilterCount?: number
  sourceFilter?: string
  sourceOptions?: SourceOption[]
}>()

const emit = defineEmits<{
  'update:keyword': [value: string]
  sort: [field: SortField]
  refresh: []
  toggleSelection: []
  toggleAll: []
  selectNewest: []
  toggleFileName: []
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
const direction = computed(() => (props.sortOrder === 'asc' ? '↑' : '↓'))
</script>

<template>
  <header class="border-b border-border">
    <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <div class="flex items-center gap-1">
        <!-- multi select -->
        <button
          class="btn-hover grid size-8 place-items-center"
          :aria-label="selectionMode ? t('songList.cancelSelection') : t('songList.select')"
          :title="selectionMode ? t('songList.cancelSelection') : t('songList.select')"
          @click="emit('toggleSelection')"
        >
          <SvgIcon :name="selectionMode ? 'common-back-left' : 'common-task'" class-name="size-5" />
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
            class="input-base h-8 w-52 search-input"
            :placeholder="t('songList.search')"
            @input="emit('update:keyword', ($event.target as HTMLInputElement).value)"
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
        <p class="text-sm text-text-l text-nowrap ml-2 cursor-default btn-hover">
          {{ t('songList.total', { count: total }) }}
        </p>
      </div>
      <div class="flex items-center gap-4">
        <!-- fileName -->
        <button
          class="btn-hover px-2 text-xs"
          :aria-label="showFileName ? t('songList.showTitle') : t('songList.showFileName')"
          :title="showFileName ? t('songList.showTitle') : t('songList.showFileName')"
          @click="emit('toggleFileName')"
        >
          {{ showFileName ? t('songList.fileName') : t('songList.title') }}
          <span class="sr-only">
            {{ showFileName ? t('songList.showTitle') : t('songList.showFileName') }}
          </span>
        </button>
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
          class="btn-hover grid size-4 place-items-center"
          :aria-label="t('tags.manageAndFilter')"
          :title="t('tags.manageAndFilter')"
          @click="emit('openTagManager')"
        >
          <SvgIcon name="common-tag" class-name="size-4.5" />
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
          class="btn-hover text-xs text-text-l"
          @click="emit('clearTagFilters')"
        >
          {{ t('tags.clearFilter') }}
        </button>
        <!-- refresh -->
        <button
          class="btn-hover grid size-4 place-items-center"
          :aria-label="t('songList.refresh')"
          :title="t('songList.refresh')"
          @click="emit('refresh')"
        >
          <SvgIcon name="common-refresh" class-name="size-4" />
          <span class="sr-only">{{ t('songList.refresh') }}</span>
        </button>
      </div>
    </div>

    <div v-if="selectionMode" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pb-3 text-sm">
      <button class="btn-hover" @click="emit('toggleAll')">
        {{ allSelected ? t('songList.clearSelection') : t('songList.selectAll') }}
      </button>
      <button class="btn-hover" @click="emit('selectNewest')">
        {{ t('songList.selectNewest') }}
      </button>
      <button
        :disabled="selectedCount === 0"
        class="flex gap-1 items-center btn-hover disabled:opacity-40"
        @click="emit('batchPlay')"
      >
        <SvgIcon name="play-play" class-name="size-4" />
        {{ t('songList.play') }}
      </button>
      <button
        :disabled="selectedCount === 0"
        class="flex gap-1 items-center btn-hover disabled:opacity-40"
        @click="emit('batchAddToPlaylist')"
      >
        <SvgIcon name="common-plus" class-name="size-4" />
        {{ t('songList.addToPlaylist') }}
      </button>
      <button
        :disabled="selectedCount === 0"
        class="flex gap-1 items-center btn-hover disabled:opacity-40"
        @click="emit('batchEditTags')"
      >
        <SvgIcon name="common-edit" class-name="size-4" />
        {{ t('songList.editTags') }}
      </button>
      <button
        :disabled="selectedCount === 0"
        class="flex gap-1 items-center btn-hover disabled:opacity-40"
        @click="emit('batchReloadFromDisk')"
      >
        <SvgIcon name="common-refresh" class-name="size-4" />
        {{ t('songList.reloadFromDisk') }}
      </button>
      <button
        :disabled="selectedCount === 0"
        class="flex gap-1 items-center btn-hover disabled:opacity-40"
        @click="emit('batchDelete')"
      >
        <SvgIcon name="common-delete" class-name="size-4" />
        {{ t('songList.delete') }}
      </button>
      <span class="text-text-l cursor-default">{{
        t('songList.selected', { count: selectedCount })
      }}</span>
    </div>

    <div
      class="grid grid-cols-[3rem_minmax(12rem,1.8fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_4rem_2rem] items-center gap-3 px-5 py-2 text-xs text-text-l"
    >
      <button class="text-left" @click="emit('sort', 'id')">
        # <span v-if="sortBy === 'id'">{{ direction }}</span>
      </button>
      <button class="text-left" @click="emit('sort', 'title')">
        {{ showFileName ? t('songList.fileName') : t('songList.title') }}
        <span v-if="sortBy === 'title'">{{ direction }}</span>
      </button>
      <button class="text-left" @click="emit('sort', 'artist')">
        {{ t('songList.artist') }} <span v-if="sortBy === 'artist'">{{ direction }}</span>
      </button>
      <button class="text-left" @click="emit('sort', 'album')">
        {{ t('songList.album') }} <span v-if="sortBy === 'album'">{{ direction }}</span>
      </button>
      <button class="text-right" @click="emit('sort', 'duration')">
        {{ t('songList.duration') }} <span v-if="sortBy === 'duration'">{{ direction }}</span>
      </button>
      <span />
    </div>
  </header>
</template>

<style scoped>
.search-input {
  padding-left: 2rem !important;
  padding-right: 2rem !important;
}
</style>
