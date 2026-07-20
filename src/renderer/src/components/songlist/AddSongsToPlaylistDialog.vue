<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { useMessage } from '@/components/ui/useMessage'
import eventBus from '@/utils/eventBus'

interface PlaylistTarget {
  id: number
  name: string
  cover: string | null
  customCover: string | null
}

const props = defineProps<{ modelValue: boolean; songIds: number[] }>()
const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void; (e: 'added'): void }>()
const { t } = useI18n()
const { success, warning, error: showError } = useMessage()
const playlists = ref<PlaylistTarget[]>([])
const loading = ref(false)
const submitting = ref(false)
const creating = ref(false)
const name = ref('')

const coverUrl = (playlist: PlaylistTarget): string | null => {
  const cover = playlist.customCover || playlist.cover
  return cover ? `easy-player-media://cover?path=${encodeURIComponent(cover)}` : null
}

async function load(): Promise<void> {
  loading.value = true
  try {
    const response = await window.api.database.command('listPlaylists')
    if (!response.success) throw new Error(response.error || t('songList.playlistLoadFailed'))
    playlists.value = response.data as PlaylistTarget[]
  } catch (error) {
    showError(error instanceof Error ? error.message : t('songList.playlistLoadFailed'))
  } finally {
    loading.value = false
  }
}

function close(): void {
  emit('update:modelValue', false)
}

async function addToPlaylist(playlistId: number): Promise<void> {
  if (!props.songIds.length || submitting.value) return
  submitting.value = true
  try {
    const response = await window.api.database.command('addSongsToPlaylist', {
      playlistId,
      songIds: [...props.songIds]
    })
    if (!response.success) throw new Error(response.error || t('songList.addToPlaylistFailed'))
    const result = response.data as { added: number; duplicates: number }
    if (result.added > 0 && result.duplicates > 0)
      success(t('songList.addedToPlaylistWithDuplicates', result))
    else if (result.added > 0) success(t('songList.addedToPlaylist', { count: result.added }))
    else warning(t('songList.alreadyInPlaylist'))
    eventBus.emit('playlistsChanged')
    emit('added')
    close()
  } catch (error) {
    showError(error instanceof Error ? error.message : t('songList.addToPlaylistFailed'))
  } finally {
    submitting.value = false
  }
}

async function createAndAdd(): Promise<void> {
  const playlistName = name.value.trim()
  if (!playlistName) {
    showError(t('playlist.nameRequired'))
    return
  }
  if (submitting.value) return
  submitting.value = true
  try {
    const response = await window.api.database.command('createPlaylist', { name: playlistName })
    if (!response.success) throw new Error(response.error || t('playlist.createFailed'))
    const playlist = response.data as { id: number }
    name.value = ''
    creating.value = false
    eventBus.emit('playlistsChanged')
    submitting.value = false
    await addToPlaylist(playlist.id)
  } catch (error) {
    showError(error instanceof Error ? error.message : t('playlist.createFailed'))
  } finally {
    submitting.value = false
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) void load()
    else {
      creating.value = false
      name.value = ''
    }
  }
)
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    :title="t('songList.addToPlaylist')"
    width="max-w-md"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="flex flex-col max-h-[60vh]">
      <!-- 顶部固定：新建播放列表 -->
      <div class="shrink-0 space-y-2 pb-2">
        <button
          class="flex w-full items-center gap-3 rounded-xl bg-primary/10 px-3 py-3 text-left text-sm font-medium text-primary transition hover:bg-primary/15"
          :disabled="submitting"
          @click="creating = !creating"
        >
          <span class="grid size-10 place-items-center rounded-lg bg-primary/15">
            <SvgIcon name="common-plus" class-name="size-5" />
          </span>
          {{ t('playlist.createNew') }}
        </button>
        <form v-if="creating" class="flex gap-2" @submit.prevent="createAndAdd">
          <input
            v-model="name"
            class="min-w-0 flex-1 rounded-lg bg-hover px-3 py-2 text-sm outline-none ring-primary focus:ring-1"
            :placeholder="t('playlist.namePlaceholder')"
            autofocus
          />
          <button
            class="btn-hover-base rounded-lg bg-primary px-3 text-sm text-white disabled:opacity-50"
            :disabled="submitting"
            type="submit"
          >
            {{ t('playlist.createNew') }}
          </button>
        </form>
      </div>

      <!-- 底部滚动：播放列表 -->
      <div class="flex-1 overflow-y-auto custom-scrollbar min-h-0 space-y-1">
        <p v-if="loading" class="py-5 text-center text-sm text-text-l">
          {{ t('songList.playlistLoading') }}
        </p>
        <p v-else-if="!playlists.length" class="py-4 text-center text-sm text-text-l">
          {{ t('songList.playlistEmpty') }}
        </p>
        <button
          v-for="playlist in playlists"
          :key="playlist.id"
          class="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition hover:bg-hover disabled:opacity-50"
          :disabled="submitting"
          @click="addToPlaylist(playlist.id)"
        >
          <img
            v-if="coverUrl(playlist)"
            :src="coverUrl(playlist) || undefined"
            class="size-10 rounded-lg object-cover"
            alt=""
            @error="($event.target as HTMLImageElement).style.display = 'none'"
          />
          <span v-else class="grid size-10 place-items-center rounded-lg bg-hover text-text-l">
            <SvgIcon name="common-music" class-name="size-5" />
          </span>
          <span class="min-w-0 truncate text-sm">{{ playlist.name }}</span>
        </button>
      </div>
    </div>
  </BaseDialog>
</template>
