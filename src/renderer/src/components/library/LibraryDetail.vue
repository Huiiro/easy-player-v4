<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import SongListView from '@/components/songlist/SongListView.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import CollectionHeaderActions from '@/components/collection/CollectionHeaderActions.vue'

type LibraryKind = 'album' | 'artist' | 'genre'
const props = defineProps<{ kind: LibraryKind }>()
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const songList = ref<InstanceType<typeof SongListView> | null>(null)
const playing = ref(false)
const rawName = computed(() => String(route.query.name || ''))
const rawArtist = computed(() => String(route.query.artist || ''))
const rawCover = computed(() => String(route.query.cover || ''))
const coverFailed = ref(false)
const coverUrl = computed(() =>
  rawCover.value ? `easy-player-media://cover?path=${encodeURIComponent(rawCover.value)}` : null
)
const title = computed(() =>
  rawName.value.startsWith('__easy_player_unknown_') ? t('library.unknown') : rawName.value
)
const subtitle = computed(() =>
  props.kind === 'album' && rawArtist.value
    ? rawArtist.value.startsWith('__easy_player_unknown_')
      ? t('library.unknown')
      : rawArtist.value
    : ''
)
const icon = computed(() =>
  props.kind === 'album' ? 'common-album' : props.kind === 'artist' ? 'common-user' : 'common-genre'
)
const source = computed(() =>
  props.kind === 'album'
    ? { type: 'album' as const, album: rawName.value, artist: rawArtist.value || undefined }
    : props.kind === 'artist'
      ? { type: 'artist' as const, artist: rawName.value }
      : { type: 'genre' as const, genre: rawName.value }
)

async function playAll(): Promise<void> {
  const list = songList.value
  if (!list || list.loading || playing.value) return
  playing.value = true
  try {
    await list.playAll()
  } finally {
    playing.value = false
  }
}

watch(coverUrl, () => {
  coverFailed.value = false
})
</script>

<template>
  <section class="flex h-full min-h-0 flex-col text-text">
    <header class="flex shrink-0 flex-wrap items-center gap-4 px-6 py-5">
      <div
        class="grid size-16 shrink-0 place-items-center overflow-hidden bg-bg-l text-text-l"
        :class="kind === 'artist' ? 'rounded-full' : 'rounded-xl'"
      >
        <img
          v-if="coverUrl && !coverFailed"
          :src="coverUrl"
          class="size-full object-cover"
          :alt="title"
          @error="coverFailed = true"
        />
        <SvgIcon v-else :name="icon" class-name="size-8" />
      </div>
      <div class="min-w-0 flex-1 basis-48">
        <p class="text-xs font-semibold tracking-[.12em] text-text-l">
          {{ t(`library.${kind}`) }}
        </p>
        <h1 class="mt-1 truncate text-2xl font-bold">{{ title }}</h1>
        <p v-if="subtitle" class="mt-1 truncate text-sm text-text-l">
          {{ subtitle }}
        </p>
      </div>
      <CollectionHeaderActions
        :disabled="!songList || songList.loading"
        :playing="playing"
        @play="playAll"
        @back="router.back()"
      />
    </header>
    <SongListView ref="songList" class="min-h-0 flex-1" :source="source" />
  </section>
</template>
