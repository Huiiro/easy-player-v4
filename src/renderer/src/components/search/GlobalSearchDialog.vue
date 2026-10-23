<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { RecycleScroller } from 'vue-virtual-scroller'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseInput from '@/components/ui/BaseInput.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { useMessage } from '@/components/ui/useMessage'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
import { useSongActivation } from '@/hooks/useSongActivation'
import { useStatisticsStore } from '@/stores/statistics/statisticsStore'
import { querySongList } from '@/services/songListQuery'
import { playSearchResult } from '@/services/searchPlayback'
import { formatArtists } from '@/utils/artists'
import type { LibrarySong } from '@/types/library'

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const { t } = useI18n()
const { error: showError } = useMessage()
const route = useRoute()
const player = usePlayerStore()
const ui = useUIStore()
const activateSong = useSongActivation()
const statistics = useStatisticsStore()
const input = ref<InstanceType<typeof BaseInput> | null>(null)
const keyword = ref('')
const composing = ref(false)
const hasQuery = computed(() => Boolean(keyword.value.trim()) && !composing.value)
const songs = ref<LibrarySong[]>([])
const loading = ref(false)
const searchError = ref('')
const playing = ref(false)
let revision = 0
let timer: ReturnType<typeof setTimeout> | undefined
let offSearchIndex: (() => void) | undefined

function focusSearch(): void {
  input.value?.focus()
  input.value?.select()
}
function invalidateSearch(): void {
  revision++
  if (timer) clearTimeout(timer)
  timer = undefined
}
async function search(): Promise<void> {
  const text = keyword.value.trim()
  if (!props.modelValue || composing.value || !text) return
  const request = ++revision
  loading.value = true
  searchError.value = ''
  try {
    const result = await querySongList({
      source: { type: 'songs' },
      search: text,
      tags: [],
      sourceFilter: 'all',
      artistSeparator: ui.artistSeparator,
      genreSeparator: ui.genreSeparator,
      statistics
    })
    if (request !== revision || !props.modelValue) return
    songs.value = result.sort(
      (left, right) => (right.searchScore ?? 0) - (left.searchScore ?? 0) || right.id - left.id
    )
  } catch (error) {
    if (request === revision && props.modelValue) searchError.value = String(error)
  } finally {
    if (request === revision && props.modelValue) loading.value = false
  }
}
watch([keyword, composing], () => {
  invalidateSearch()
  songs.value = []
  searchError.value = ''
  loading.value = props.modelValue && !composing.value && Boolean(keyword.value.trim())
  if (!loading.value) return
  timer = setTimeout(() => {
    timer = undefined
    void search()
  }, 200)
})
watch(
  () => props.modelValue,
  (open) => {
    invalidateSearch()
    offSearchIndex?.()
    offSearchIndex = undefined
    if (!open) return
    keyword.value = ''
    composing.value = false
    songs.value = []
    loading.value = false
    searchError.value = ''
    offSearchIndex = window.api.database.onSearchIndexChanged(() => {
      if (!timer) void search()
    })
    void nextTick(focusSearch)
  },
  { immediate: true }
)

watch(
  () => route.fullPath,
  () => {
    if (props.modelValue) emit('update:modelValue', false)
  }
)
onBeforeUnmount(() => {
  invalidateSearch()
  offSearchIndex?.()
})
function finishComposition(event: CompositionEvent): void {
  keyword.value = (event.target as HTMLInputElement).value
  composing.value = false
}
function coverUrl(song: LibrarySong): string | undefined {
  return song.cover
    ? `easy-player-media://cover-thumb?path=${encodeURIComponent(song.cover)}&size=128`
    : undefined
}
function duration(seconds: number | null): string {
  const total = Math.max(0, Math.floor(seconds ?? 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
async function playSong(song: LibrarySong): Promise<void> {
  if (song.songStatus === 0 || playing.value) return
  playing.value = true
  try {
    if (!(await playSearchResult(player, song))) showError(t('playlist.playFailed'))
  } catch {
    showError(t('playlist.playFailed'))
  } finally {
    playing.value = false
  }
}
defineExpose({ focusSearch })
</script>

<template>
  <BaseDialog
    :model-value="props.modelValue"
    :title="t('header.globalSearch')"
    :show-close="false"
    :width="760"
    panel-class="global-search-panel overflow-hidden !mt-[min(18dvh,144px)] !mb-0"
    header-class="sr-only"
    body-class="!p-0 min-h-0"
    @update:model-value="emit('update:modelValue', $event)"
    @after-enter="focusSearch"
  >
    <div class="p-4" :class="hasQuery ? 'border-b border-border' : ''">
      <BaseInput
        ref="input"
        v-model="keyword"
        class="global-search-input"
        size="lg"
        autocomplete="off"
        :spellcheck="false"
        :placeholder="t('songList.search')"
        :aria-label="t('songList.search')"
        @compositionstart="composing = true"
        @compositionend="finishComposition"
      >
        <template #prefix
          ><SvgIcon name="common-search" class-name="size-4 text-text-l"
        /></template>
      </BaseInput>
    </div>
    <div v-if="hasQuery" class="global-search-results" :aria-busy="loading">
      <p v-if="loading" class="px-5 py-8 text-center text-sm text-text-l" role="status">
        {{ t('songList.loading') }}
      </p>
      <p v-else-if="searchError" class="px-5 py-8 text-center text-sm text-danger" role="alert">
        {{ searchError }}
      </p>
      <p v-else-if="!songs.length" class="px-5 py-8 text-center text-sm text-text-l" role="status">
        {{ t('songList.empty') }}
      </p>
      <RecycleScroller
        v-else
        class="custom-scrollbar h-full overflow-y-auto"
        :items="songs"
        :item-size="68"
        key-field="id"
      >
        <template #default="{ item: song }">
          <button
            type="button"
            class="global-search-result flex h-[68px] w-full items-center gap-3 px-4 text-left transition-colors hover:bg-hover focus-visible:bg-hover"
            :class="player.currentQueueSong?.id === song.id ? 'bg-primary/10 text-primary' : ''"
            :disabled="song.songStatus === 0 || playing"
            :aria-label="`${t('songList.play')} ${song.title}`"
            @click="activateSong($event, () => playSong(song))"
            @dblclick="activateSong($event, () => playSong(song))"
            @keydown.enter.prevent="playSong(song)"
            @keydown.space.prevent="playSong(song)"
          >
            <span
              class="grid size-10 shrink-0 place-items-center overflow-hidden rounded-lg bg-bg-l"
            >
              <img v-if="song.cover" :src="coverUrl(song)" alt="" class="size-full object-cover" />
              <SvgIcon v-else name="common-music" class-name="size-5 text-text-l" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate text-sm font-medium">{{ song.title }}</span>
              <span class="mt-1 block truncate text-xs text-text-l">
                {{
                  formatArtists(song.artist, ui.artistSeparator, ui.normalizeMetadataSeparator) ||
                  t('songList.unknownArtist')
                }}
                <template v-if="song.album"> · {{ song.album }}</template>
              </span>
            </span>
            <span class="shrink-0 text-xs tabular-nums text-text-l">{{
              duration(song.duration)
            }}</span>
          </button>
        </template>
      </RecycleScroller>
    </div>
  </BaseDialog>
</template>

<style scoped>
.global-search-results {
  height: min(52dvh, 440px);
  min-height: min(160px, calc(100dvh - 180px));
  overflow: hidden;
}
.global-search-result:disabled {
  cursor: default;
}
</style>
