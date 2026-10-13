<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import type { Playlist } from './types'

const props = defineProps<{
  playlists: Playlist[]
  loading: boolean
  activePlaylistId: number | null
  busy: boolean
  isPlaying: boolean
}>()
const emit = defineEmits<{ play: [playlist: Playlist] }>()
const { t } = useI18n()
const router = useRouter()
function playlistCoverUrl(playlist: Playlist): string | null {
  return playlist.cover
    ? `easy-player-media://cover?path=${encodeURIComponent(playlist.cover)}`
    : null
}
</script>

<template>
  <section class="xl:col-span-2">
    <h2 class="mb-3 text-lg font-semibold">{{ t('home.playlists') }}</h2>
    <div v-if="props.playlists.length" class="flex flex-wrap gap-4">
      <article v-for="playlist in props.playlists" :key="playlist.id" class="w-36 shrink-0">
        <button
          class="group relative grid size-36 place-items-center overflow-hidden rounded-xl bg-bg-l"
          :aria-label="
            props.activePlaylistId === playlist.id && props.isPlaying
              ? t('footer.pause')
              : t('home.playPlaylist', { name: playlist.name })
          "
          :title="
            props.activePlaylistId === playlist.id && props.isPlaying
              ? t('footer.pause')
              : t('home.playPlaylist', { name: playlist.name })
          "
          :disabled="props.busy"
          @click="emit('play', playlist)"
        >
          <img
            v-if="playlistCoverUrl(playlist)"
            :src="playlistCoverUrl(playlist)!"
            class="size-full object-cover transition-transform duration-[var(--motion-duration-standard)] group-hover:scale-105"
            :alt="playlist.name"
          />
          <SvgIcon v-else name="common-music" class-name="size-12 text-text-l" />
          <span
            class="playlist-cover-overlay pointer-events-none absolute inset-0 bg-black/45 opacity-0 transition-opacity duration-[var(--motion-duration-standard)] group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden="true"
          />
          <span
            class="playlist-cover-action pointer-events-none absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 scale-90 place-items-center rounded-full bg-primary text-white opacity-0 shadow-lg transition-all duration-[var(--motion-duration-standard)] group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100"
          >
            <SvgIcon
              :name="
                props.activePlaylistId === playlist.id && props.isPlaying
                  ? 'play-pause'
                  : 'play-play'
              "
              class-name="size-6"
            />
          </span>
        </button>
        <button
          class="mt-2 block w-full truncate text-center text-sm font-medium hover:text-primary focus-visible:text-primary"
          :class="props.activePlaylistId === playlist.id ? 'text-primary' : ''"
          :aria-label="
            props.activePlaylistId === playlist.id
              ? `${playlist.name} · ${t('home.nowPlaying')}`
              : playlist.name
          "
          :title="playlist.name"
          @click="router.push(`/playlist/${playlist.id}`)"
        >
          {{ playlist.name }}
        </button>
        <p
          v-if="playlist.description"
          class="truncate text-center text-xs text-text-l"
          :title="playlist.description"
        >
          {{ playlist.description }}
        </p>
      </article>
    </div>
    <p v-else-if="!props.loading" class="py-6 text-center text-sm text-text-l">
      {{ t('home.noPlaylists') }}
    </p>
  </section>
</template>
