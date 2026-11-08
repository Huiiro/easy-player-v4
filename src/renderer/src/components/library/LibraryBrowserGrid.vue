<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseMenu from '@/components/ui/BaseMenu.vue'
import LibraryItemCard from './LibraryItemCard.vue'
import { queryLibraryItems, type LibraryKind, type GridItem } from '@/services/libraryBrowser'
import { useScrollPosition } from '@/hooks/useScrollPosition'
import type { LibrarySortBy } from '../../../../shared/librarySort'
type SortOrder = 'asc' | 'desc'
import { useUIStore } from '@/stores/ui/uiStore'

const props = defineProps<{ kind: LibraryKind }>()
const { t } = useI18n()
const router = useRouter()
const ui = useUIStore()
const keyword = ref('')
const separator = computed(() => (props.kind === 'genre' ? ui.genreSeparator : ui.artistSeparator))
const order = computed<SortOrder>({
  get: () => (ui.librarySortOrder[props.kind] === 'desc' ? 'desc' : 'asc'),
  set: (value) => {
    ui.librarySortOrder[props.kind] = value
  }
})
const sortOptions = computed<{ label: string; value: LibrarySortBy }[]>(() => [
  { label: t('library.sortName'), value: 'name' as const },
  ...(props.kind === 'genre'
    ? []
    : [
        { label: t('library.sortAddedAt'), value: 'addedAt' as const },
        { label: t('library.sortPlayCount'), value: 'playCount' as const }
      ]),
  { label: t('library.sortSongCount'), value: 'songCount' as const },
  ...(props.kind === 'album' ? [{ label: t('library.sortYear'), value: 'year' as const }] : [])
])
const sortBy = computed<LibrarySortBy>({
  get: () => {
    const value = ui.librarySortBy[props.kind]
    return sortOptions.value.some((option) => option.value === value) ? value : 'name'
  },
  set: (value) => {
    ui.librarySortBy[props.kind] = value
  }
})
const sortIcon = computed(() => (order.value === 'asc' ? 'common-sort' : 'common-sort-converse'))
const sortDirectionIcon = computed(() =>
  order.value === 'asc' ? 'arrow-arrow-sm-up' : 'arrow-arrow-sm-down'
)
const activeSortLabel = computed(
  () => sortOptions.value.find((option) => option.value === sortBy.value)?.label
)
function selectSort(field: LibrarySortBy): void {
  if (sortBy.value === field) order.value = order.value === 'asc' ? 'desc' : 'asc'
  else {
    sortBy.value = field
    order.value = field === 'playCount' ? 'desc' : 'asc'
  }
}
const sortMenuItems = computed(() => {
  const items = sortOptions.value.map(({ value, label }) => ({
    value,
    label,
    trailingIcon: value === sortBy.value ? sortDirectionIcon.value : undefined,
    onClick: () => selectSort(value)
  }))
  const playCountItems = items.filter((item) => item.value === 'playCount')
  return [
    ...items.filter((item) => item.value !== 'playCount'),
    ...(playCountItems.length
      ? [{ type: 'divider' as const }, { type: 'group' as const, children: playCountItems }]
      : [])
  ]
})
const cardSize = computed<number>({
  get: () => {
    const value = ui.libraryCardSize[props.kind]
    return value === 224 ? 224 : 176
  },
  set: (value) => {
    ui.libraryCardSize[props.kind] = value === 224 ? 224 : 176
  }
})
const loading = ref(true)
let loadRevision = 0
const items = ref<GridItem[]>([])
const total = ref<number | null>(null)
const countLabel = computed(() =>
  total.value === null
    ? '—'
    : keyword.value.trim()
      ? t('library.filteredItems', { count: items.value.length, total: total.value })
      : t('library.totalItems', { count: total.value })
)
const visibleCoverKeys = ref(new Set<string>())
const scrollContainer = ref<HTMLElement | null>(null)
let coverObserver: IntersectionObserver | null = null
let activated = false

const title = computed(() => t(`library.${props.kind}s`))
const searchPlaceholder = computed(() =>
  props.kind === 'album' ? t('library.searchAlbums') : t('library.search', { type: title.value })
)
const icon = computed(() =>
  props.kind === 'album' ? 'common-album' : props.kind === 'artist' ? 'common-user' : 'common-genre'
)
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`
}))
const layoutMenuItems = computed(() => [
  {
    type: 'group' as const,
    label: t('library.layout'),
    children: [
      { label: t('library.defaultLayout'), value: 176 },
      { label: t('library.largerLayout'), value: 224 }
    ]
  }
])
const {
  saveScrollPosition,
  scheduleScrollPositionSave,
  clearSavedScrollPosition,
  restoreScrollPosition
} = useScrollPosition(
  scrollContainer,
  computed(() => `library-scroll-position:${props.kind}`)
)

function itemKey(item: GridItem): string {
  return `${item.value}-${item.subtitle || ''}`
}
function coverUrl(cover: string | null): string | null {
  return cover
    ? `easy-player-media://cover-thumb?path=${encodeURIComponent(cover)}&size=${cardSize.value}`
    : null
}
function shouldLoadCover(item: GridItem): boolean {
  return visibleCoverKeys.value.has(itemKey(item))
}
function observeCover(element: unknown, item: GridItem): void {
  if (!(element instanceof Element) || !item.cover || shouldLoadCover(item)) return
  const key = itemKey(item)
  element.setAttribute('data-cover-key', key)
  coverObserver?.observe(element)
}
async function load(
  restoreScroll = false,
  resetScroll = false,
  updateTotal = false
): Promise<void> {
  loading.value = true
  const revision = ++loadRevision
  try {
    const query = (search: string): Promise<GridItem[]> =>
      queryLibraryItems(
        props.kind,
        order.value,
        search,
        separator.value,
        t('library.unknown'),
        ui.albumGroupByName,
        t('library.variousArtists'),
        sortBy.value
      )
    const search = keyword.value.trim()
    const [result, allItems] = await Promise.all([
      query(search),
      search && (updateTotal || total.value === null) ? query('') : null
    ])
    if (revision === loadRevision) {
      const keys = new Set(result.map(itemKey))
      visibleCoverKeys.value = new Set([...visibleCoverKeys.value].filter((key) => keys.has(key)))
      items.value = result
      if (!search) total.value = result.length
      else if (allItems) total.value = allItems.length
      if (resetScroll) {
        await nextTick()
        if (revision === loadRevision) scrollContainer.value?.scrollTo({ top: 0, behavior: 'auto' })
      } else if (restoreScroll) {
        await restoreScrollPosition()
      }
    }
  } finally {
    if (revision === loadRevision) {
      loading.value = false
    }
  }
}
function open(item: GridItem): void {
  saveScrollPosition()
  const query =
    props.kind === 'album'
      ? {
          name: item.value,
          artist: ui.albumGroupByName ? '' : item.subtitleValue || '',
          cover: item.cover || ''
        }
      : { name: item.value, cover: item.cover || '' }
  void router.push({ path: `/${props.kind}/detail`, query })
}
function refresh(): void {
  saveScrollPosition()
  void load(true, false, true)
}

watch(
  [keyword, order, sortBy, separator, () => (props.kind === 'album' ? ui.albumGroupByName : false)],
  (value, previous) => {
    clearSavedScrollPosition()
    void load(false, true, value[3] !== previous[3] || value[4] !== previous[4])
  }
)
watch(cardSize, () => {
  clearSavedScrollPosition()
  scrollContainer.value?.scrollTo({ top: 0, behavior: 'auto' })
})
onMounted(() => {
  coverObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const key = (entry.target as HTMLElement).dataset.coverKey
        if (key) visibleCoverKeys.value = new Set([...visibleCoverKeys.value, key])
        coverObserver?.unobserve(entry.target)
      }
    },
    { rootMargin: '320px 0px' }
  )
  void load(true)
})
onBeforeUnmount(() => {
  loadRevision++
  coverObserver?.disconnect()
})
onActivated(() => {
  if (activated) void load(true, false, true)
  activated = true
})
</script>

<template>
  <section class="flex h-full min-h-0 flex-col pt-6 text-text" :aria-busy="loading">
    <header class="mb-5 flex flex-wrap items-center justify-between gap-3 px-6">
      <div class="flex min-w-0 flex-wrap items-center gap-3">
        <div class="flex items-baseline gap-2">
          <h1 class="text-xl font-bold">{{ title }}</h1>
          <span class="text-xs text-text-l" aria-live="polite">{{ countLabel }}</span>
        </div>
        <div class="relative block h-[var(--ep-control-height-sm)] w-64 max-w-full">
          <SvgIcon
            name="common-search"
            class-name="pointer-events-none absolute left-1.5 top-1/2 z-10 size-4 -translate-y-1/2 text-text-l"
          />
          <input
            v-model="keyword"
            class="ep-input ep-control--sm library-search absolute inset-0 w-full border text-xs outline-none"
            :placeholder="searchPlaceholder"
            :aria-label="searchPlaceholder"
          />
          <button
            v-if="keyword"
            class="ep-header-button absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center"
            :aria-label="t('library.clearSearch')"
            :title="t('library.clearSearch')"
            @click="keyword = ''"
          >
            <SvgIcon name="common-close" class-name="size-3" />
          </button>
        </div>
      </div>
      <div class="flex flex-wrap items-center gap-1.5">
        <BaseMenu
          :model-value="sortBy"
          :items="sortMenuItems"
          size="sm"
          width="w-48"
          :max-height="360"
        >
          <template #trigger>
            <BaseButton
              class="ep-header-button"
              variant="ghost"
              size="sm"
              :aria-label="t('library.sort')"
            >
              <div class="flex items-center justify-center gap-1">
                <SvgIcon :name="sortIcon" class-name="size-4.5" />
                {{ activeSortLabel }}
              </div>
            </BaseButton>
          </template>
        </BaseMenu>
        <BaseButton
          class="ep-header-button"
          variant="ghost"
          size="sm"
          icon-only
          :title="t('library.refresh')"
          :aria-label="t('library.refresh')"
          @click="refresh"
        >
          <SvgIcon name="common-refresh" class-name="size-[15px]" />
        </BaseButton>
        <BaseMenu
          :model-value="cardSize"
          :items="layoutMenuItems"
          size="sm"
          width="w-48"
          @update:model-value="cardSize = Number($event)"
        >
          <template #trigger>
            <BaseButton
              class="ep-header-button"
              variant="ghost"
              size="sm"
              icon-only
              :title="t('library.more')"
              :aria-label="t('library.more')"
            >
              <SvgIcon name="menu-more-horizontal" class-name="size-4.5" />
            </BaseButton>
          </template>
        </BaseMenu>
      </div>
    </header>
    <div class="relative min-h-0 flex-1 overflow-hidden">
      <p
        v-if="!loading && !items.length"
        class="absolute inset-0 flex items-center justify-center px-6 py-8 text-center text-sm text-text-l"
        role="status"
      >
        {{ t('library.empty') }}
      </p>
      <div
        ref="scrollContainer"
        class="custom-scrollbar absolute inset-0 grid auto-rows-min content-start gap-2 overflow-y-auto pb-24 pr-1"
        :class="{ invisible: loading || !items.length }"
        :inert="loading || !items.length"
        :style="gridStyle"
        @scroll.passive="scheduleScrollPositionSave"
      >
        <button
          v-for="item in items"
          :key="itemKey(item)"
          :ref="(element) => observeCover(element, item)"
          type="button"
          class="group min-w-0 rounded-xl p-2 text-left transition-colors hover:bg-hover"
          @click="open(item)"
        >
          <LibraryItemCard
            :name="item.name"
            :subtitle="item.subtitle"
            :cover="shouldLoadCover(item) ? coverUrl(item.cover) : null"
            :icon="icon"
            :circle="kind === 'artist'"
            :badge="t('library.songCount', { count: item.count })"
          />
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.library-search {
  padding-left: 2rem !important;
  padding-right: 2rem !important;
}
</style>
