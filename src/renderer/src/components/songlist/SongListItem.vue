<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { LibrarySong } from '@/types/library'

const props = defineProps<{
  song: LibrarySong
  index: number
  selectionMode: boolean
  selected: boolean
  activeMenuId: number | null
}>()

const emit = defineEmits<{
  play: [song: LibrarySong]
  toggleSelect: [id: number]
  addToQueue: [song: LibrarySong]
  addToPlaylist: [song: LibrarySong]
  editTags: [song: LibrarySong]
  showDetails: [song: LibrarySong]
  openFolder: [song: LibrarySong]
  delete: [song: LibrarySong]
  toggleMenu: [id: number]
  closeMenu: []
}>()

const { t } = useI18n()
const coverFailed = ref(false)
const menuTrigger = ref<HTMLElement | null>(null)
const menuStyle = ref({ left: '0px', top: '0px' })
const menuOpen = computed(() => props.activeMenuId === props.song.id)
const coverUrl = computed(() =>
  props.song.cover ? `easy-player-media://cover?path=${encodeURIComponent(props.song.cover)}` : null
)
const formatDuration = computed(() => {
  const seconds = Math.max(0, Math.floor(props.song.duration ?? 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})

watch(
  () => props.song.cover,
  () => {
    coverFailed.value = false
  }
)

const selectAction = (action: () => void): void => {
  action()
  emit('closeMenu')
}

const toggleMenu = (): void => {
  const rect = menuTrigger.value?.getBoundingClientRect()
  if (rect) {
    const menuHeight = 250
    menuStyle.value = {
      left: `${Math.max(8, rect.right - 160)}px`,
      top: `${window.innerHeight - rect.bottom < menuHeight ? Math.max(8, rect.top - menuHeight) : rect.bottom + 6}px`
    }
  }
  emit('toggleMenu', props.song.id)
}
</script>

<template>
  <div class="h-16 border-b border-[color:color-mix(in_srgb,var(--color-border)_60%,transparent)]">
    <div
      class="grid h-full grid-cols-[3rem_minmax(12rem,1.8fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_4rem_2rem] items-center gap-3 px-5 transition-colors hover:bg-[var(--color-hover)]"
      @dblclick="emit('play', song)"
    >
      <span class="flex items-center gap-2 text-sm text-[var(--color-text-l)]">
        <input
          v-if="selectionMode"
          type="checkbox"
          class="accent-[var(--color-primary)]"
          :checked="selected"
          @click.stop="emit('toggleSelect', song.id)"
        />
        <span>{{ index + 1 }}</span>
      </span>
      <span class="flex min-w-0 items-center gap-3">
        <img
          v-if="coverUrl && !coverFailed"
          :src="coverUrl"
          class="size-10 shrink-0 rounded-md object-cover"
          :alt="song.title"
          @error="coverFailed = true"
        />
        <span
          v-else
          class="grid size-10 shrink-0 place-items-center rounded-md bg-[var(--color-bg-l)]"
          ><svgIcon name="common-music" class-name="size-5"
        /></span>
        <span
          class="min-w-0 truncate"
          :class="song.songStatus === 0 ? 'line-through opacity-60' : ''"
          >{{ song.title }}</span
        >
      </span>
      <span class="truncate text-sm text-[var(--color-text-l)]">{{
        song.artist || t('songList.unknownArtist')
      }}</span>
      <span class="truncate text-sm text-[var(--color-text-l)]">{{
        song.album || t('songList.unknownAlbum')
      }}</span>
      <span class="text-right text-sm text-[var(--color-text-l)]">{{ formatDuration }}</span>
      <span class="text-right">
        <button ref="menuTrigger" class="btn-hover" @click.stop="toggleMenu">
          <svgIcon name="menu-more-horizontal" class-name="size-5" />
        </button>
        <Teleport to="body">
          <div
            v-if="menuOpen"
            class="fixed z-[9999] w-40 rounded-lg border border-[var(--color-border)] bg-[var(--color-bg)] p-1 text-left shadow-xl"
            :style="menuStyle"
            @click.stop
            @dblclick.stop
          >
            <button
              class="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
              @click="selectAction(() => emit('play', song))"
            >
              {{ t('songList.play') }}
            </button>
            <button
              class="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
              @click="selectAction(() => emit('addToQueue', song))"
            >
              {{ t('songList.addToQueue') }}
            </button>
            <button
              class="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
              @click="selectAction(() => emit('addToPlaylist', song))"
            >
              {{ t('songList.addToPlaylist') }}
            </button>
            <button
              class="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
              @click="selectAction(() => emit('editTags', song))"
            >
              {{ t('songList.editTags') }}
            </button>
            <button
              class="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
              @click="selectAction(() => emit('showDetails', song))"
            >
              {{ t('songList.details') }}
            </button>
            <button
              class="block w-full rounded-md px-3 py-1.5 text-left text-sm hover:bg-[var(--color-hover)]"
              @click="selectAction(() => emit('openFolder', song))"
            >
              {{ t('songList.openFolder') }}
            </button>
            <button
              class="block w-full rounded-md px-3 py-1.5 text-left text-sm text-red-400 hover:bg-[var(--color-hover)]"
              @click="selectAction(() => emit('delete', song))"
            >
              {{ t('songList.delete') }}
            </button>
          </div>
        </Teleport>
      </span>
    </div>
  </div>
</template>
