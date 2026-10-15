<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import SongListView from '@/components/songlist/SongListView.vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useMessage } from '@/components/ui/useMessage'
import type { PagedLibrarySongs } from '@/types/library'
import eventBus from '@/utils/eventBus'
import { LIKED_PLAYLIST_ID } from '@/constants/playlists'

const { t } = useI18n()
const player = usePlayerStore()
const { success, warning, error: showError } = useMessage()
const coverInput = ref<HTMLInputElement | null>(null)
const cover = ref<string | null>(null)
const customCover = ref<string | null>(null)
const coverUrl = computed(() =>
  cover.value ? `easy-player-media://cover?path=${encodeURIComponent(cover.value)}` : null
)

async function loadCover(): Promise<void> {
  const response = await window.api.database.command('getLikedPlaylistCover')
  if (!response.success) return
  const data = response.data as { cover: string | null; customCover: string | null }
  cover.value = data.cover
  customCover.value = data.customCover
}

async function selectCustomCover(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const response = await window.api.database.command('setLikedPlaylistCustomCover', {
      path: window.api.audio.getFilePath(file)
    })
    if (!response.success) {
      showError(response.error || t('playlist.coverSetFailed'))
      return
    }
    await loadCover()
    eventBus.emit('playlistsChanged')
    success(t('playlist.coverSet'))
  } finally {
    input.value = ''
  }
}

async function resetCover(): Promise<void> {
  const response = await window.api.database.command('setLikedPlaylistCustomCover', { path: null })
  if (!response.success) {
    showError(response.error || t('playlist.coverResetFailed'))
    return
  }
  await loadCover()
  eventBus.emit('playlistsChanged')
  success(t('playlist.coverReset'))
}

onMounted(() => {
  void loadCover()
  eventBus.on('songPreferenceChanged', loadCover)
  eventBus.on('scanFinished', loadCover)
})
onBeforeUnmount(() => {
  eventBus.off('songPreferenceChanged', loadCover)
  eventBus.off('scanFinished', loadCover)
})

async function playLikedSongs(): Promise<void> {
  const response = await window.api.database.command('querySongs', { preference: 1 })
  if (!response.success) {
    showError(response.error || t('playlist.playFailed'))
    return
  }
  const songs = (response.data as PagedLibrarySongs).data.filter((song) => song.songStatus !== 0)
  if (!songs.length) {
    warning(t('playlist.empty'))
    return
  }
  if (!(await player.playCollection(songs, songs[0].id, LIKED_PLAYLIST_ID)))
    showError(t('playlist.playFailed'))
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col text-text">
    <header class="flex shrink-0 items-center gap-5 px-6 py-6">
      <button
        class="group relative grid size-40 shrink-0 place-items-center overflow-hidden rounded-2xl bg-bg-l shadow-lg"
        :title="t('playlist.setCover')"
        @click="coverInput?.click()"
      >
        <img
          v-if="coverUrl"
          :src="coverUrl"
          class="size-full object-cover"
          :alt="t('playlist.likedSongs')"
        />
        <SvgIcon v-else name="play-like-fill" class-name="size-12 text-text-l" />
        <span
          class="absolute inset-0 grid place-items-center bg-black/45 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
        >
          {{ t('playlist.changeCover') }}
        </span>
      </button>
      <input
        ref="coverInput"
        class="hidden"
        type="file"
        accept="image/*"
        @change="selectCustomCover"
      />
      <div class="min-w-0">
        <p class="text-xs font-semibold tracking-[.12em] text-text-l">{{ t('playlist.label') }}</p>
        <h1 class="mt-2 text-3xl font-bold">{{ t('playlist.likedSongs') }}</h1>
        <p class="mt-2 text-sm text-text-l">{{ t('playlist.likedDescription') }}</p>
        <button v-if="customCover" class="btn-hover mt-2 px-2 py-1.5 text-xs" @click="resetCover">
          {{ t('playlist.resetCover') }}
        </button>
        <button
          class="btn-hover-base mt-4 rounded-lg bg-primary px-3 py-1.5 text-sm text-white hover:text-white"
          @click="playLikedSongs"
        >
          {{ t('playlist.play') }}
        </button>
      </div>
    </header>
    <SongListView class="min-h-0 flex-1" :source="{ type: 'liked' }" />
  </section>
</template>
