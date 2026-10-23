<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { useSongActivation } from '@/hooks/useSongActivation'
import { formatArtists } from '@/utils/artists'
import type { RankedSong } from './types'

const props = defineProps<{ songs: RankedSong[]; kind: 'played' | 'duration' }>()
const emit = defineEmits<{ play: [song: RankedSong] }>()
const { t } = useI18n()
const uiStore = useUIStore()
const activateSong = useSongActivation()

function coverUrl(song: RankedSong): string | null {
  return song.cover ? `easy-player-media://cover?path=${encodeURIComponent(song.cover)}` : null
}
function formatDuration(seconds: number): string {
  if (!seconds) return t('home.duration.zero')
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days) return t('home.duration.dayHour', { days, hours })
  if (hours) return t('home.duration.hourMinute', { hours, minutes })
  return t('home.duration.minute', { minutes: Math.max(1, minutes) })
}
</script>

<template>
  <article class="home-surface home-ranked">
    <div class="home-section-heading">
      <h2>
        {{ t(props.kind === 'played' ? 'home.topPlayed' : 'home.topDuration') }}
      </h2>
    </div>
    <ol v-if="props.songs.length" class="home-ranked-list">
      <li v-for="(song, index) in props.songs" :key="song.id">
        <button
          type="button"
          class="home-ranked-row"
          @click="activateSong($event, () => emit('play', song))"
          @dblclick="activateSong($event, () => emit('play', song))"
        >
          <span class="home-rank-number">{{ index + 1 }}</span>
          <img
            v-if="coverUrl(song)"
            :src="coverUrl(song)!"
            class="home-ranked-cover shrink-0 object-cover"
            :alt="song.title"
          />
          <span v-else class="home-ranked-cover grid shrink-0 place-items-center bg-hover">
            <SvgIcon name="common-music" class-name="size-4" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm">{{ song.title }}</span>
            <span class="block truncate text-xs text-text-l">{{
              formatArtists(
                song.artist,
                uiStore.artistSeparator,
                uiStore.normalizeMetadataSeparator
              ) || t('songList.unknownArtist')
            }}</span>
          </span>
          <span class="home-rank-value text-xs text-text-l">{{
            props.kind === 'played'
              ? t('home.playCount', { count: song.value })
              : formatDuration(song.value)
          }}</span>
        </button>
      </li>
    </ol>
    <p v-else class="py-8 text-center text-sm text-text-l">{{ t('home.noStats') }}</p>
  </article>
</template>
