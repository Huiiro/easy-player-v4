<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import SongListView from '@/components/songlist/SongListView.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'

type LibraryKind = 'album' | 'artist' | 'genre'
const props = defineProps<{ kind: LibraryKind }>()
const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const rawName = computed(() => String(route.query.name || ''))
const rawArtist = computed(() => String(route.query.artist || ''))
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
</script>

<template>
  <section class="flex h-full min-h-0 flex-col text-text">
    <header class="flex shrink-0 items-center gap-4 px-7 py-5">
      <div class="grid size-16 shrink-0 place-items-center rounded-xl bg-bg-l text-text-l">
        <SvgIcon :name="icon" class-name="size-8" />
      </div>
      <div class="min-w-0 flex-1">
        <p class="text-xs font-semibold tracking-[.12em] text-text-l">
          {{ t(`library.${kind}`) }}
        </p>
        <h1 class="mt-1 truncate text-2xl font-bold">{{ title }}</h1>
        <p v-if="subtitle" class="mt-1 truncate text-sm text-text-l">
          {{ subtitle }}
        </p>
      </div>
      <button class="btn-hover text-sm" @click="router.back()">{{ t('library.back') }}</button>
    </header>
    <SongListView class="min-h-0 flex-1" :source="source" />
  </section>
</template>
