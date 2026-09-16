<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
import type { LibrarySong, PagedLibrarySongs } from '@/types/library'
import eventBus from '@/utils/eventBus'
import { formatArtists } from '@/utils/artists'

interface Playlist {
  id: number
  name: string
  cover: string | null
}

const { t } = useI18n()
const player = usePlayerStore()
const ui = useUIStore()
const songs = ref<LibrarySong[]>([])
const playlists = ref<Playlist[]>([])
const activePlaylistId = ref<number | null>(null)
const centerIndex = ref(0)
const carouselRef = ref<HTMLElement | null>(null)
const playlistStripRef = ref<HTMLElement | null>(null)
const canScrollPlaylistsLeft = ref(false)
const canScrollPlaylistsRight = ref(false)
const cardWidth = ref(220)
const isLoading = ref(false)
const mounted = ref(false)
const isSwitchingPlaylist = ref(false)

let isDragging = false
let pointerStartX = 0
let startingIndex = 0
let lastX = 0
let lastTime = 0
let velocity = 0
let settleTimer: ReturnType<typeof setTimeout> | undefined
let inertiaFrame = 0
let resizeObserver: ResizeObserver | undefined
let isPlaylistDragging = false
let isPlaylistPointerDown = false
let suppressPlaylistClick = false
let playlistStartX = 0
let playlistStartScrollLeft = 0
let carouselWasDragged = false
let suppressCardClick = false

const renderCount = 9
const visibleSongs = computed(() => {
  const length = songs.value.length
  if (!length) return []
  const base = Math.round(centerIndex.value)
  const half = Math.floor(renderCount / 2)
  return Array.from({ length: renderCount }, (_, index) => {
    const virtualIndex = base + index - half
    const actualIndex = ((virtualIndex % length) + length) % length
    return { song: songs.value[actualIndex], virtualIndex, actualIndex }
  })
})

function getCoverUrl(cover: string | null): string | null {
  return cover ? `easy-player-media://cover?path=${encodeURIComponent(cover)}` : null
}
function updateCardWidth(): void {
  const width = carouselRef.value?.clientWidth || 0
  cardWidth.value = Math.max(156, Math.min(300, width / 5.2 || 220))
}
function getCardStyle(virtualIndex: number): Record<string, string | number> {
  const offset = virtualIndex - centerIndex.value
  const distance = Math.abs(offset)
  const scale = distance < 0.35 ? 1.24 : distance < 1.45 ? 0.86 : 0.64
  return {
    width: `${cardWidth.value}px`,
    transform: `translate(-50%, -50%) translateX(${offset * cardWidth.value * 0.88}px) scale(${scale})`,
    opacity: Math.max(0, 1 - Math.max(0, distance - 0.25) * 0.3),
    zIndex: Math.max(1, 20 - Math.floor(distance * 3))
  }
}
function centerOnSong(songId: number | undefined): void {
  if (!songId) return
  const index = songs.value.findIndex((song) => song.id === songId)
  if (index >= 0) centerIndex.value = index
}
function settle(): void {
  if (settleTimer) clearTimeout(settleTimer)
  settleTimer = setTimeout(() => {
    centerIndex.value = Math.round(centerIndex.value)
  }, 120)
}
function stopInertia(): void {
  if (inertiaFrame) cancelAnimationFrame(inertiaFrame)
  inertiaFrame = 0
}
function startInertia(): void {
  stopInertia()
  if (ui.reduceMotion) {
    centerIndex.value = Math.round(centerIndex.value)
    return
  }
  const step = (): void => {
    if (Math.abs(velocity) < 0.01) {
      centerIndex.value = Math.round(centerIndex.value)
      inertiaFrame = 0
      return
    }
    centerIndex.value -= (velocity * 18) / cardWidth.value
    velocity *= 0.92
    inertiaFrame = requestAnimationFrame(step)
  }
  inertiaFrame = requestAnimationFrame(step)
}
function onPointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  stopInertia()
  isDragging = true
  carouselWasDragged = false
  pointerStartX = event.clientX
  startingIndex = centerIndex.value
  lastX = event.clientX
  lastTime = performance.now()
}
function onPointerMove(event: PointerEvent): void {
  if (!isDragging) return
  const delta = event.clientX - pointerStartX
  if (Math.abs(delta) > 5) carouselWasDragged = true
  centerIndex.value = startingIndex - delta / cardWidth.value
  const now = performance.now()
  const elapsed = now - lastTime
  if (elapsed > 0) {
    velocity = (event.clientX - lastX) / elapsed
    lastX = event.clientX
    lastTime = now
  }
}
function onPointerUp(): void {
  if (!isDragging) return
  isDragging = false
  if (carouselWasDragged) {
    suppressCardClick = true
    setTimeout(() => (suppressCardClick = false), 0)
  }
  startInertia()
}
function onWheel(event: WheelEvent): void {
  event.preventDefault()
  stopInertia()
  centerIndex.value += event.deltaY / 460
  settle()
}
function onPlaylistPointerDown(event: PointerEvent): void {
  if (event.button !== 0 || !playlistStripRef.value) return
  isPlaylistDragging = false
  isPlaylistPointerDown = true
  playlistStartX = event.clientX
  playlistStartScrollLeft = playlistStripRef.value.scrollLeft
}
function onPlaylistPointerMove(event: PointerEvent): void {
  if (!playlistStripRef.value || !isPlaylistPointerDown) return
  const delta = event.clientX - playlistStartX
  if (Math.abs(delta) > 4) isPlaylistDragging = true
  playlistStripRef.value.scrollLeft = playlistStartScrollLeft - delta
}
function onPlaylistPointerUp(): void {
  isPlaylistPointerDown = false
  if (!isPlaylistDragging) return
  suppressPlaylistClick = true
  setTimeout(() => (suppressPlaylistClick = false), 0)
}
function onPlaylistWheel(event: WheelEvent): void {
  if (!playlistStripRef.value) return
  event.preventDefault()
  playlistStripRef.value.scrollLeft += event.deltaY || event.deltaX
}
function updatePlaylistScrollState(): void {
  const strip = playlistStripRef.value
  if (!strip) return
  const maxScrollLeft = strip.scrollWidth - strip.clientWidth
  canScrollPlaylistsLeft.value = strip.scrollLeft > 1
  canScrollPlaylistsRight.value = strip.scrollLeft < maxScrollLeft - 1
}
function scrollPlaylists(direction: -1 | 1): void {
  const strip = playlistStripRef.value
  if (!strip) return
  strip.scrollBy({ left: direction * Math.max(160, strip.clientWidth * 0.65), behavior: 'smooth' })
}
function handlePlaylistSelect(id: number | null): void {
  if (suppressPlaylistClick) return
  void selectPlaylist(id)
}
function onCoverPointerDown(event: PointerEvent): void {
  onPointerDown(event)
}
function handleCoverClick(song: LibrarySong): void {
  if (suppressCardClick) return
  void playSong(song)
}
async function playSong(song: LibrarySong): Promise<void> {
  if (song.songStatus === 0) return
  await player.playCollection(songs.value, song.id)
}
async function loadSongs(): Promise<void> {
  isLoading.value = true
  try {
    const response =
      activePlaylistId.value === null
        ? await window.api.database.command('querySongs', {})
        : await window.api.database.command('queryPlaylistSongs', {
            playlistId: activePlaylistId.value,
            query: {}
          })
    const data = response.success ? (response.data as PagedLibrarySongs) : null
    songs.value = data?.data.filter((song) => song.songStatus !== 0) || []
    centerIndex.value = 0
    await nextTick()
    centerOnSong(player.currentQueueSong?.id)
  } finally {
    isLoading.value = false
  }
}
async function loadPlaylists(): Promise<void> {
  const response = await window.api.database.command('listPlaylists')
  if (response.success) {
    playlists.value = response.data as Playlist[]
    await nextTick()
    updatePlaylistScrollState()
  }
}
async function selectPlaylist(id: number | null): Promise<void> {
  if (activePlaylistId.value === id) return
  isSwitchingPlaylist.value = true
  await new Promise<void>((resolve) => setTimeout(resolve, 150))
  activePlaylistId.value = id
  await loadSongs()
  await nextTick()
  requestAnimationFrame(() => (isSwitchingPlaylist.value = false))
}

watch(
  () => player.currentQueueSong?.id,
  (songId) => centerOnSong(songId)
)

onMounted(async () => {
  await Promise.all([loadPlaylists(), loadSongs()])
  resizeObserver = new ResizeObserver(() => {
    updateCardWidth()
    updatePlaylistScrollState()
  })
  if (carouselRef.value) resizeObserver.observe(carouselRef.value)
  if (playlistStripRef.value) resizeObserver.observe(playlistStripRef.value)
  updateCardWidth()
  updatePlaylistScrollState()
  requestAnimationFrame(() => (mounted.value = true))
  eventBus.on('playlistsChanged', loadPlaylists)
})
onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  stopInertia()
  if (settleTimer) clearTimeout(settleTimer)
  eventBus.off('playlistsChanged', loadPlaylists)
})
</script>

<template>
  <main class="card-view flex h-full min-h-0 flex-col overflow-hidden pb-30 text-text">
    <nav
      class="card-playlists flex shrink-0 items-center justify-center px-8 pb-3 pt-7"
      :aria-label="t('sidebar.playlists')"
    >
      <div class="playlist-strip-wrap">
        <div
          ref="playlistStripRef"
          class="playlist-strip"
          @pointerdown="onPlaylistPointerDown"
          @pointermove="onPlaylistPointerMove"
          @pointerup="onPlaylistPointerUp"
          @pointercancel="onPlaylistPointerUp"
          @lostpointercapture="onPlaylistPointerUp"
          @scroll="updatePlaylistScrollState"
          @wheel="onPlaylistWheel"
        >
          <button
            type="button"
            class="playlist-pill"
            :class="activePlaylistId === null && 'is-active'"
            @click="handlePlaylistSelect(null)"
          >
            {{ t('nav.songs') }}
          </button>
          <button
            v-for="playlist in playlists"
            :key="playlist.id"
            type="button"
            class="playlist-pill"
            :class="activePlaylistId === playlist.id && 'is-active'"
            @click="handlePlaylistSelect(playlist.id)"
          >
            {{ playlist.name }}
          </button>
        </div>
        <button
          v-if="canScrollPlaylistsLeft"
          type="button"
          class="playlist-scroll-arrow is-left"
          :aria-label="t('miniPlayer.previous')"
          @click="scrollPlaylists(-1)"
        >
          <SvgIcon name="arrow-arrow-left-light" class-name="size-4" />
        </button>
        <button
          v-if="canScrollPlaylistsRight"
          type="button"
          class="playlist-scroll-arrow is-right"
          :aria-label="t('miniPlayer.next')"
          @click="scrollPlaylists(1)"
        >
          <SvgIcon name="arrow-arrow-right-light" class-name="size-4" />
        </button>
      </div>
    </nav>

    <section
      class="card-stage relative min-h-0 flex-1"
      :class="[mounted && 'is-ready', isSwitchingPlaylist && 'is-switching']"
    >
      <div
        ref="carouselRef"
        class="card-carousel absolute inset-0"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @lostpointercapture="onPointerUp"
        @wheel="onWheel"
      >
        <article
          v-for="item in visibleSongs"
          :key="`${item.song.id}-${item.virtualIndex}`"
          class="card-item absolute left-1/2 top-1/2"
          :style="getCardStyle(item.virtualIndex)"
        >
          <button
            type="button"
            class="card-cover group relative block aspect-square w-full overflow-hidden rounded-2xl border border-white/20 bg-bg-l text-left shadow-2xl"
            :disabled="item.song.songStatus === 0"
            @pointerdown.stop="onCoverPointerDown"
            @click.stop="handleCoverClick(item.song)"
          >
            <img
              v-if="getCoverUrl(item.song.cover)"
              :src="getCoverUrl(item.song.cover) || ''"
              class="size-full object-cover"
              :alt="item.song.title"
              draggable="false"
            />
            <span
              v-else
              class="grid size-full place-items-center bg-gradient-to-br from-primary/75 to-violet-500/70"
            >
              <SvgIcon name="common-music" class-name="size-16 text-white/80" />
            </span>
            <span class="card-reflection" aria-hidden="true">
              <img
                v-if="getCoverUrl(item.song.cover)"
                :src="getCoverUrl(item.song.cover) || ''"
                class="size-full object-cover"
                alt=""
                draggable="false"
              />
            </span>
            <span class="card-play-overlay grid place-items-center">
              <span
                class="grid size-14 place-items-center rounded-full bg-white/90 text-black shadow-xl transition-transform duration-200 group-hover:scale-110"
              >
                <SvgIcon
                  :name="
                    player.currentQueueSong?.id === item.song.id && player.isPlaying
                      ? 'play-pause'
                      : 'play-play'
                  "
                  class-name="size-6"
                />
              </span>
            </span>
          </button>
          <div class="mt-4 w-full text-center">
            <p
              class="truncate text-base font-bold transition-colors"
              :class="player.currentQueueSong?.id === item.song.id ? 'text-primary' : 'text-text'"
              :title="item.song.title"
            >
              {{ item.song.title }}
            </p>
            <p class="mt-1 truncate text-sm text-text-l">
              {{
                formatArtists(item.song.artist, ui.artistSeparator, ui.normalizeArtistSeparator) ||
                t('playerPanel.defaultArtist')
              }}
            </p>
          </div>
        </article>
        <p v-if="isLoading" class="absolute left-1/2 top-1/2 -translate-x-1/2 text-sm text-text-l">
          {{ t('library.loading') }}
        </p>
        <p
          v-else-if="!songs.length"
          class="absolute left-1/2 top-1/2 -translate-x-1/2 text-sm text-text-l"
        >
          {{ t('library.empty') }}
        </p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.card-view {
  background:
    radial-gradient(
      circle at 50% 15%,
      color-mix(in srgb, var(--color-primary) 16%, transparent),
      transparent 38%
    ),
    linear-gradient(180deg, color-mix(in srgb, var(--color-bg-l) 45%, transparent), transparent 35%);
}
.card-stage {
  opacity: 0;
  transition: opacity 380ms ease;
}
.card-stage.is-ready {
  opacity: 1;
}
.card-carousel {
  user-select: none;
  touch-action: pan-y;
  transition:
    opacity 150ms ease,
    transform 150ms ease;
}
.card-stage.is-switching .card-carousel {
  pointer-events: none;
  opacity: 0;
  transform: scale(0.985);
}
.card-item {
  transform-origin: center;
  transition:
    transform 260ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 220ms ease;
}
.card-cover {
  -webkit-box-reflect: below 0.1rem linear-gradient(to bottom, rgb(0 0 0 / 16%), transparent 68%);
}
.card-reflection {
  display: none;
}
.card-play-overlay {
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / 42%);
  opacity: 0;
  transition: opacity 180ms ease;
}
.card-cover:hover .card-play-overlay,
.card-cover:focus-visible .card-play-overlay {
  opacity: 1;
}
.card-cover:disabled {
  cursor: not-allowed;
  filter: grayscale(1);
  opacity: 0.45;
}
.card-playlists {
  background: transparent;
}
.playlist-strip {
  display: flex;
  width: 100%;
  gap: 0.4rem;
  overflow-x: auto;
  scrollbar-width: none;
  cursor: grab;
  user-select: none;
  touch-action: pan-y;
  overscroll-behavior-x: contain;
}
.playlist-strip-wrap {
  position: relative;
  width: min(80vw, 56rem);
  max-width: min(80vw, 56rem);
  padding: 0.35rem 2.35rem;
  border: 1px solid color-mix(in srgb, var(--color-border) 80%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-bg-l) 58%, transparent);
  box-shadow: 0 10px 24px rgb(0 0 0 / 12%);
}
.playlist-scroll-arrow {
  position: absolute;
  top: 50%;
  z-index: 1;
  display: grid;
  width: 1.75rem;
  height: 1.75rem;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--color-border) 86%, transparent);
  border-radius: 999px;
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-bg-l) 92%, transparent);
  box-shadow: 0 3px 10px rgb(0 0 0 / 16%);
  transform: translateY(-50%);
}
.playlist-scroll-arrow:hover {
  color: white;
  background: var(--color-primary);
}
.playlist-scroll-arrow.is-left {
  left: 0.35rem;
}
.playlist-scroll-arrow.is-right {
  right: 0.35rem;
}
.playlist-strip:active {
  cursor: grabbing;
}
.playlist-strip::-webkit-scrollbar {
  display: none;
}
.playlist-pill {
  flex: 0 0 auto;
  max-width: 13rem;
  overflow: hidden;
  padding: 0.45rem 0.9rem;
  border-radius: 999px;
  color: var(--color-text-l);
  font-size: 0.8125rem;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition:
    color 160ms ease,
    background-color 160ms ease,
    transform 160ms ease;
}
.playlist-pill:hover {
  color: var(--color-text);
  background: var(--color-hover);
  transform: translateY(-1px);
}
.playlist-pill.is-active {
  color: white;
  background: var(--color-primary);
  box-shadow: 0 4px 14px color-mix(in srgb, var(--color-primary) 42%, transparent);
}
@media (prefers-reduced-motion: reduce) {
  .card-stage,
  .card-item,
  .card-play-overlay,
  .playlist-pill {
    transition: none;
  }
}
</style>
