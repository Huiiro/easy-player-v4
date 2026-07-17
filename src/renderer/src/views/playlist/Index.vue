<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import SongListView from '@/components/songlist/SongListView.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import eventBus from '@/utils/eventBus'
import { useMessage } from '@/components/ui/useMessage'

interface Playlist {
  id: number
  name: string
  cover: string | null
  customCover: string | null
  description: string | null
}

const route = useRoute()
const router = useRouter()
const playlist = ref<Playlist | null>(null)
const loading = ref(true)
const coverInput = ref<HTMLInputElement | null>(null)
const { success, error: showError } = useMessage()
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
    success('自定义封面已设置')
  } else {
    showError(response.error || '设置封面失败')
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
    success('已恢复自动封面')
  } else {
    showError(response.error || '恢复自动封面失败')
  }
}

onMounted(() => void load())
watch(playlistId, () => void load())
</script>

<template>
  <section v-if="loading" class="p-8 text-sm text-[var(--color-text-l)]">加载歌单中…</section>
  <section v-else-if="!playlist" class="p-8 text-sm text-[var(--color-text-l)]">
    歌单不存在或已被删除。
  </section>
  <section v-else class="flex h-full min-h-0 flex-col text-[var(--color-text)]">
    <header class="flex shrink-0 items-end gap-6 px-8 py-7">
      <button
        class="group relative grid size-36 shrink-0 place-items-center overflow-hidden rounded-2xl bg-[var(--color-bg-l)] shadow-lg"
        title="设置自定义封面"
        @click="coverInput?.click()"
      >
        <img v-if="coverUrl" :src="coverUrl" class="size-full object-cover" :alt="playlist.name" />
        <SvgIcon v-else name="common-music" class-name="size-12 text-[var(--color-text-l)]" />
        <span
          class="absolute inset-0 grid place-items-center bg-black/45 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100"
          >更换封面</span
        >
      </button>
      <input
        ref="coverInput"
        class="hidden"
        type="file"
        accept="image/*"
        @change="selectCustomCover"
      />
      <div class="min-w-0 flex-1">
        <p class="text-xs font-semibold tracking-[.12em] text-[var(--color-text-l)]">歌单</p>
        <h1 class="mt-2 truncate text-3xl font-bold">{{ playlist.name }}</h1>
        <p class="mt-2 text-sm text-[var(--color-text-l)]">
          {{ playlist.description || '创建你的专属音乐收藏' }}
        </p>
        <button v-if="playlist.customCover" class="btn-hover mt-3 text-xs" @click="resetCover">
          恢复自动封面
        </button>
      </div>
      <button class="btn-hover mb-1 text-sm" @click="router.back()">返回</button>
    </header>
    <SongListView class="min-h-0 flex-1" :source="{ type: 'playlist', id: playlist.id }" />
  </section>
</template>
