<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { PlayMode } from '@/consts'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import PlayQueueDrawer from '@/components/player/PlayQueueDrawer.vue'
import AudioControlPanel from '@/components/player/AudioControlPanel.vue'
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

const ui = useUIStore()
const player = usePlayerStore()
const { t } = useI18n()
const router = useRouter()
const { error } = useMessage()
const collapsed = ref(false)
const queueVisible = ref(false)
const audioControlsVisible = ref(false)
const moreVisible = ref(false)
const detailsVisible = ref(false)
const tagVisible = ref(false)
const playlistVisible = ref(false)
const SWIPE_DISTANCE = 56
const SWIPE_DIRECTION_RATIO = 1.25
const SWIPE_SETTLE_DURATION = 240
const swipeOffset = ref(0)
const swipeTransitioning = ref(false)
const swipeCommitting = ref(false)
const collapsedCarouselRef = ref<HTMLElement | null>(null)
let swipePointerId: number | null = null
let swipeStartX = 0
let swipeStartY = 0
let swipeWasDragged = false
let suppressSwipeClick = false
let swipeSettleTimer: ReturnType<typeof setTimeout> | null = null
let pendingSwipeTargetIndex: number | null = null
const swipePreviousIndex = ref<number | null>(null)
const swipeNextIndex = ref<number | null>(null)

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

function refreshSwipeTargetIndices(): void {
  const previousIndex = player.getPreviousQueueIndex()
  const nextIndex = player.getNextQueueIndex()
  swipePreviousIndex.value = previousIndex >= 0 ? previousIndex : null
  swipeNextIndex.value = nextIndex >= 0 ? nextIndex : null
}

function getSwipeTargetIndex(direction: -1 | 1): number | null {
  return direction < 0 ? swipePreviousIndex.value : swipeNextIndex.value
}

interface CollapsedSongCard {
  slot: 'previous' | 'current' | 'next'
  song: LibrarySong | null
}

const frozenSwipeCards = ref<CollapsedSongCard[] | null>(null)
const collapsedSongCards = computed<CollapsedSongCard[]>(() => {
  const previousIndex = getSwipeTargetIndex(-1)
  const nextIndex = getSwipeTargetIndex(1)
  return [
    {
      slot: 'previous',
      song: previousIndex === null ? null : player.queue[previousIndex]
    },
    { slot: 'current', song: player.currentQueueSong },
    { slot: 'next', song: nextIndex === null ? null : player.queue[nextIndex] }
  ]
})
const renderedCollapsedSongCards = computed(
  () => frozenSwipeCards.value ?? collapsedSongCards.value
)
const collapsedTrackStyle = computed(() => ({
  transform: `translate3d(calc(-33.333333% + ${swipeOffset.value}px), 0, 0)`,
  transition: swipeTransitioning.value
    ? `transform ${ui.reduceMotion ? 0 : SWIPE_SETTLE_DURATION}ms cubic-bezier(0.22, 1, 0.36, 1)`
    : 'none'
}))
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
watch(
  [
    () => player.currentQueueIndex,
    () => player.playMode,
    () => player.queue.map((song) => song.id).join('|')
  ],
  refreshSwipeTargetIndices,
  { immediate: true }
)
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

function resetSwipe(): void {
  swipePointerId = null
  swipeStartX = 0
  swipeStartY = 0
  swipeWasDragged = false
}

function handleSwipePointerDown(event: PointerEvent): void {
  if (
    !collapsed.value ||
    swipeTransitioning.value ||
    swipeCommitting.value ||
    !event.isPrimary ||
    event.button !== 0
  )
    return
  swipePointerId = event.pointerId
  swipeStartX = event.clientX
  swipeStartY = event.clientY
  swipeOffset.value = 0
  swipeWasDragged = false
}

function handleSwipePointerMove(event: PointerEvent): void {
  if (!collapsed.value || swipePointerId !== event.pointerId) return
  const deltaX = event.clientX - swipeStartX
  const deltaY = event.clientY - swipeStartY
  if (Math.abs(deltaX) <= Math.abs(deltaY) || Math.abs(deltaX) < 4) return
  if (!swipeWasDragged) {
    frozenSwipeCards.value = collapsedSongCards.value.map((card) => ({ ...card }))
    const footer = event.currentTarget
    if (footer instanceof HTMLElement) footer.setPointerCapture(event.pointerId)
  }
  swipeWasDragged = true
  const targetIndex = getSwipeTargetIndex(deltaX < 0 ? 1 : -1)
  swipeOffset.value = targetIndex === null ? deltaX * 0.2 : deltaX
}

async function finishSwipeTransition(): Promise<void> {
  if (!swipeTransitioning.value) return
  if (swipeSettleTimer) clearTimeout(swipeSettleTimer)
  swipeSettleTimer = null
  const targetIndex = pendingSwipeTargetIndex
  pendingSwipeTargetIndex = null
  swipeTransitioning.value = false
  swipeCommitting.value = true
  await nextTick()
  try {
    if (targetIndex !== null) await player.playQueueItem(targetIndex)
  } finally {
    swipeOffset.value = 0
    frozenSwipeCards.value = null
    swipeCommitting.value = false
  }
}

function settleSwipe(targetIndex: number | null, direction: -1 | 0 | 1): void {
  swipeTransitioning.value = true
  pendingSwipeTargetIndex = targetIndex
  const width = collapsedCarouselRef.value?.clientWidth || 448
  swipeOffset.value = direction === 0 ? 0 : direction < 0 ? width : -width
  if (ui.reduceMotion) {
    void finishSwipeTransition()
    return
  }
  if (swipeSettleTimer) clearTimeout(swipeSettleTimer)
  swipeSettleTimer = setTimeout(() => void finishSwipeTransition(), SWIPE_SETTLE_DURATION + 100)
}

function handleSwipeTransitionEnd(event: TransitionEvent): void {
  if (event.target === event.currentTarget && event.propertyName === 'transform')
    void finishSwipeTransition()
}

function handleSwipePointerUp(event: PointerEvent): void {
  if (!collapsed.value || swipePointerId !== event.pointerId) return
  const deltaX = event.clientX - swipeStartX
  const deltaY = event.clientY - swipeStartY
  const isHorizontalSwipe =
    Math.abs(deltaX) >= SWIPE_DISTANCE &&
    Math.abs(deltaX) > Math.abs(deltaY) * SWIPE_DIRECTION_RATIO
  const direction = deltaX < 0 ? 1 : -1
  const targetIndex = getSwipeTargetIndex(direction)
  const wasDragged = swipeWasDragged
  resetSwipe()
  if (!wasDragged) return
  suppressSwipeClick = true
  settleSwipe(
    isHorizontalSwipe ? targetIndex : null,
    isHorizontalSwipe && targetIndex !== null ? direction : 0
  )
  window.setTimeout(() => {
    suppressSwipeClick = false
  }, 0)
}

function handleSwipePointerCancel(event: PointerEvent): void {
  if (swipePointerId !== event.pointerId) return
  const wasDragged = swipeWasDragged
  resetSwipe()
  if (wasDragged) settleSwipe(null, 0)
}

function handleFooterClickCapture(event: MouseEvent): void {
  if (!suppressSwipeClick) return
  suppressSwipeClick = false
  event.preventDefault()
  event.stopPropagation()
}

function cyclePlayMode(): void {
  player.setPlayMode(((player.playMode + 1) % 4) as PlayMode)
}

function seek(event: Event): void {
  void player.seek(Number((event.target as HTMLInputElement).value))
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

function openAudioControls(): void {
  audioControlsVisible.value = true
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
function toggleMoreMenu(): void {
  moreVisible.value = !moreVisible.value
  if (moreVisible.value) eventBus.emit('songActionsMenuOpened', 'footer')
}
const closeMoreMenu = (): void => {
  moreVisible.value = false
}
const onSongActionsMenuOpened = (source: 'footer' | 'songlist'): void => {
  if (source !== 'footer') closeMoreMenu()
}
onMounted(() => {
  eventBus.on('songActionsMenuOpened', onSongActionsMenuOpened)
  eventBus.on('openAudioControls', openAudioControls)
  window.addEventListener('click', closeMoreMenu)
})
onBeforeUnmount(() => {
  eventBus.off('songActionsMenuOpened', onSongActionsMenuOpened)
  eventBus.off('openAudioControls', openAudioControls)
  window.removeEventListener('click', closeMoreMenu)
  if (swipeSettleTimer) clearTimeout(swipeSettleTimer)
})
</script>

<template>
  <div
    class="pointer-events-none bg-gradient-to-t from-bg/30 px-4 pb-4 pt-2 max-[700px]:px-3 max-[700px]:pb-3 select-none"
  >
    <section
      class="app-footer pointer-events-auto mx-auto grid min-h-[72px] max-w-6xl items-center gap-6 rounded-3xl border px-4 py-2.5 text-text-l shadow-[0_12px_35px_rgb(0_0_0_/_20%)] backdrop-blur-2xl transition-all duration-300 max-[700px]:grid-cols-[auto_minmax(0,1fr)_auto] max-[700px]:gap-2.5 max-[700px]:px-3 max-[700px]:py-2"
      :class="
        collapsed
          ? 'app-footer--collapsed grid-cols-[minmax(0,1fr)_auto_auto] max-w-md gap-3'
          : 'app-footer--expanded grid-cols-[minmax(0,1fr)_minmax(270px,1.2fr)_minmax(0,1fr)_auto]'
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
      <div v-if="collapsed" ref="collapsedCarouselRef" class="collapsed-song-carousel">
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
              class="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-primary to-violet-500 text-white shadow-[0_5px_14px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]"
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
            </div>
          </article>
        </div>
      </div>
      <div v-else class="flex min-w-0 items-center gap-3">
        <button
          class="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-primary to-violet-500 text-white shadow-[0_5px_14px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]"
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

      <div v-if="!collapsed" class="grid gap-1 max-[700px]:hidden">
        <div class="flex items-center justify-center gap-1.5">
          <button
            class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10 disabled:cursor-not-allowed disabled:opacity-35"
            :title="t('footer.previous')"
            :disabled="!player.queue.length"
            @click.stop="playPrevious"
          >
            <SvgIcon name="play-prev" class-name="size-4" />
          </button>
          <button
            class="grid size-10 place-items-center rounded-full bg-primary text-white shadow-[0_4px_12px_color-mix(in_srgb,var(--color-primary)_45%,transparent)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
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
        </div>
        <div class="flex items-center gap-2 text-[11px] tabular-nums text-text-l">
          <span>{{ player.positionFormatted }}</span>
          <input
            class="h-2 w-full cursor-pointer appearance-auto accent-primary disabled:cursor-default disabled:opacity-45"
            type="range"
            min="0"
            :max="player.durationMs || 0"
            :value="player.positionMs"
            :disabled="!player.durationMs"
            :aria-label="t('footer.progress')"
            @click.stop
            @input="seek"
          />
          <span>{{ player.durationFormatted }}</span>
        </div>
      </div>
      <div v-if="!collapsed" class="flex min-w-0 items-center justify-end gap-2 max-[700px]:hidden">
        <div
          class="group relative"
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
            class="pointer-events-none absolute bottom-10 left-1/2 z-30 flex h-40 w-10 -translate-x-1/2 flex-col items-center gap-1 rounded-lg bg-[#090c11]/90 px-1 py-2 text-xs opacity-0 shadow-xl backdrop-blur-md transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
          >
            <b class="tabular-nums text-text">{{ Math.round(player.volume * 100) }}%</b>
            <input
              class="absolute left-1/2 top-[5.5rem] h-1.5 w-28 -translate-x-1/2 -rotate-90 cursor-pointer accent-primary"
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
          class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10"
          :title="playModeLabel"
          @click.stop="cyclePlayMode"
        >
          <SvgIcon :name="playModeIcon" class-name="size-5" />
        </button>
        <button
          class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10"
          :title="t('queue.title')"
          @click.stop="queueVisible = true"
        >
          <SvgIcon name="control-playlist" class-name="size-5" />
        </button>
        <button
          class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10"
          :title="t('footer.audioControls')"
          @click.stop="openAudioControls"
        >
          <SvgIcon name="common-equalizer" class-name="size-4" />
        </button>
        <button
          class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10"
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
            v-if="moreVisible && currentSong"
            class="absolute bottom-full right-0 z-[9999] mb-4 w-48 rounded-xl border border-border bg-bg p-1 shadow-xl"
          >
            <button class="menu-item flex items-center gap-2" @click="openPlaylistPicker">
              <SvgIcon name="control-playlist" class-name="size-4" />
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
              <SvgIcon name="common-user" class-name="size-4" />
              <span class="truncate">{{ t('footer.goArtist') }} · {{ artist }}</span>
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
        class="grid size-8 place-items-center rounded-full bg-text/[0.07] text-text-l transition hover:scale-105 hover:bg-text/[0.13] hover:text-text"
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
    <BaseDialog
      v-model="audioControlsVisible"
      class="pointer-events-auto"
      :title="t('footer.audioControls')"
      width="max-w-6xl"
    >
      <AudioControlPanel class="h-[72vh]" />
    </BaseDialog>
    <SongDetailsDialog v-model="detailsVisible" :song-id="currentSong?.id ?? null" />
    <SongTagDialog v-model="tagVisible" :song-id="currentSong?.id ?? null" />
    <AddSongsToPlaylistDialog
      v-model="playlistVisible"
      :song-ids="currentSong ? [currentSong.id] : []"
    />
  </div>
</template>

<style scoped>
.app-footer {
  border-color: var(--app-chrome-border, color-mix(in srgb, var(--color-text) 10%, transparent));
  background: var(--app-footer-bg, color-mix(in srgb, var(--color-bg) 78%, transparent));
  will-change: max-width, grid-template-columns;
  transition:
    max-width 0.4s cubic-bezier(0.34, 1.56, 0.64, 1),
    grid-template-columns 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    gap 0.32s cubic-bezier(0.22, 1, 0.36, 1),
    background-color 0.3s ease,
    border-color 0.3s ease;
}
.app-footer--collapsed {
  position: relative;
  overflow: hidden;
  touch-action: pan-y;
  animation: footer-collapse-settle 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
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
  animation: footer-expand-settle 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);
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
