<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { formatArtists } from '@/utils/artists'
import type { RankedSong } from './types'

const props = defineProps<{ songs: RankedSong[]; kind: 'played' | 'duration' }>()
const emit = defineEmits<{ play: [song: RankedSong] }>()
const { t } = useI18n()
const uiStore = useUIStore()

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
  <article class="home-surface rounded-xl p-5">
    <h2 class="mb-3 text-lg font-semibold">
      {{ t(props.kind === 'played' ? 'home.topPlayed' : 'home.topDuration') }}
    </h2>
    <ol v-if="props.songs.length" class="space-y-1">
      <li v-for="(song, index) in props.songs" :key="song.id">
        <button
          class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-hover"
          @dblclick="emit('play', song)"
        >
          <span class="w-5 text-center text-sm text-text-l">{{ index + 1 }}</span>
          <img
            v-if="coverUrl(song)"
            :src="coverUrl(song)!"
            class="size-9 shrink-0 rounded-md object-cover"
            :alt="song.title"
          />
          <span v-else class="grid size-9 shrink-0 place-items-center rounded-md bg-hover">
            <SvgIcon name="common-music" class-name="size-4" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm">{{ song.title }}</span>
            <span class="block truncate text-xs text-text-l">{{
              formatArtists(
                song.artist,
                uiStore.artistSeparator,
                uiStore.normalizeArtistSeparator
              ) || t('songList.unknownArtist')
            }}</span>
          </span>
          <span class="text-xs text-text-l">{{
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
