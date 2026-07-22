<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { LibrarySong } from '@/types/library'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { useFriendlyTime } from '@/hooks/useTimeFormatter'
import { getHighlightParts } from '@/utils/highlight'

const props = defineProps<{
  song: LibrarySong
  index: number
  selectionMode: boolean
  selected: boolean
  current: boolean
  keyword: string
  showFileName: boolean
}>()

const emit = defineEmits<{
  play: [song: LibrarySong]
  toggleSelect: [id: number]
  requestMenu: [song: LibrarySong, position: { left: string; top: string }]
}>()

const { t } = useI18n()
const router = useRouter()
const { format: formatPlayTime } = useFriendlyTime()
const coverFailed = ref(false)
const coverUrl = computed(() =>
  props.song.cover ? `easy-player-media://cover?path=${encodeURIComponent(props.song.cover)}` : null
)
const formatDuration = computed(() => {
  const seconds = Math.max(0, Math.floor(props.song.duration ?? 0))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})
const displayedTitle = computed(() =>
  props.showFileName ? props.song.fileName || props.song.title : props.song.title
)
const highlightedTitle = computed(() => getHighlightParts(displayedTitle.value, props.keyword))
const highlightedArtist = computed(() =>
  getHighlightParts(props.song.artist || t('songList.unknownArtist'), props.keyword)
)
const highlightedAlbum = computed(() =>
  getHighlightParts(props.song.album || t('songList.unknownAlbum'), props.keyword)
)

watch(
  () => props.song.cover,
  () => {
    coverFailed.value = false
  }
)

const requestMenu = (event: MouseEvent): void => {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const menuHeight = 250
  emit('requestMenu', props.song, {
    left: `${Math.max(8, rect.right - 160)}px`,
    top: `${window.innerHeight - rect.bottom < menuHeight ? Math.max(8, rect.top - menuHeight) : rect.bottom + 6}px`
  })
}
function openArtist(): void {
  if (props.song.artist?.trim()) {
    void router.push({ path: '/artist/detail', query: { name: props.song.artist } })
  }
}
function openAlbum(): void {
  if (!props.song.album?.trim()) return
  void router.push({
    path: '/album/detail',
    query: { name: props.song.album, artist: props.song.artist || '' }
  })
}
</script>

<template>
  <div class="h-16 border-b border-[color:color-mix(in_srgb,var(--color-border)_60%,transparent)]">
    <div
      class="grid h-full grid-cols-[3rem_minmax(12rem,1.8fr)_minmax(8rem,1fr)_minmax(8rem,1fr)_4rem_2rem] items-center gap-3 px-5 transition-colors hover:bg-hover"
      :class="
        current
          ? 'bg-[color:color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-primary'
          : ''
      "
      @dblclick="emit('play', song)"
    >
      <span class="flex items-center gap-2 text-sm text-text-l">
        <input
          v-if="selectionMode"
          type="checkbox"
          class="accent-primary"
          :checked="selected"
          @click.stop="emit('toggleSelect', song.id)"
          @dblclick.stop
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
        <span v-else class="grid size-10 shrink-0 place-items-center rounded-md bg-bg-l">
          <svgIcon name="common-music" class-name="size-5" />
        </span>
        <span class="min-w-0">
          <span class="flex min-w-0 items-center gap-1">
            <span
              class="truncate cursor-pointer"
              :class="song.songStatus === 0 ? 'line-through opacity-60' : ''"
            >
              <template v-for="(part, partIndex) in highlightedTitle" :key="partIndex">
                <mark v-if="part.highlighted" class="bg-yellow-400 text-black">{{
                  part.text
                }}</mark>
                <template v-else>{{ part.text }}</template>
              </template>
            </span>
            <SvgIcon
              v-if="song.sourceId !== null"
              name="menu-remote"
              class-name="size-3.5 shrink-0 text-primary"
              :title="t('songList.remoteSong')"
            />
          </span>
          <span v-if="song.playTime" class="mt-0.5 block text-xs text-text-l">
            {{ t('history.lastPlayed', { time: formatPlayTime(song.playTime) }) }}
          </span>
          <span v-if="song.tags?.length" class="mt-0.5 flex gap-1 overflow-hidden">
            <span
              v-for="tag in song.tags"
              :key="tag.id"
              class="max-w-24 truncate rounded-full px-1.5 py-px text-[10px] leading-4 text-white"
              :style="{ backgroundColor: tag.color || '#7c3aed' }"
              >{{ tag.name }}
            </span>
          </span>
        </span>
      </span>
      <span class="min-w-0 truncate text-sm text-text-l">
        <button
          v-if="song.artist?.trim()"
          class="max-w-full truncate text-left hover:text-primary"
          @click.stop="openArtist"
        >
          <template v-for="(part, partIndex) in highlightedArtist" :key="partIndex">
            <mark v-if="part.highlighted" class="bg-yellow-400 text-black">{{ part.text }}</mark>
            <template v-else>{{ part.text }}</template>
          </template>
        </button>
        <template v-else>{{ t('songList.unknownArtist') }}</template>
      </span>
      <span class="min-w-0 truncate text-sm text-text-l">
        <button
          v-if="song.album?.trim()"
          class="max-w-full truncate text-left hover:text-primary"
          @click.stop="openAlbum"
        >
          <template v-for="(part, partIndex) in highlightedAlbum" :key="partIndex">
            <mark v-if="part.highlighted" class="bg-yellow-400 text-black">{{ part.text }}</mark>
            <template v-else>{{ part.text }}</template>
          </template>
        </button>
        <template v-else>{{ t('songList.unknownAlbum') }}</template>
      </span>
      <span class="text-right text-sm text-text-l cursor-default">{{ formatDuration }}</span>
      <span class="text-right flex ml-2">
        <button class="btn-hover" @click.stop="requestMenu" @dblclick.stop>
          <svgIcon name="menu-more-horizontal" class-name="size-5" />
        </button>
      </span>
    </div>
  </div>
</template>
