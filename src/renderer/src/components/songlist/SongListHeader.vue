<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

type SortField = 'title' | 'artist' | 'album' | 'duration'

const props = defineProps<{
  total: number
  keyword: string
  sortBy: SortField
  sortOrder: 'asc' | 'desc'
  selectionMode: boolean
  selectedCount: number
  allSelected: boolean
}>()

const emit = defineEmits<{
  'update:keyword': [value: string]
  sort: [field: SortField]
  refresh: []
  toggleSelection: []
  toggleAll: []
  batchPlay: []
  batchAddToPlaylist: []
  batchEditTags: []
  batchDelete: []
}>()

const { t } = useI18n()
const direction = computed(() => (props.sortOrder === 'asc' ? '↑' : '↓'))
</script>

<template>
  <header class="border-b border-[var(--color-border)]">
    <div class="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
      <p class="text-sm text-[var(--color-text-l)]">{{ t('songList.total', { count: total }) }}</p>
      <div class="flex items-center gap-2">
        <input
          :value="keyword"
          class="input-base h-8 w-52"
          :placeholder="t('songList.search')"
          @input="emit('update:keyword', ($event.target as HTMLInputElement).value)"
        />
        <button class="btn-hover text-sm" @click="emit('refresh')">
          {{ t('songList.refresh') }}
        </button>
        <button class="btn-hover text-sm" @click="emit('toggleSelection')">
          {{ selectionMode ? t('songList.cancelSelection') : t('songList.select') }}
        </button>
      </div>
    </div>

    <div v-if="selectionMode" class="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 pb-3 text-sm">
      <button class="btn-hover" @click="emit('toggleAll')">
        {{ allSelected ? t('songList.clearSelection') : t('songList.selectAll') }}
      </button>
      <button
        :disabled="selectedCount === 0"
        class="btn-hover disabled:opacity-40"
        @click="emit('batchPlay')"
      >
        {{ t('songList.play') }}
      </button>
      <button
        :disabled="selectedCount === 0"
        class="btn-hover disabled:opacity-40"
        @click="emit('batchAddToPlaylist')"
      >
        {{ t('songList.addToPlaylist') }}
      </button>
      <button
        :disabled="selectedCount === 0"
        class="btn-hover disabled:opacity-40"
        @click="emit('batchEditTags')"
      >
        {{ t('songList.editTags') }}
      </button>
      <button
        :disabled="selectedCount === 0"
        class="btn-hover disabled:opacity-40"
        @click="emit('batchDelete')"
      >
        {{ t('songList.delete') }}
      </button>
      <span class="text-[var(--color-text-l)]">{{
        t('songList.selected', { count: selectedCount })
      }}</span>
    </div>

    <div
      class="grid grid-cols-[3rem_minmax(12rem,1.8fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_4rem_2rem] items-center gap-3 px-5 py-2 text-xs text-[var(--color-text-l)]"
    >
      <span>#</span>
      <button class="text-left" @click="emit('sort', 'title')">
        {{ t('songList.title') }} <span v-if="sortBy === 'title'">{{ direction }}</span>
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
