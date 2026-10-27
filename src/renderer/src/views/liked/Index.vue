<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import PlaylistHeader from '@/components/playlist/PlaylistHeader.vue'
import SongListView from '@/components/songlist/SongListView.vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
import { useMessage } from '@/components/ui/useMessage'
import type { PagedLibrarySongs } from '@/types/library'
import eventBus from '@/utils/eventBus'
import { LIKED_PLAYLIST_ID } from '@/constants/playlists'
import CropperDialog from '@/components/cropper/CropperDialog.vue'

const { t } = useI18n()
const player = usePlayerStore()
const router = useRouter()
const { playlistHeaderCollapsed: headerCollapsed } = storeToRefs(useUIStore())
const playing = ref(false)
const songListSource = { type: 'liked' as const }
const { success, warning, error: showError } = useMessage()
const coverInput = ref<HTMLInputElement | null>(null)
const cropDialogVisible = ref(false)
const cropImageUrl = ref<string | null>(null)
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

function clearCropImage(): void {
  if (cropImageUrl.value) URL.revokeObjectURL(cropImageUrl.value)
  cropImageUrl.value = null
}

function selectCustomCover(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  clearCropImage()
  cropImageUrl.value = URL.createObjectURL(file)
  cropDialogVisible.value = true
}

async function applyCoverCrop(dataUrl: string): Promise<void> {
  try {
    const response = await window.api.database.command('setLikedPlaylistCustomCover', {
      path: null,
      dataUrl
    })
    if (!response.success) {
      showError(response.error || t('playlist.coverSetFailed'))
      return
    }
    await loadCover()
    eventBus.emit('playlistsChanged')
    success(t('playlist.coverSet'))
  } catch {
    showError(t('playlist.coverSetFailed'))
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
  eventBus.on('songPreferencesCleared', loadCover)
  eventBus.on('scanFinished', loadCover)
})
onBeforeUnmount(() => {
  clearCropImage()
  eventBus.off('songPreferenceChanged', loadCover)
  eventBus.off('songPreferencesCleared', loadCover)
  eventBus.off('scanFinished', loadCover)
})
watch(cropDialogVisible, (visible) => {
  if (!visible) clearCropImage()
})

async function playLikedSongs(): Promise<void> {
  if (playing.value) return
  playing.value = true
  try {
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
    if (!(await player.playCollection(songs, null, LIKED_PLAYLIST_ID)))
      showError(t('playlist.playFailed'))
  } finally {
    playing.value = false
  }
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col text-text">
    <PlaylistHeader
      v-model:collapsed="headerCollapsed"
      :title="t('playlist.likedSongs')"
      :cover-url="coverUrl"
      icon="play-like-fill"
      :playing="playing"
      @select-cover="coverInput?.click()"
      @play="playLikedSongs"
      @back="router.back()"
    >
      <template #cover-input>
        <input
          ref="coverInput"
          class="hidden"
          type="file"
          accept="image/*"
          @change="selectCustomCover"
        />
      </template>
      <template #details>
        <p class="mt-2 text-sm text-text-l">{{ t('playlist.likedDescription') }}</p>
      </template>
      <template #actions>
        <button v-if="customCover" class="btn-hover px-2 py-1.5 text-xs" @click="resetCover">
          {{ t('playlist.resetCover') }}
        </button>
      </template>
    </PlaylistHeader>
    <SongListView class="min-h-0 flex-1" :source="songListSource" />
  </section>
  <CropperDialog v-model="cropDialogVisible" :image-url="cropImageUrl" @confirm="applyCoverCrop" />
</template>
