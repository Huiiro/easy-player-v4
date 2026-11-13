<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { storeToRefs } from 'pinia'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import SongListView from '@/components/songlist/SongListView.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import PlaylistHeader from '@/components/playlist/PlaylistHeader.vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
import type { LibrarySong, PagedLibrarySongs } from '@/types/library'
import eventBus from '@/utils/eventBus'
import { useMessage } from '@/components/ui/useMessage'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import CropperDialog from '@/components/cropper/CropperDialog.vue'

interface Playlist {
  id: number
  name: string
  cover: string | null
  customCover: string | null
  description: string | null
  createdAt: string
}

const route = useRoute()
const router = useRouter()
const playlist = ref<Playlist | null>(null)
const loading = ref(true)
const coverInput = ref<HTMLInputElement | null>(null)
const cropDialogVisible = ref(false)
const cropImageUrl = ref<string | null>(null)
const deleteDialogOpen = ref(false)
const editName = ref('')
const editDescription = ref('')
const editingField = ref<'name' | 'description' | null>(null)
const saving = ref(false)
const playing = ref(false)
const { playlistHeaderCollapsed: headerCollapsed } = storeToRefs(useUIStore())
const player = usePlayerStore()
const { success, warning, error: showError } = useMessage()
const { t, locale } = useI18n()
const playlistId = computed(() => Number(route.params.id))
const songListSource = computed(() => ({ type: 'playlist' as const, id: playlistId.value }))
const coverUrl = computed(() =>
  playlist.value?.cover
    ? `easy-player-media://cover?path=${encodeURIComponent(playlist.value.cover)}`
    : null
)

async function load(): Promise<void> {
  loading.value = true
  try {
    const response = await window.api.database.command('getPlaylist', { id: playlistId.value })
    playlist.value = response.success ? (response.data as Playlist) : null
  } finally {
    loading.value = false
  }
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
    const response = await window.api.database.command('setPlaylistCustomCover', {
      id: playlistId.value,
      path: null,
      dataUrl
    })
    if (response.success) {
      await load()
      eventBus.emit('playlistsChanged')
      success(t('playlist.coverSet'))
    } else {
      showError(response.error || t('playlist.coverSetFailed'))
    }
  } catch {
    showError(t('playlist.coverSetFailed'))
  }
}
async function resetCover(): Promise<void> {
  const response = await window.api.database.command('setPlaylistCustomCover', {
    id: playlistId.value,
    path: null
  })
  if (response.success) {
    await load()
    eventBus.emit('playlistsChanged')
    success(t('playlist.coverReset'))
  } else {
    showError(response.error || t('playlist.coverResetFailed'))
  }
}
function formatCreatedAt(value: string): string {
  const date = new Date(value.replace(' ', 'T'))
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(date)
}
function startEditing(field: 'name' | 'description'): void {
  if (!playlist.value) return
  editName.value = playlist.value.name
  editDescription.value = playlist.value.description || ''
  editingField.value = field
}
function cancelEditing(): void {
  editingField.value = null
}
async function savePlaylist(): Promise<void> {
  if (!playlist.value || !editingField.value || saving.value) return
  saving.value = true
  try {
    const response = await window.api.database.command('updatePlaylist', {
      id: playlist.value.id,
      input: { name: editName.value, description: editDescription.value.trim() || null }
    })
    if (!response.success) {
      showError(response.error || t('playlist.updateFailed'))
      return
    }
    editingField.value = null
    await load()
    eventBus.emit('playlistsChanged')
    success(t('playlist.updated'))
  } finally {
    saving.value = false
  }
}
async function playPlaylist(): Promise<void> {
  if (!playlist.value || playing.value) return
  playing.value = true
  try {
    const response = await window.api.database.command('queryPlaylistSongs', {
      playlistId: playlist.value.id,
      query: {}
    })
    if (!response.success) {
      showError(response.error || t('playlist.playFailed'))
      return
    }
    const data = response.data as PagedLibrarySongs
    const songs = data.data.filter((song) => song.songStatus !== 0) as LibrarySong[]
    if (!songs.length) {
      warning(t('playlist.empty'))
      return
    }
    const played = await player.playCollection(songs, null, playlist.value.id)
    if (!played) showError(t('playlist.playFailed'))
  } finally {
    playing.value = false
  }
}
async function deletePlaylist(): Promise<void> {
  if (!playlist.value) return
  const response = await window.api.database.command('deletePlaylists', {
    ids: [playlist.value.id]
  })
  if (!response.success) {
    showError(response.error || t('playlist.deleteFailed'))
    return
  }
  deleteDialogOpen.value = false
  eventBus.emit('playlistsChanged')
  success(t('playlist.deleted'))
  await router.replace('/song')
}

function handlePlaylistRenamed(id: number): void {
  if (id === playlistId.value) void load()
}
onMounted(() => {
  void load()
  eventBus.on('playlistRenamed', handlePlaylistRenamed)
})
onBeforeUnmount(() => {
  eventBus.off('playlistRenamed', handlePlaylistRenamed)
  clearCropImage()
})
watch(cropDialogVisible, (visible) => {
  if (!visible) clearCropImage()
})
watch(playlistId, () => {
  cropDialogVisible.value = false
  clearCropImage()
  void load()
})
</script>

<template>
  <section v-if="loading" class="p-8 text-sm text-text-l">
    {{ t('playlist.loading') }}
  </section>
  <section v-else-if="!playlist" class="p-8 text-sm text-text-l">
    {{ t('playlist.notFound') }}
  </section>
  <section v-else class="flex h-full min-h-0 flex-col text-text">
    <PlaylistHeader
      v-model:collapsed="headerCollapsed"
      :title="playlist.name"
      :cover-url="coverUrl"
      :playing="playing"
      @select-cover="coverInput?.click()"
      @play="playPlaylist"
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
      <template #title>
        <input
          v-if="editingField === 'name'"
          v-model="editName"
          autofocus
          maxlength="64"
          class="input-base h-10 min-w-0 max-w-xl flex-1 text-2xl font-bold"
          @blur="savePlaylist"
          @keydown.enter.prevent="savePlaylist"
          @keydown.esc.prevent="cancelEditing"
        />
        <h1 v-else class="truncate font-bold" :class="headerCollapsed ? 'text-base' : 'text-3xl'">
          {{ playlist.name }}
        </h1>
        <button
          v-if="!headerCollapsed"
          type="button"
          class="ep-focusable group grid size-6 shrink-0 cursor-pointer place-items-center"
          :title="t('playlist.editName')"
          :aria-label="t('playlist.editName')"
          @click="startEditing('name')"
        >
          <SvgIcon
            name="common-edit"
            class-name="size-3 transition-colors group-hover:text-primary group-focus-visible:text-primary"
          />
        </button>
      </template>
      <template #details>
        <div class="mt-2 flex min-w-0 items-center gap-2 text-sm text-text-l">
          <textarea
            v-if="editingField === 'description'"
            v-model="editDescription"
            autofocus
            maxlength="500"
            rows="2"
            class="input-base min-h-18 min-w-0 max-w-xl flex-1 resize-y"
            @blur="savePlaylist"
            @keydown.esc.prevent="cancelEditing"
          />
          <p v-else class="min-w-0 max-w-xl whitespace-pre-wrap">
            {{ playlist.description || t('playlist.descriptionPlaceholder') }}
          </p>
          <button
            type="button"
            class="ep-focusable group grid size-6 shrink-0 cursor-pointer place-items-center"
            :title="t('playlist.editDescription')"
            :aria-label="t('playlist.editDescription')"
            @click="startEditing('description')"
          >
            <SvgIcon
              name="common-edit"
              class-name="size-3 transition-colors group-hover:text-primary group-focus-visible:text-primary"
            />
          </button>
        </div>
        <p class="mt-2 text-xs text-text-l">
          {{ t('playlist.createdAt', { date: formatCreatedAt(playlist.createdAt) }) }}
        </p>
      </template>
      <template #actions>
        <BaseButton v-if="playlist.customCover" variant="ghost" size="sm" @click="resetCover">
          {{ t('playlist.resetCover') }}
        </BaseButton>
        <BaseButton variant="ghost" size="sm" @click="deleteDialogOpen = true">
          {{ t('playlist.delete') }}
        </BaseButton>
      </template>
    </PlaylistHeader>
    <SongListView class="min-h-0 flex-1" :source="songListSource" />
  </section>
  <CropperDialog v-model="cropDialogVisible" :image-url="cropImageUrl" @confirm="applyCoverCrop" />
  <BaseDialog v-model="deleteDialogOpen" :title="t('playlist.delete')" width="max-w-sm">
    <p class="text-sm text-text-l">
      {{ t('playlist.confirmDelete', { name: playlist?.name ?? '' }) }}
    </p>
    <template #footer>
      <BaseButton variant="cancel" @click="deleteDialogOpen = false">
        {{ t('common.cancel') }}
      </BaseButton>
      <BaseButton variant="danger" @click="deletePlaylist">
        {{ t('playlist.delete') }}
      </BaseButton>
    </template>
  </BaseDialog>
</template>
