<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import type { Playlist } from './types'
import { LIKED_PLAYLIST_ID } from '@/constants/playlists'

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
  <section class="home-section">
    <div class="home-section-heading">
      <h2>{{ t('home.playlists') }}</h2>
    </div>
    <div v-if="props.playlists.length" class="home-collection-grid home-playlist-grid">
      <article
        v-for="playlist in props.playlists"
        :key="playlist.id"
        class="home-collection-card"
        :class="{ 'is-active': props.activePlaylistId === playlist.id }"
      >
        <button
          type="button"
          class="home-collection-cover group relative grid place-items-center overflow-hidden bg-bg-l"
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
          <SvgIcon
            v-else
            :name="playlist.id === LIKED_PLAYLIST_ID ? 'play-like-fill' : 'common-music'"
            class-name="size-12 text-text-l"
          />
          <span
            class="playlist-cover-overlay pointer-events-none absolute inset-0 bg-black/25 opacity-0 transition-opacity duration-[var(--motion-duration-standard)] group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden="true"
          />
          <span
            class="playlist-song-count pointer-events-none absolute bottom-3 left-3 rounded-md bg-black/45 px-2 py-1 text-xs text-white opacity-0 transition-opacity duration-[var(--motion-duration-standard)] group-hover:opacity-100 group-focus-visible:opacity-100"
          >
            {{ t('home.playlistSongCount', { count: playlist.songCount }) }}
          </span>
          <span
            class="playlist-cover-action pointer-events-none absolute bottom-3 right-3 grid size-11 translate-y-1 place-items-center rounded-full bg-primary text-white opacity-0 shadow-lg transition-all duration-[var(--motion-duration-standard)] group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100"
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
          type="button"
          class="home-collection-title block w-full truncate text-left text-sm font-medium hover:text-primary focus-visible:text-primary"
          :class="props.activePlaylistId === playlist.id ? 'text-primary' : ''"
          :aria-label="
            props.activePlaylistId === playlist.id
              ? `${playlist.name} · ${t('home.nowPlaying')}`
              : playlist.name
          "
          :title="playlist.name"
          @click="
            router.push(playlist.id === LIKED_PLAYLIST_ID ? '/liked' : `/playlist/${playlist.id}`)
          "
        >
          {{ playlist.name }}
        </button>
        <p
          v-if="playlist.description"
          class="home-collection-description truncate text-xs text-text-l"
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
