<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import SongListView from '@/components/songlist/SongListView.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import type { LibrarySong, PagedLibrarySongs } from '@/types/library'
import eventBus from '@/utils/eventBus'
import { useMessage } from '@/components/ui/useMessage'
import BaseDialog from '@/components/ui/BaseDialog.vue'

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
const deleteDialogOpen = ref(false)
const editName = ref('')
const editDescription = ref('')
const editingField = ref<'name' | 'description' | null>(null)
const saving = ref(false)
const playing = ref(false)
const headerCollapsed = ref(false)
const player = usePlayerStore()
const { success, warning, error: showError } = useMessage()
const { t, locale } = useI18n()
const playlistId = computed(() => Number(route.params.id))
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
async function selectCustomCover(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  const path = window.api.audio.getFilePath(file)
  const response = await window.api.database.command('setPlaylistCustomCover', {
    id: playlistId.value,
    path
  })
  if (response.success) {
    await load()
    eventBus.emit('playlistsChanged')
    success(t('playlist.coverSet'))
  } else {
    showError(response.error || t('playlist.coverSetFailed'))
  }
  ;(event.target as HTMLInputElement).value = ''
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
    const played = await player.playCollection(songs, songs[0].id, playlist.value.id)
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

onMounted(() => void load())
watch(playlistId, () => void load())
</script>

<template>
  <section v-if="loading" class="p-8 text-sm text-text-l">
    {{ t('playlist.loading') }}
  </section>
  <section v-else-if="!playlist" class="p-8 text-sm text-text-l">
    {{ t('playlist.notFound') }}
  </section>
  <section v-else class="flex h-full min-h-0 flex-col text-text">
    <header
      class="flex shrink-0 gap-6 px-6 transition-all duration-[var(--motion-duration-standard)]"
      :class="headerCollapsed ? 'items-center py-3' : 'items-end py-6'"
    >
      <button
        class="group relative grid shrink-0 place-items-center overflow-hidden bg-bg-l shadow-lg transition-all duration-[var(--motion-duration-standard)]"
        :class="headerCollapsed ? 'size-11 rounded-lg' : 'size-40 rounded-2xl'"
        :title="t('playlist.setCover')"
        @click="coverInput?.click()"
      >
        <img v-if="coverUrl" :src="coverUrl" class="size-full object-cover" :alt="playlist.name" />
        <SvgIcon
          v-else
          name="common-music"
          :class-name="headerCollapsed ? 'size-5 text-text-l' : 'size-12 text-text-l'"
        />
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
      <div class="min-w-0 flex-1">
        <p v-if="!headerCollapsed" class="text-xs font-semibold tracking-[.12em] text-text-l ml-1">
          {{ t('playlist.label') }}
        </p>
        <div class="flex min-w-0 items-center gap-2" :class="headerCollapsed ? '' : 'mt-2'">
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
            class="btn-hover grid size-4 shrink-0 place-items-center"
            :title="t('playlist.editName')"
            @click="startEditing('name')"
          >
            <SvgIcon name="common-edit" class-name="size-3.5" />
          </button>
        </div>
        <div
          v-if="!headerCollapsed"
          class="mt-2 flex min-w-0 items-start gap-2 text-sm text-text-l"
        >
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
            class="btn-hover grid size-5 shrink-0 place-items-center"
            :title="t('playlist.editDescription')"
            @click="startEditing('description')"
          >
            <SvgIcon name="common-edit" class-name="size-3.5" />
          </button>
        </div>
        <p v-if="!headerCollapsed" class="mt-2 text-xs text-text-l">
          {{ t('playlist.createdAt', { date: formatCreatedAt(playlist.createdAt) }) }}
        </p>
        <div v-if="!headerCollapsed" class="mt-3 flex flex-wrap items-center gap-2">
          <button
            class="btn-hover-base rounded-lg bg-primary px-3 py-1.5 text-sm text-white hover:text-white disabled:opacity-50"
            :disabled="playing"
            @click="playPlaylist"
          >
            {{ t('playlist.play') }}
          </button>
          <button
            class="btn-hover-base rounded-lg px-3 py-1.5 text-sm text-red-400"
            @click="deleteDialogOpen = true"
          >
            {{ t('playlist.delete') }}
          </button>
          <button
            v-if="playlist.customCover"
            class="btn-hover px-2 py-1.5 text-xs"
            @click="resetCover"
          >
            {{ t('playlist.resetCover') }}
          </button>
        </div>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <button
          class="btn-hover grid size-8 place-items-center"
          :title="headerCollapsed ? t('playlist.expandHeader') : t('playlist.collapseHeader')"
          @click="headerCollapsed = !headerCollapsed"
        >
          <SvgIcon
            :name="headerCollapsed ? 'common-expand-down' : 'common-expand-up'"
            class-name="size-4"
          />
        </button>
        <button
          v-if="headerCollapsed"
          class="btn-hover-base rounded-lg bg-primary px-3 py-1.5 text-sm text-white hover:text-white disabled:opacity-50"
          :disabled="playing"
          @click="playPlaylist"
        >
          {{ t('playlist.play') }}
        </button>
      </div>
      <div v-if="!headerCollapsed" class="mb-1 flex shrink-0 items-center gap-1 btn-hover">
        <SvgIcon name="common-back" class-name="size-3.5" />
        <button class="text-sm" @click="router.back()">{{ t('playlist.back') }}</button>
      </div>
    </header>
    <SongListView class="min-h-0 flex-1" :source="{ type: 'playlist', id: playlist.id }" />
  </section>
  <BaseDialog v-model="deleteDialogOpen" :title="t('playlist.delete')" width="max-w-sm">
    <p class="text-sm text-text-l">
      {{ t('playlist.confirmDelete', { name: playlist?.name ?? '' }) }}
    </p>
    <template #footer>
      <button class="btn-hover rounded-lg px-3 py-1.5 text-sm" @click="deleteDialogOpen = false">
        {{ t('common.cancel') }}
      </button>
      <button
        class="btn-hover-base rounded-lg bg-red-500 px-3 py-1.5 text-sm text-white"
        @click="deletePlaylist"
      >
        {{ t('playlist.delete') }}
      </button>
    </template>
  </BaseDialog>
</template>
