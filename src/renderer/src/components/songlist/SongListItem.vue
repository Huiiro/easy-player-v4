<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import type { LibrarySong } from '@/types/library'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { useFriendlyTime } from '@/hooks/useTimeFormatter'
import { getHighlightParts } from '@/utils/highlight'
import { artistDisplayTokens } from '@/utils/artists'
import { useUIStore } from '@/stores/ui/uiStore'
import { useSongActivation } from '@/hooks/useSongActivation'
import { formatGenres } from '@/utils/genres'
import {
  songPlayCount,
  songYear,
  songListRowHeight,
  type SongListColumns
} from '@/utils/songListLayout'

const props = defineProps<{
  song: LibrarySong
  index: number
  selectionMode: boolean
  selected: boolean
  current: boolean
  keyword: string
  showFileName: boolean
  compact: boolean
  small?: boolean
  hideDividers?: boolean
  columns?: SongListColumns
}>()

const emit = defineEmits<{
  play: [song: LibrarySong]
  toggleSelect: [id: number]
  requestMenu: [song: LibrarySong, x: number, y: number]
}>()

const { t } = useI18n()
const router = useRouter()
const ui = useUIStore()
const activateSong = useSongActivation()
const { format: formatPlayTime } = useFriendlyTime()
const coverFailed = ref(false)
const coverUrl = computed(() =>
  props.song.cover ? `easy-player-media://cover?path=${encodeURIComponent(props.song.cover)}` : null
)
const formatDuration = computed(() => {
  const duration = props.song.duration
  if (typeof duration !== 'number' || !Number.isFinite(duration) || duration < 0) return '-'
  const seconds = Math.floor(duration)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
})
const displayedTitle = computed(() => {
  const value =
    props.showFileName && props.song.fileName?.trim() ? props.song.fileName : props.song.title
  return value?.trim() || '-'
})
const highlightedTitle = computed(() => getHighlightParts(displayedTitle.value, props.keyword))
const artistTokens = computed(() =>
  artistDisplayTokens(props.song.artist, ui.artistSeparator, ui.normalizeMetadataSeparator)
)
const highlightedAlbum = computed(() =>
  getHighlightParts(props.song.album?.trim() || '-', props.keyword)
)
const displayedGenre = computed(() =>
  formatGenres(props.song.genre, ui.genreSeparator, ui.normalizeMetadataSeparator)
)

watch(
  () => props.song.cover,
  () => {
    coverFailed.value = false
  }
)

const requestMenu = (event: MouseEvent): void => {
  emit('requestMenu', props.song, event.clientX, event.clientY)
}
function openArtist(artist: string): void {
  if (artist) {
    void router.push({
      path: '/artist/detail',
      query: { name: artist, cover: props.song.cover || '' }
    })
  }
}
function openAlbum(): void {
  if (!props.song.album?.trim()) return
  void router.push({
    path: '/album/detail',
    query: {
      name: props.song.album,
      artist: props.song.artist || '',
      cover: props.song.cover || ''
    }
  })
}
</script>

<template>
  <div
    class="border-[color:color-mix(in_srgb,var(--color-border)_60%,transparent)]"
    :class="{ 'border-b': !hideDividers }"
    :style="{ height: `${songListRowHeight(compact, small)}px` }"
  >
    <div
      class="song-list-row grid h-full items-center gap-3 px-5 transition-colors hover:bg-hover"
      :class="[
        { 'song-list-row--small': small },
        current
          ? 'bg-[color:color-mix(in_srgb,var(--color-primary)_14%,transparent)] text-primary'
          : ''
      ]"
      @click="activateSong($event, () => emit('play', song))"
      @dblclick="activateSong($event, () => emit('play', song))"
      @contextmenu.prevent.stop="requestMenu"
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
      <span class="song-list-title flex min-w-0 items-center gap-3">
        <img
          v-if="!compact && coverUrl && !coverFailed"
          :src="coverUrl"
          class="song-list-cover size-10 shrink-0 rounded-md object-cover"
          :alt="song.title"
          @error="coverFailed = true"
        />
        <span
          v-else-if="!compact"
          class="song-list-cover grid size-10 shrink-0 place-items-center rounded-md bg-bg-l"
        >
          <svgIcon name="common-music" class-name="size-5" />
        </span>
        <span class="min-w-0">
          <span class="flex min-w-0 items-center gap-1">
            <span
              class="song-list-name truncate cursor-pointer"
              :class="song.songStatus === 0 ? 'line-through opacity-60' : ''"
            >
              <template v-for="(part, partIndex) in highlightedTitle" :key="partIndex">
                <mark v-if="part.highlighted" class="bg-yellow-400 text-black">
                  {{ part.text }}
                </mark>
                <template v-else>{{ part.text }}</template>
              </template>
            </span>
          </span>
          <span
            v-if="song.playTime || song.tags?.length"
            class="mt-0.5 min-w-0"
            :class="small ? 'flex items-center gap-2' : 'block'"
          >
            <span
              v-if="song.playTime"
              class="block truncate text-text-l"
              :class="small ? 'text-[10px] leading-3 max-w-1/2 shrink-0' : 'text-xs'"
              :title="t('history.lastPlayed', { time: formatPlayTime(song.playTime) })"
            >
              {{ t('history.lastPlayed', { time: formatPlayTime(song.playTime) }) }}
            </span>
            <span
              v-if="song.tags?.length"
              class="flex min-w-0 gap-1 overflow-hidden"
              :class="{ 'mt-0.5': !small && song.playTime }"
            >
              <span
                v-for="tag in song.tags"
                :key="tag.id"
                class="max-w-24 shrink-0 truncate rounded-full px-1.5 py-px text-[10px] text-white"
                :class="small ? 'leading-3' : 'leading-4'"
                :style="{ backgroundColor: tag.color || '#7c3aed' }"
                :title="tag.name"
                >{{ tag.name }}</span
              >
            </span>
          </span>
        </span>
      </span>
      <span class="min-w-0 truncate text-sm text-text-l">
        <span v-if="artistTokens.length" class="max-w-full truncate">
          <template v-for="(token, tokenIndex) in artistTokens" :key="tokenIndex">
            <span v-if="token.type === 'separator'">{{ token.text }}</span>
            <button v-else class="hover:text-primary" @click.stop="openArtist(token.artist)">
              <template
                v-for="(part, partIndex) in getHighlightParts(token.text, keyword)"
                :key="partIndex"
              >
                <mark v-if="part.highlighted" class="bg-yellow-400 text-black">
                  {{ part.text }}
                </mark>
                <template v-else>{{ part.text }}</template>
              </template>
            </button>
          </template>
        </span>
        <template v-else>-</template>
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
        <template v-else>-</template>
      </span>
      <span
        v-if="columns?.genre"
        class="min-w-0 truncate text-sm text-text-l"
        :title="displayedGenre"
      >
        {{ displayedGenre || '-' }}
      </span>
      <span v-if="columns?.year" class="text-center text-sm tabular-nums text-text-l">
        {{ songYear(song) ?? '-' }}
      </span>
      <span v-if="columns?.playTimes" class="text-center text-sm tabular-nums text-text-l">
        {{ songPlayCount(song) ?? '-' }}
      </span>
      <span
        v-if="columns?.disableNetworkLyrics"
        class="flex items-center justify-center text-sm text-text-l"
        :title="song.disableNetworkLyrics ? t('lyrics.disableNetwork') : undefined"
      >
        <SvgIcon
          v-if="song.disableNetworkLyrics"
          name="common-no-internet"
          class-name="size-4 shrink-0 text-primary"
          :aria-label="t('lyrics.disableNetwork')"
          :aria-hidden="false"
          role="img"
        />
      </span>
      <span
        v-if="columns?.instrumental"
        class="flex items-center justify-center text-sm text-text-l"
        :title="song.instrumental ? t('lyrics.instrumental') : undefined"
      >
        <SvgIcon
          v-if="song.instrumental"
          name="common-music-notes"
          class-name="size-4 shrink-0 text-primary"
          :aria-label="t('lyrics.instrumental')"
          :aria-hidden="false"
          role="img"
        />
      </span>
      <span v-if="columns?.preference" class="flex items-center justify-center text-sm text-text-l">
        <SvgIcon
          v-if="song.preference === 1"
          name="play-like"
          class-name="size-4 shrink-0 text-primary"
          :title="t('songList.like')"
          :aria-label="t('songList.like')"
          :aria-hidden="false"
          role="img"
        />
        <SvgIcon
          v-else-if="song.preference === -1"
          name="play-dislike"
          class-name="size-4 shrink-0 text-danger"
          :title="t('songList.dislike')"
          :aria-label="t('songList.dislike')"
          :aria-hidden="false"
          role="img"
        />
      </span>
      <span
        v-if="columns?.remoteSource"
        class="flex items-center justify-center text-sm text-text-l"
      >
        <SvgIcon
          v-if="song.sourceId != null"
          name="menu-remote"
          class-name="size-4 shrink-0 text-primary"
          :title="t('songList.remoteSong')"
          :aria-label="t('songList.remoteSong')"
          :aria-hidden="false"
          role="img"
        />
      </span>
      <span class="text-right text-sm text-text-l cursor-default">{{ formatDuration }}</span>
    </div>
  </div>
</template>

<style scoped>
.song-list-row {
  column-gap: var(--song-list-gap, 0.75rem);
  padding-inline: var(--song-list-padding-inline, 1.25rem);
  grid-template-columns: var(
    --song-list-grid-columns,
    2.5rem minmax(12rem, 2fr) minmax(7rem, 1fr) minmax(8rem, 1.2fr) 3.5rem
  );
}
.song-list-title {
  gap: var(--song-list-gap, 0.75rem);
}
.song-list-row--small,
.song-list-row--small .text-sm {
  font-size: 0.75rem;
  line-height: 1rem;
}
/* Keep the title distinct and use native text rasterization at this small size. */
.song-list-row--small .song-list-name {
  font-size: 13px;
  font-weight: 500;
  line-height: 20px;
  -webkit-font-smoothing: auto;
}
.song-list-row--small .song-list-cover {
  width: 1.75rem;
  height: 1.75rem;
}
.song-list-row--small :deep(.svg-icon) {
  width: 0.875rem;
  height: 0.875rem;
}
</style>
