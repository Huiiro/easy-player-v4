<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'

type LibraryKind = 'album' | 'artist' | 'genre'
type SortOrder = 'asc' | 'desc'

interface AlbumRow {
  albumName: string | null
  artistName: string | null
  songCount: number
  albumCover: string | null
}
interface ArtistRow {
  artistName: string | null
  songCount: number
  artistCover: string | null
}
interface GenreRow {
  name: string
  count: number
}
interface GridItem {
  name: string
  value: string
  subtitle?: string
  subtitleValue?: string
  count: number
  cover: string | null
}

const props = defineProps<{ kind: LibraryKind }>()
const { t } = useI18n()
const router = useRouter()
const keyword = ref('')
const order = ref<SortOrder>('asc')
const cardSize = ref(176)
const loading = ref(false)
const items = ref<GridItem[]>([])

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

function valueOrUnknown(value: string | null, kind: LibraryKind): string {
  if (value?.trim()) return value
  return `__easy_player_unknown_${kind}__`
}
function displayName(value: string | null): string {
  return value?.trim() || t('library.unknown')
}
function coverUrl(cover: string | null): string | null {
  return cover ? `easy-player-media://cover?path=${encodeURIComponent(cover)}` : null
}
async function load(): Promise<void> {
  loading.value = true
  try {
    const action =
      props.kind === 'album'
        ? 'queryAlbums'
        : props.kind === 'artist'
          ? 'queryArtists'
          : 'queryGenres'
    const response = await window.api.database.command(action, {
      sort: order.value,
      search: keyword.value
    })
    if (!response.success) {
      items.value = []
      return
    }
    if (props.kind === 'album') {
      items.value = (response.data as AlbumRow[]).map((item) => ({
        name: displayName(item.albumName),
        value: valueOrUnknown(item.albumName, 'album'),
        subtitle: displayName(item.artistName),
        subtitleValue: valueOrUnknown(item.artistName, 'artist'),
        count: item.songCount,
        cover: item.albumCover
      }))
    } else if (props.kind === 'artist') {
      items.value = (response.data as ArtistRow[]).map((item) => ({
        name: displayName(item.artistName),
        value: valueOrUnknown(item.artistName, 'artist'),
        count: item.songCount,
        cover: item.artistCover
      }))
    } else {
      items.value = (response.data as GenreRow[]).map((item) => ({
        name: item.name === 'unknown_genre' ? t('library.unknown') : item.name,
        value: item.name === 'unknown_genre' ? '__easy_player_unknown_genre__' : item.name,
        count: item.count,
        cover: null
      }))
    }
  } finally {
    loading.value = false
  }
}
function open(item: GridItem): void {
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

watch([keyword, order], () => void load())
onMounted(() => void load())
</script>

<template>
  <section class="flex h-full min-h-0 flex-col py-6 text-text">
    <header class="mb-5 flex flex-wrap items-center justify-between gap-3 px-6">
      <div class="flex items-center gap-3">
        <h1 class="text-xl font-bold">{{ title }}</h1>
        <div
          class="group relative block h-8 transition-[width] duration-200"
          :class="keyword ? 'w-56' : 'w-8 hover:w-56 focus-within:w-56'"
        >
          <SvgIcon
            name="common-search"
            class-name="pointer-events-none absolute left-2.5 top-1/2 z-10 size-3.5 -translate-y-1/2 text-text-l"
          />
          <input
            v-model="keyword"
            class="input-base library-search absolute inset-0 h-8 w-full transition-opacity duration-150"
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
      class="custom-scrollbar grid min-h-0 flex-1 auto-rows-min content-start gap-4 overflow-y-auto pb-20 pr-1"
      :style="gridStyle"
    >
      <div
        v-for="item in items"
        :key="`${item.value}-${item.subtitle || ''}`"
        class="group min-w-0 rounded-xl p-2 text-left transition-colors hover:bg-hover"
        @click="open(item)"
      >
        <div
          class="relative aspect-square bg-bg-l"
          :class="props.kind === 'artist' ? 'rounded-full' : 'rounded-xl'"
        >
          <div
            class="size-full overflow-hidden"
            :class="props.kind === 'artist' ? 'rounded-full' : 'rounded-lg'"
          >
            <img
              v-if="coverUrl(item.cover)"
              :src="coverUrl(item.cover)!"
              class="size-full object-cover transition-transform duration-300 group-hover:scale-105"
              :alt="item.name"
            />
            <span v-else class="grid size-full place-items-center text-text-l">
              <SvgIcon :name="icon" class-name="size-12" />
            </span>
          </div>
          <span
            class="absolute rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white"
            :class="props.kind === 'artist' ? 'bottom-1 right-[9%]' : 'bottom-1 right-1'"
          >
            {{ t('library.songCount', { count: item.count }) }}
          </span>
        </div>
        <p class="mt-2 truncate text-sm font-medium">{{ item.name }}</p>
        <p v-if="item.subtitle" class="mt-0.5 truncate text-xs text-text-l">
          {{ item.subtitle }}
        </p>
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
