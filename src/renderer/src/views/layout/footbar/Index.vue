<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseRange from '@/components/ui/BaseRange.vue'
import { useFooterSwipe } from '@/components/player/useFooterSwipe'
import { useFooterAutoHide } from '@/components/player/useFooterAutoHide'
import { useSeekProgress } from '@/components/player/useSeekProgress'
import { loadLyricSourceOptions } from '@/services/lyricSourceOptions'
import { footerLayoutStyle, updateFooterSideWidths } from '@/utils/footerLayout'
import { useRouter } from 'vue-router'
import { PlayMode } from '@/consts'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import PlayQueueDrawer from '@/components/player/PlayQueueDrawer.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import SongDetailsDialog from '@/components/songlist/SongDetailsDialog.vue'
import SongTagDialog from '@/components/tag/SongTagDialog.vue'
import AddSongsToPlaylistDialog from '@/components/songlist/AddSongsToPlaylistDialog.vue'
import eventBus from '@/utils/eventBus'
import { useMessage } from '@/components/ui/useMessage'
import type { LibrarySong } from '@/types/library'
import { formatArtists, splitArtists } from '@/utils/artists'
import type { LyricFormat, LyricSource } from '@/services/lyrics'

const ui = useUIStore()
const layoutStyle = computed(() => footerLayoutStyle(ui.footerLayout))
const player = usePlayerStore()
const { displayPositionMs, displayPositionFormatted, previewSeek, commitSeek, cancelSeek } =
  useSeekProgress(player)
const { t } = useI18n()
const router = useRouter()
const { error } = useMessage()
const currentPreference = computed(() =>
  player.currentQueueSong ? player.getSongPreference(player.currentQueueSong.id) : 0
)
async function markCurrent(preference: -1 | 1): Promise<void> {
  const song = player.currentQueueSong
  if (!song) return
  const next = currentPreference.value === preference ? 0 : preference
  if (!(await player.setPreference(song.id, next))) error(t('recommendation.failed'))
}
const collapsed = ref(false)
const {
  collapsedCarouselRef,
  renderedCollapsedSongCards,
  collapsedTrackStyle,
  handleSwipePointerDown,
  handleSwipePointerMove,
  handleSwipePointerUp,
  handleSwipePointerCancel,
  handleSwipeTransitionEnd,
  handleFooterClickCapture
} = useFooterSwipe(
  player,
  collapsed,
  computed(() => ui.reduceMotion)
)
function setCollapsedCarousel(element: unknown): void {
  collapsedCarouselRef.value = element instanceof HTMLElement ? element : null
}
const footerRoot = ref<HTMLElement | null>(null)
const footerSection = ref<HTMLElement | null>(null)
const footerTime = ref<HTMLElement | null>(null)
const footerTransport = ref<HTMLElement | null>(null)
let footerLayoutObserver: ResizeObserver | null = null
watch(
  [footerSection, footerTime, footerTransport, layoutStyle],
  () => {
    footerLayoutObserver?.disconnect()
    const section = footerSection.value
    if (!section) return
    footerLayoutObserver ??= new ResizeObserver(() => updateFooterSideWidths(section))
    for (const element of [section, footerTime.value, footerTransport.value]) {
      if (element) footerLayoutObserver.observe(element)
    }
    updateFooterSideWidths(section)
  },
  { flush: 'post' }
)
const queueVisible = ref(false)
const moreVisible = ref(false)
const detailsVisible = ref(false)
const tagVisible = ref(false)
const playlistVisible = ref(false)
const lyricSourceVisible = ref(false)
const footerBusy = computed(
  () =>
    queueVisible.value ||
    moreVisible.value ||
    detailsVisible.value ||
    tagVisible.value ||
    playlistVisible.value ||
    lyricSourceVisible.value
)
const { footerHidden, footerPeekVisible, autoHideActive } = useFooterAutoHide(
  footerRoot,
  computed(() => ui.autoHideFooter && !ui.showPlayer),
  footerBusy,
  computed(() => ui.reduceMotion)
)
const lyricSourcesLoading = ref(false)
const lyricSourceOptions = ref<
  Array<{ source: LyricSource; content: string; format?: LyricFormat }>
>([])
const trackTitle = computed(
  () => player.trackInfo?.metadata?.title || player.currentQueueSong?.title || t('footer.noTrack')
)
const trackArtist = computed(() => {
  const artist = player.trackInfo?.metadata?.artist || player.currentQueueSong?.artist
  return (
    formatArtists(artist, ui.artistSeparator, ui.normalizeArtistSeparator) ||
    t('footer.defaultArtist')
  )
})
const coverFailed = ref(false)
const coverUrl = computed(() => {
  const cover = player.currentQueueSong?.cover
  return cover ? `easy-player-media://cover?path=${encodeURIComponent(cover)}` : null
})
function getCoverUrl(song: LibrarySong | null): string | null {
  return song?.cover ? `easy-player-media://cover?path=${encodeURIComponent(song.cover)}` : null
}

const audioSummary = computed(() => {
  const info = player.trackInfo
  if (!info) return ''
  const parts = [
    info.format?.toUpperCase(),
    info.sampleRate ? `${info.sampleRate / 1000} ${t('footer.kilohertz')}` : '',
    info.bitDepth ? `${info.bitDepth} ${t('footer.bitDepth')}` : ''
  ]
  return parts.filter(Boolean).join(' · ')
})
watch(coverUrl, () => {
  coverFailed.value = false
})
const playModeIcon = computed(() => {
  const icons: Record<PlayMode, string> = {
    [PlayMode.Sequential]: 'control-order',
    [PlayMode.List]: 'control-loop',
    [PlayMode.Single]: 'control-single',
    [PlayMode.Random]: 'control-shuffle'
  }
  return icons[player.playMode]
})
const playModeLabel = computed(() => {
  const labels: Record<PlayMode, string> = {
    [PlayMode.Sequential]: 'queue.sequential',
    [PlayMode.List]: 'queue.list',
    [PlayMode.Single]: 'queue.single',
    [PlayMode.Random]: 'queue.random'
  }
  return t(labels[player.playMode])
})

function togglePlayback(): void {
  if (player.isPlaying) {
    void player.pause()
    return
  }
  if (player.currentFile) void player.play()
}

function playPrevious(): void {
  void player.playPrevious()
}

function playNext(): void {
  void player.playNext()
}

function cyclePlayMode(): void {
  player.setPlayMode(((player.playMode + 1) % 4) as PlayMode)
}

function setVolume(event: Event): void {
  void player.setVolume(Number((event.target as HTMLInputElement).value) / 100)
}

function changeVolume(event: WheelEvent): void {
  event.preventDefault()
  void player.setVolume(Math.max(0, Math.min(1, player.volume + (event.deltaY < 0 ? 0.05 : -0.05))))
}

function openPlayerPanel(): void {
  if (ui.footerOpenMode === 'cover') return
  ui.showPlayer = true
}
function openPlayerPanelFromCover(): void {
  ui.showPlayer = true
}

function toggleCollapsed(): void {
  collapsed.value = !collapsed.value
  if (collapsed.value) closeMoreMenu()
}

function openDesktopLyrics(): void {
  ui.useDesktopLyrics = !ui.useDesktopLyrics
}
const currentSong = computed(() => player.currentQueueSong)
const currentArtists = computed(() => splitArtists(currentSong.value?.artist, ui.artistSeparator))
function openPlaylistPicker(): void {
  if (!currentSong.value) return
  playlistVisible.value = true
  moreVisible.value = false
}
function openDetails(): void {
  detailsVisible.value = true
  moreVisible.value = false
}
function openTags(): void {
  tagVisible.value = true
  moreVisible.value = false
}
function openArtist(artist: string): void {
  if (artist)
    void router.push({
      path: '/artist/detail',
      query: { name: artist, cover: currentSong.value?.cover || '' }
    })
  moreVisible.value = false
}
function openAlbum(): void {
  if (currentSong.value?.album)
    void router.push({
      path: '/album/detail',
      query: {
        name: currentSong.value.album,
        artist: currentSong.value.artist || '',
        cover: currentSong.value.cover || ''
      }
    })
  moreVisible.value = false
}
async function openFolder(): Promise<void> {
  if (!currentSong.value) return
  const response = await window.api.library.showSongInFolder(currentSong.value.id)
  if (!response.success) error(response.error || t('songList.openFolderFailed'))
  moreVisible.value = false
}
function locateSong(): void {
  eventBus.emit('locateCurrentSong')
  moreVisible.value = false
}
async function sendToLyricEditor(option?: {
  content: string
  format?: LyricFormat
}): Promise<void> {
  if (!currentSong.value) return
  const response = await window.api.lyrics.openInEditor({
    songId: currentSong.value.id,
    lyrics: option?.content || '',
    lyricFormat: option?.format
  })
  if (response.success) {
    if (player.isPlaying) await player.pause()
  } else {
    error(response.error || t('footer.openInLyricEditorFailed'))
  }
  lyricSourceVisible.value = false
  moreVisible.value = false
}
async function openInLyricEditor(): Promise<void> {
  if (!currentSong.value || lyricSourcesLoading.value) return
  lyricSourcesLoading.value = true
  moreVisible.value = false
  try {
    const song = currentSong.value
    const options = await loadLyricSourceOptions(song, ui.preferWordTimedNetworkLyrics)
    if (currentSong.value?.id !== song.id) return
    lyricSourceOptions.value = options
    if (lyricSourceOptions.value.length <= 1) {
      await sendToLyricEditor(lyricSourceOptions.value[0])
    } else {
      lyricSourceVisible.value = true
    }
  } catch (reason) {
    error(reason instanceof Error ? reason.message : t('footer.openInLyricEditorFailed'))
  } finally {
    lyricSourcesLoading.value = false
  }
}
function toggleMoreMenu(): void {
  moreVisible.value = !moreVisible.value
  if (moreVisible.value) eventBus.emit('songActionsMenuOpened', 'footer')
}
const closeMoreMenu = (): void => {
  moreVisible.value = false
}
function openQueueFromMenu(): void {
  queueVisible.value = true
  closeMoreMenu()
}
function openDesktopLyricsFromMenu(): void {
  void openDesktopLyrics()
  closeMoreMenu()
}
const onSongActionsMenuOpened = (source: 'footer' | 'songlist'): void => {
  if (source !== 'footer') closeMoreMenu()
}
onMounted(() => {
  eventBus.on('songActionsMenuOpened', onSongActionsMenuOpened)
  window.addEventListener('click', closeMoreMenu)
})
onBeforeUnmount(() => {
  footerLayoutObserver?.disconnect()
  eventBus.off('songActionsMenuOpened', onSongActionsMenuOpened)
  window.removeEventListener('click', closeMoreMenu)
})
</script>

<template>
  <div
    ref="footerRoot"
    class="pointer-events-none bg-gradient-to-t from-bg/30 px-4 pb-4 pt-2 transition-transform duration-[var(--motion-duration-slow)] max-[700px]:px-3 max-[700px]:pb-3 select-none"
    :style="{ transform: autoHideActive && footerHidden ? 'translateY(100%)' : '' }"
  >
    <section
      ref="footerSection"
      class="ep-footer app-footer pointer-events-auto mx-auto grid min-h-[72px] items-center rounded-3xl border px-4 py-2.5 text-text-l shadow-[0_12px_35px_rgb(0_0_0_/_20%)] backdrop-blur-2xl transition-all duration-[var(--motion-duration-slow)] max-[700px]:px-3 max-[700px]:py-2"
      :style="layoutStyle"
      :class="
        collapsed
          ? 'app-footer--collapsed grid-cols-[minmax(0,1fr)_auto_auto] max-w-md gap-3'
          : 'app-footer--expanded'
      "
      :aria-label="t('footer.playerControls')"
      :aria-description="collapsed ? t('footer.swipeToChangeTrack') : undefined"
      @pointerdown="handleSwipePointerDown"
      @pointermove="handleSwipePointerMove"
      @pointerup="handleSwipePointerUp"
      @pointercancel="handleSwipePointerCancel"
      @click.capture="handleFooterClickCapture"
      @click="openPlayerPanel"
    >
      <div v-if="collapsed" :ref="setCollapsedCarousel" class="collapsed-song-carousel">
        <div
          class="collapsed-song-track"
          :style="collapsedTrackStyle"
          @transitionend="handleSwipeTransitionEnd"
        >
          <article
            v-for="card in renderedCollapsedSongCards"
            :key="card.slot"
            class="collapsed-song-card"
            :aria-hidden="card.slot !== 'current'"
          >
            <button
              class="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-primary to-violet-500 text-white shadow-[0_0_14px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]"
              :title="card.song ? t('footer.openPlayer') : undefined"
              :disabled="!card.song"
              :tabindex="card.slot === 'current' ? 0 : -1"
              @click.stop="openPlayerPanelFromCover"
            >
              <img
                v-if="getCoverUrl(card.song)"
                :src="getCoverUrl(card.song) || ''"
                class="size-full object-cover"
                :alt="card.song?.title || ''"
                draggable="false"
              />
              <SvgIcon v-else name="common-music" class-name="size-6" />
            </button>
            <div class="min-w-0">
              <p class="truncate text-sm font-semibold text-text">
                {{ card.song?.title || t('footer.noTrack') }}
              </p>
              <p class="truncate text-xs text-text-l">
                {{ card.song?.artist || t('footer.defaultArtist') }}
              </p>
              <p class="truncate text-[10px] text-text-l">
                {{ card.slot === 'current' ? audioSummary || '-' : '-' }}
              </p>
            </div>
          </article>
        </div>
      </div>
      <div v-else class="ep-footer-info flex min-w-0 items-center gap-3">
        <button
          class="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-primary to-violet-500 text-white shadow-[0_0_14px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]"
          :title="t('footer.openPlayer')"
          @click.stop="openPlayerPanelFromCover"
        >
          <img
            v-if="coverUrl && !coverFailed"
            :src="coverUrl"
            class="size-full object-cover"
            :alt="trackTitle"
            @error="coverFailed = true"
          />
          <SvgIcon v-else name="common-music" class-name="size-6" />
        </button>
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-text">{{ trackTitle }}</p>
          <p class="truncate text-xs text-text-l">{{ trackArtist }}</p>
          <p v-if="audioSummary" class="truncate text-[10px] text-text-l">
            {{ audioSummary }}
          </p>
        </div>
      </div>

      <div v-if="!collapsed" class="ep-footer-playback min-w-0 gap-1">
        <div
          ref="footerTransport"
          class="ep-footer-transport flex items-center justify-center gap-1.5"
        >
          <div class="ep-footer-transport-buttons flex items-center justify-center gap-1.5">
            <button
              class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10 disabled:cursor-not-allowed disabled:opacity-35"
              :title="t('footer.previous')"
              :disabled="!player.queue.length"
              @click.stop="playPrevious"
            >
              <SvgIcon name="play-prev" class-name="size-4" />
            </button>
            <button
              class="grid size-10 place-items-center rounded-full bg-primary text-white shadow-[0_0_12px_color-mix(in_srgb,var(--color-primary)_45%,transparent)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
              :disabled="!player.currentFile"
              :title="player.isPlaying ? t('footer.pause') : t('footer.play')"
              @click.stop="togglePlayback"
            >
              <SvgIcon :name="player.isPlaying ? 'play-pause' : 'play-play'" class-name="size-5" />
            </button>
            <button
              class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10 disabled:cursor-not-allowed disabled:opacity-35"
              :title="t('footer.next')"
              :disabled="!player.queue.length"
              @click.stop="playNext"
            >
              <SvgIcon name="play-next" class-name="size-4" />
            </button>
            <div
              ref="footerTime"
              class="ep-footer-top-time text-[11px] tabular-nums text-text-l"
              :title="player.positionFormatted + ' / ' + player.durationFormatted"
            >
              <span>{{ player.positionFormatted }}</span
              ><span class="ep-footer-total-time"> / {{ player.durationFormatted }}</span>
            </div>
          </div>
        </div>
        <div
          class="ep-footer-progress flex min-w-0 items-center gap-2 text-[11px] tabular-nums text-text-l"
        >
          <span class="shrink-0">{{ displayPositionFormatted }}</span>
          <BaseRange
            class="ep-range ep-playback-progress h-2 w-full min-w-0 flex-1 cursor-pointer disabled:cursor-default disabled:opacity-45"
            :min="0"
            :max="player.durationMs || 0"
            :value="displayPositionMs"
            :disabled="!player.durationMs"
            :aria-label="t('footer.progress')"
            @click.stop
            @input="previewSeek"
            @change="commitSeek"
            @pointercancel="cancelSeek"
            @blur="cancelSeek"
          />
          <span class="shrink-0">{{ player.durationFormatted }}</span>
        </div>
      </div>
      <div v-if="!collapsed" class="ep-footer-actions flex min-w-0 items-center justify-end gap-2">
        <div
          class="ep-footer-action-volume group relative"
          :title="t('footer.volumeValue', { value: Math.round(player.volume * 100) })"
          @click.stop
          @wheel="changeVolume"
        >
          <button
            class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10"
            type="button"
            :aria-label="t('footer.volumeValue', { value: Math.round(player.volume * 100) })"
          >
            <SvgIcon
              :name="player.volume === 0 ? 'volume-volume-mute' : 'volume-volume-high'"
              class-name="size-5"
            />
          </button>
          <div
            class="pointer-events-none absolute bottom-10 left-1/2 z-30 flex h-40 w-10 -translate-x-1/2 flex-col items-center gap-1 rounded-lg bg-[#090c11]/90 px-1 py-2 text-xs opacity-0 shadow-xl backdrop-blur-md transition-opacity duration-[var(--motion-duration-fast)] group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
          >
            <b class="tabular-nums text-text">{{ Math.round(player.volume * 100) }}%</b>
            <input
              class="absolute left-1/2 top-[5.5rem] h-1.5 w-32 -translate-x-1/2 -rotate-90 cursor-pointer accent-[var(--ep-progress-fill)]"
              type="range"
              min="0"
              max="100"
              step="5"
              :value="Math.round(player.volume * 100)"
              :aria-label="t('footer.volume')"
              @input="setVolume"
            />
          </div>
        </div>
        <button
          class="ep-footer-action-mode grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10"
          :title="playModeLabel"
          @click.stop="cyclePlayMode"
        >
          <SvgIcon :name="playModeIcon" class-name="size-5" />
        </button>
        <button
          class="ep-footer-action-secondary grid size-8 place-items-center rounded-full transition hover:bg-text/10"
          :class="currentPreference === 1 ? 'text-primary' : 'text-text'"
          :disabled="!player.currentQueueSong"
          :title="t('recommendation.like')"
          @click.stop="markCurrent(1)"
        >
          <SvgIcon
            :name="currentPreference === 1 ? 'play-like-fill' : 'play-like'"
            class-name="size-5"
          />
        </button>
        <button
          class="ep-footer-action-secondary grid size-8 place-items-center rounded-full transition hover:bg-text/10"
          :class="currentPreference === -1 ? 'text-red-400' : 'text-text'"
          :disabled="!player.currentQueueSong"
          :title="t('recommendation.dislike')"
          @click.stop="markCurrent(-1)"
        >
          <SvgIcon name="play-dislike" class-name="size-6" />
        </button>
        <button
          class="ep-footer-action-queue grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10"
          :title="t('queue.title')"
          @click.stop="queueVisible = true"
        >
          <SvgIcon name="control-playlist" class-name="size-5" />
        </button>
        <button
          class="ep-footer-action-secondary grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10"
          :title="t('footer.desktopLyrics')"
          @click.stop="openDesktopLyrics"
        >
          <SvgIcon name="common-lyrics2" class-name="size-5" />
        </button>
        <div class="relative" @click.stop>
          <button
            class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10"
            :title="t('footer.more')"
            @click="toggleMoreMenu"
          >
            <SvgIcon name="menu-more-vertical" class-name="size-5" />
          </button>
          <div
            v-if="moreVisible"
            class="ep-menu custom-scrollbar absolute bottom-full right-0 z-[9999] mb-4 max-h-[min(70vh,480px)] w-56 overflow-y-auto rounded-xl border border-border bg-bg p-1 shadow-xl"
          >
            <div class="ep-footer-menu-volume items-center gap-2 px-3 py-2 text-sm">
              <SvgIcon
                :name="player.volume === 0 ? 'volume-volume-mute' : 'volume-volume-high'"
                class-name="size-4 shrink-0"
              />
              <label for="footer-menu-volume">{{ t('footer.volume') }}</label>
              <input
                id="footer-menu-volume"
                class="min-w-0 flex-1 accent-primary"
                type="range"
                min="0"
                max="100"
                :value="Math.round(player.volume * 100)"
                :aria-label="t('footer.volume')"
                @input="setVolume"
              />
            </div>
            <button class="ep-footer-menu-mode menu-item" @click="cyclePlayMode">
              <SvgIcon :name="playModeIcon" class-name="size-4 shrink-0" />
              {{ playModeLabel }}
            </button>
            <button class="ep-footer-menu-queue menu-item" @click="openQueueFromMenu">
              <SvgIcon name="control-playlist" class-name="size-4 shrink-0" />
              {{ t('queue.title') }}
            </button>
            <button
              class="ep-footer-menu-secondary menu-item"
              :class="currentPreference === 1 && 'text-primary'"
              :disabled="!player.currentQueueSong"
              @click="markCurrent(1)"
            >
              <SvgIcon
                :name="currentPreference === 1 ? 'play-like-fill' : 'play-like'"
                class-name="size-4 shrink-0"
              />
              {{ t('recommendation.like') }}
            </button>
            <button
              class="ep-footer-menu-secondary menu-item"
              :class="currentPreference === -1 && 'text-danger'"
              :disabled="!player.currentQueueSong"
              @click="markCurrent(-1)"
            >
              <SvgIcon name="play-dislike" class-name="size-4 shrink-0" />
              {{ t('recommendation.dislike') }}
            </button>
            <button class="ep-footer-menu-secondary menu-item" @click="openDesktopLyricsFromMenu">
              <SvgIcon name="common-lyrics2" class-name="size-4 shrink-0" />
              {{ t('footer.desktopLyrics') }}
            </button>
            <p v-if="!currentSong" class="px-3 py-2 text-xs text-text-l">
              {{ t('footer.noTrack') }}
            </p>
            <template v-if="currentSong">
              <button class="menu-item flex items-center gap-2" @click="openPlaylistPicker">
                <SvgIcon name="common-plus" class-name="size-4 shrink-0" />
                {{ t('songList.addToPlaylist') }}
              </button>
              <button class="menu-item flex items-center gap-2" @click="openTags">
                <SvgIcon name="common-tag-edit" class-name="size-4" />{{ t('songList.editTags') }}
              </button>
              <button
                v-for="artist in currentArtists"
                :key="artist"
                class="menu-item flex items-center gap-2"
                @click="openArtist(artist)"
              >
                <SvgIcon name="common-user" class-name="size-4 shrink-0" />
                <span class="min-w-0 truncate">{{ t('footer.goArtist') }} · {{ artist }}</span>
              </button>
              <button
                class="menu-item flex items-center gap-2"
                :disabled="!currentSong.album"
                @click="openAlbum"
              >
                <SvgIcon name="common-album" class-name="size-4" />
                {{ t('footer.goAlbum') }}
              </button>
              <button class="menu-item flex items-center gap-2" @click="openDetails">
                <SvgIcon name="common-detail" class-name="size-4" />{{ t('songList.details') }}
              </button>
              <button class="menu-item flex items-center gap-2" @click="openFolder">
                <SvgIcon name="common-folder" class-name="size-4" />{{ t('songList.openFolder') }}
              </button>
              <button class="menu-item flex items-center gap-2" @click="locateSong">
                <SvgIcon name="common-locate" class-name="size-4" />{{ t('footer.locateSong') }}
              </button>
              <button class="menu-item flex items-center gap-2" @click="openInLyricEditor">
                <SvgIcon name="common-edit-lrc" class-name="size-4" />
                {{ t('footer.openInLyricEditor') }}
              </button>
            </template>
          </div>
        </div>
      </div>

      <div
        v-if="collapsed"
        class="collapsed-footer-controls relative z-10 flex items-center gap-2 text-[11px] tabular-nums text-text-l"
      >
        <span>{{ player.positionFormatted }} / {{ player.durationFormatted }}</span>
        <button
          class="grid size-7 place-items-center rounded-full bg-primary text-white"
          :disabled="!player.currentFile"
          :title="player.isPlaying ? t('footer.pause') : t('footer.play')"
          @click.stop="togglePlayback"
        >
          <SvgIcon :name="player.isPlaying ? 'play-pause' : 'play-play'" class-name="size-3.5" />
        </button>
      </div>

      <button
        class="ep-footer-toggle grid size-8 place-items-center rounded-full bg-text/[0.07] text-text-l transition hover:scale-105 hover:bg-text/[0.13] hover:text-text"
        :class="collapsed && 'relative z-10'"
        :title="collapsed ? t('footer.expand') : t('footer.collapse')"
        :aria-label="collapsed ? t('footer.expand') : t('footer.collapse')"
        @click.stop="toggleCollapsed"
      >
        <SvgIcon
          :name="collapsed ? 'arrow-arrow-right-light' : 'arrow-arrow-left-light'"
          class-name="size-4"
        />
      </button>
    </section>
    <PlayQueueDrawer v-model="queueVisible" class="pointer-events-auto" />
    <SongDetailsDialog v-model="detailsVisible" :song-id="currentSong?.id ?? null" />
    <SongTagDialog v-model="tagVisible" :song-id="currentSong?.id ?? null" />
    <AddSongsToPlaylistDialog
      v-model="playlistVisible"
      :song-ids="currentSong ? [currentSong.id] : []"
    />
    <BaseDialog
      v-model="lyricSourceVisible"
      class="pointer-events-auto"
      :title="t('footer.chooseLyricSource')"
      width="max-w-sm"
    >
      <div class="grid gap-2">
        <button
          v-for="option in lyricSourceOptions"
          :key="option.source"
          class="menu-item rounded-xl border border-border px-4 py-3 text-left"
          @click="sendToLyricEditor(option)"
        >
          {{ t(`lyrics.source.${option.source}`) }}
        </button>
      </div>
    </BaseDialog>
  </div>
  <span
    v-if="footerPeekVisible"
    class="footer-peek pointer-events-auto absolute bottom-0 left-1/2"
    :class="{ 'footer-peek--playing': player.isPlaying }"
    role="status"
    :aria-label="player.isPlaying ? t('footer.playingStatus') : t('footer.pausedStatus')"
  >
    <span v-if="player.isPlaying" class="footer-peek-bars" aria-hidden="true">
      <i /><i /><i /><i />
    </span>
    <span v-else class="footer-peek-line" aria-hidden="true" />
  </span>
</template>

<style scoped>
.footer-peek {
  display: flex;
  width: 4rem;
  height: 0.875rem;
  align-items: center;
  justify-content: center;
  border: 1px solid color-mix(in srgb, var(--color-primary) 35%, var(--color-border));
  border-radius: 9999px;
  background: var(--color-bg-l);
  transform: translateX(-50%);
  animation: footer-peek-rise var(--motion-duration-slow) var(--motion-ease-emphasized) both;
}
@keyframes footer-peek-rise {
  from {
    opacity: 0;
    transform: translate(-50%, 100%);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}
.footer-peek--playing {
  box-shadow: 0 0 12px color-mix(in srgb, var(--color-primary) 35%, transparent);
}
.footer-peek-line {
  width: 2rem;
  height: 2px;
  border-radius: 9999px;
  background: var(--color-primary);
}
.footer-peek-bars {
  display: flex;
  height: 0.5rem;
  align-items: flex-end;
  gap: 3px;
}
.footer-peek-bars i {
  width: 2px;
  height: 100%;
  border-radius: 2px;
  background: var(--color-primary);
  transform-origin: bottom;
  animation: footer-peek-level 0.75s ease-in-out infinite alternate;
}
.footer-peek-bars i:nth-child(2) {
  animation-delay: -0.25s;
}
.footer-peek-bars i:nth-child(3) {
  animation-delay: -0.5s;
}
.footer-peek-bars i:nth-child(4) {
  animation-delay: -0.15s;
}
@keyframes footer-peek-level {
  from {
    transform: scaleY(0.35);
  }
  to {
    transform: scaleY(1);
  }
}
.app-footer {
  will-change: max-width, grid-template-columns;
  transition:
    max-width var(--motion-duration-emphasized) var(--motion-ease-spring),
    grid-template-columns var(--motion-duration-slow) var(--motion-ease-emphasized),
    gap var(--motion-duration-slow) var(--motion-ease-emphasized);
}
.app-footer--collapsed {
  position: relative;
  overflow: hidden;
  touch-action: pan-y;
  animation: footer-collapse-settle var(--motion-duration-emphasized) var(--motion-ease-spring);
}
.collapsed-song-carousel {
  position: absolute;
  inset: 0;
  z-index: 0;
  overflow: hidden;
}
.collapsed-song-track {
  display: flex;
  width: 300%;
  height: 100%;
  will-change: transform;
}
.collapsed-song-card {
  display: flex;
  width: 33.333333%;
  min-width: 0;
  flex: 0 0 33.333333%;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 9.5rem 0.625rem 1rem;
}
.collapsed-footer-controls {
  grid-column: 2;
}
.app-footer--expanded {
  animation: footer-expand-settle var(--motion-duration-emphasized) var(--motion-ease-spring);
}
@keyframes footer-collapse-settle {
  0% {
    transform: scaleX(1.008);
  }
  100% {
    transform: scaleX(1);
  }
}
@keyframes footer-expand-settle {
  0% {
    transform: scaleX(0.986);
  }
  100% {
    transform: scaleX(1);
  }
}
</style>
