<script setup lang="ts">
import { computed, onActivated, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import LibraryItemCard from './LibraryItemCard.vue'
import { queryLibraryItems, type LibraryKind, type GridItem } from '@/services/libraryBrowser'
import { useScrollPosition } from '@/hooks/useScrollPosition'
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
const cardSize = computed<number>({
  get: () => {
    const value = ui.libraryCardSize[props.kind]
    return [144, 176, 224].includes(value) ? value : 176
  },
  set: (value) => {
    ui.libraryCardSize[props.kind] = value
  }
})
const loading = ref(false)
let loadRevision = 0
const items = ref<GridItem[]>([])
const visibleCoverKeys = ref(new Set<string>())
const scrollContainer = ref<HTMLElement | null>(null)
let coverObserver: IntersectionObserver | null = null
let activated = false

const title = computed(() => t(`library.${props.kind}s`))
const icon = computed(() =>
  props.kind === 'album' ? 'common-album' : props.kind === 'artist' ? 'common-user' : 'common-genre'
)
const gridStyle = computed(() => ({
  gridTemplateColumns: `repeat(auto-fill, minmax(${cardSize.value}px, 1fr))`
}))
const cardSizeOptions = computed(() => [
  { label: t('library.cardSizeSmall'), value: 144 },
  { label: t('library.cardSizeMedium'), value: 176 },
  { label: t('library.cardSizeLarge'), value: 224 }
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
async function load(restoreScroll = false): Promise<void> {
  loading.value = true
  const revision = ++loadRevision
  try {
    const result = await queryLibraryItems(
      props.kind,
      order.value,
      keyword.value,
      separator.value,
      t('library.unknown')
    )
    if (revision === loadRevision) items.value = result
  } finally {
    if (revision === loadRevision) {
      loading.value = false
      if (restoreScroll) await restoreScrollPosition()
    }
  }
}
function open(item: GridItem): void {
  saveScrollPosition()
  const query =
    props.kind === 'album'
      ? {
          name: item.value,
          artist: item.subtitleValue || '',
          cover: item.cover || ''
        }
      : { name: item.value, cover: item.cover || '' }
  void router.push({ path: `/${props.kind}/detail`, query })
}
function refresh(): void {
  saveScrollPosition()
  visibleCoverKeys.value = new Set()
  void load(true)
}

watch([keyword, order, separator], () => {
  visibleCoverKeys.value = new Set()
  clearSavedScrollPosition()
  void load()
})
watch(cardSize, () => {
  visibleCoverKeys.value = new Set()
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
  if (activated) void load(true)
  activated = true
})
</script>

<template>
  <section class="flex h-full min-h-0 flex-col pt-6 text-text">
    <header class="mb-5 flex flex-wrap items-center justify-between gap-3 px-6">
      <div class="flex items-center gap-3">
        <h1 class="text-xl font-bold">{{ title }}</h1>
        <div
          class="group relative block h-8 transition-[width] duration-[var(--motion-duration-standard)]"
          :class="keyword ? 'w-56' : 'w-8 hover:w-56 focus-within:w-56'"
        >
          <SvgIcon
            name="common-search"
            class-name="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-text-l"
          />
          <input
            v-model="keyword"
            class="input-base library-search absolute inset-0 h-8 w-full transition-opacity duration-[var(--motion-duration-fast)]"
            :class="
              keyword
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100'
            "
            :placeholder="t('library.search', { type: title })"
          />
          <button
            v-if="keyword"
            class="btn-hover absolute right-1 top-1/2 grid size-5 -translate-y-1/2 place-items-center"
            :aria-label="t('library.clearSearch')"
            :title="t('library.clearSearch')"
            @click="keyword = ''"
          >
            <SvgIcon name="common-close" class-name="size-3" />
          </button>
        </div>
      </div>
      <div class="flex items-center gap-2">
        <button
          class="btn-hover grid size-8 place-items-center"
          :title="t('library.refresh')"
          :aria-label="t('library.refresh')"
          @click="refresh"
        >
          <SvgIcon name="common-refresh" class-name="size-4" />
        </button>
        <button
          class="btn-hover grid size-8 place-items-center"
          :title="t('library.sort')"
          @click="order = order === 'asc' ? 'desc' : 'asc'"
        >
          <SvgIcon
            :name="order === 'asc' ? 'common-sort' : 'common-sort-converse'"
            class-name="size-4"
          />
        </button>
        <BaseSelect
          v-model="cardSize"
          :options="cardSizeOptions"
          :title="t('library.cardSize')"
          class="w-30"
        />
      </div>
    </header>
    <p v-if="loading" class="py-8 text-sm text-text-l">{{ t('library.loading') }}</p>
    <p v-else-if="!items.length" class="py-8 text-sm text-text-l">
      {{ t('library.empty') }}
    </p>
    <div
      v-else
      ref="scrollContainer"
      class="custom-scrollbar grid min-h-0 flex-1 auto-rows-min content-start gap-4 overflow-y-auto pb-24 pr-1"
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
  </section>
</template>

<style scoped>
.library-search {
  padding-left: 2rem !important;
  padding-right: 2rem !important;
}
</style>
