<script setup lang="ts">
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  watch,
  shallowRef
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import Draggable from 'vuedraggable'
import HomeClock from '@/components/home/HomeClock.vue'
import HomeHeatmap from './HomeHeatmap.vue'
import HomeOverview from './HomeOverview.vue'
import HomePlaylists from './HomePlaylists.vue'
import HomeRankedList from './HomeRankedList.vue'
import HomeRecommendations from './HomeRecommendations.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useStatisticsStore } from '@/stores/statistics/statisticsStore'
import {
  DEFAULT_HIDDEN_HOME_SECTIONS,
  DEFAULT_HOME_SECTION_ORDER,
  useUIStore
} from '@/stores/ui/uiStore'
import { useMessage } from '@/components/ui/useMessage'
import type { LibrarySong, PagedLibrarySongs } from '@/types/library'
import eventBus from '@/utils/eventBus'
import { LIKED_PLAYLIST_ID } from '@/constants/playlists'
import type { OverviewStats, HistoryDay, RankedSong, Playlist, RecommendationCard } from './types'
import './home.css'

const { t } = useI18n()
const { success, warning, error: showError } = useMessage()
const router = useRouter()
const player = usePlayerStore()
const uiStore = useUIStore()
const statistics = useStatisticsStore()
const statisticsSections = new Set([
  'overview',
  'heatmap',
  'topPlayed',
  'topDuration',
  'recommendations'
])
const loading = ref(true)
const defaultSectionOrder = DEFAULT_HOME_SECTION_ORDER
const legacyDefaultSectionOrders = [
  [
    'welcome',
    'clock',
    'navigation',
    'recommendations',
    'playlists',
    'overview',
    'heatmap',
    'topPlayed',
    'topDuration'
  ],
  ['welcome', 'clock', 'navigation', 'playlists', 'overview', 'heatmap', 'topPlayed', 'topDuration']
]
type HomeSection = (typeof defaultSectionOrder)[number]
const sectionLabels: Record<HomeSection, string> = {
  welcome: 'home.layout.welcome',
  clock: 'home.layout.clock',
  navigation: 'home.quickNavigation',
  recommendations: 'recommendation.title',
  playlists: 'home.playlists',
  overview: 'home.overview',
  heatmap: 'home.heatmap',
  topPlayed: 'home.topPlayed',
  topDuration: 'home.topDuration'
}
const sectionOrder = computed<HomeSection[]>({
  get: () => {
    const saved = Array.isArray(uiStore.homeSectionOrder) ? uiStore.homeSectionOrder : []
    const order = [...saved]
    if (!order.includes('recommendations')) {
      const playlistIndex = order.indexOf('playlists')
      order.splice(playlistIndex < 0 ? order.length : playlistIndex + 1, 0, 'recommendations')
    }
    return [...new Set([...order, ...defaultSectionOrder])].filter((id): id is HomeSection =>
      defaultSectionOrder.includes(id as HomeSection)
    )
  },
  set: (order) => {
    uiStore.homeSectionOrder = [...order]
  }
})
function sectionKey(id: HomeSection): string {
  return id
}
function isSectionVisible(id: HomeSection): boolean {
  if (!statistics.enabled && statisticsSections.has(id)) return false
  if (id === 'welcome') return uiStore.showWelcomeText
  if (id === 'clock') return uiStore.homeClockEnabled
  return !Array.isArray(uiStore.hiddenHomeSections) || !uiStore.hiddenHomeSections.includes(id)
}
const visibleSections = computed(() => sectionOrder.value.filter(isSectionVisible))
function setSectionVisible(id: HomeSection, visible: boolean | string | number): void {
  if (id === 'welcome') {
    uiStore.showWelcomeText = Boolean(visible)
    return
  }
  if (id === 'clock') {
    uiStore.homeClockEnabled = Boolean(visible)
    return
  }
  const hidden = Array.isArray(uiStore.hiddenHomeSections) ? uiStore.hiddenHomeSections : []
  uiStore.hiddenHomeSections = visible
    ? hidden.filter((item) => item !== id)
    : [...new Set([...hidden, id])]
}
function resetLayout(): void {
  sectionOrder.value = [...defaultSectionOrder]
  uiStore.hiddenHomeSections = [...DEFAULT_HIDDEN_HOME_SECTIONS]
  uiStore.homeClockEnabled = false
  uiStore.showWelcomeText = true
}
function migrateLegacyDefaultLayout(): void {
  const saved = uiStore.homeSectionOrder
  const isLegacyDefault = legacyDefaultSectionOrders.some(
    (order) => saved.length === order.length && saved.every((id, index) => id === order[index])
  )
  if (
    !isLegacyDefault ||
    !uiStore.showWelcomeText ||
    uiStore.homeClockEnabled ||
    uiStore.hiddenHomeSections.length
  )
    return
  resetLayout()
}
migrateLegacyDefaultLayout()

const emptyStats: OverviewStats = {
  songCount: 0,
  albumCount: 0,
  artistCount: 0,
  librarySize: 0,
  totalPlaySeconds: 0,
  todayPlaySeconds: 0,
  eligiblePlays: 0,
  completedPlays: 0,
  quality: {
    standard: { count: 0, bytes: 0 },
    high: { count: 0, bytes: 0 },
    ultra: { count: 0, bytes: 0 },
    lossless: { count: 0, bytes: 0 },
    bitrateCount: 0,
    sizeFallbackCount: 0,
    unknownCount: 0,
    thresholds: {
      highKbps: 320,
      ultraKbps: 500,
      losslessKbps: 800,
      highMiB: 10,
      ultraMiB: 20,
      losslessMiB: 30
    }
  },
  timePeriods: []
}
const stats = ref<OverviewStats>(structuredClone(emptyStats))

const historyDays = ref<HistoryDay[]>([])
const topPlayed = ref<RankedSong[]>([])
const topDuration = ref<RankedSong[]>([])
const userPlaylists = ref<Playlist[]>([])
const likedCover = ref<string | null>(null)
const playlists = computed<Playlist[]>(() => [
  {
    id: LIKED_PLAYLIST_ID,
    name: t('playlist.likedSongs'),
    cover: likedCover.value,
    description: ''
  },
  ...userPlaylists.value
])
const playingPlaylistId = ref<number | null>(null)
const recommendationCards = ref<RecommendationCard[]>([])
const recommendationGeneratedFor = computed(
  () => recommendationCards.value.find((card) => card.group === 'recommended')?.generatedFor ?? ''
)
const playingRecommendationCard = ref<string | null>(null)
const recommendationQueue = shallowRef<LibrarySong[] | null>(null)
const pendingRecommendationCard = ref<string | null>(null)
const refreshing = ref(false)
let recommendationDateTimer: ReturnType<typeof setInterval> | undefined
const activePlaylistId = computed(() =>
  player.currentQueueSong && (player.isPlaying || player.isPaused) ? player.queuePlaylistId : null
)
const activeRecommendationCard = computed(() =>
  player.currentQueueSong &&
  (player.isPlaying || player.isPaused) &&
  recommendationQueue.value === player.queue
    ? playingRecommendationCard.value
    : null
)

const greeting = computed(() => {
  const customText = (uiStore.customThemeText.homeWelcome ?? uiStore.homeWelcomeText).trim()
  if (customText) return customText
  const hour = new Date().getHours()
  const key = (() => {
    switch (true) {
      case hour < 6:
        return 'night'
      case hour < 11:
        return 'morning'
      case hour < 14:
        return 'noon'
      case hour < 18:
        return 'afternoon'
      default:
        return 'evening'
    }
  })()

  return t(`home.greeting.${key}`, { name: uiStore.userName })
})
const navigation = computed(() => [
  { label: t('nav.songs'), path: '/song', icon: 'menu-song' },
  { label: t('nav.artists'), path: '/artist', icon: 'menu-artist' },
  { label: t('nav.albums'), path: '/album', icon: 'menu-album' },
  { label: t('nav.genres'), path: '/genre', icon: 'menu-genre' },
  { label: t('nav.localFiles'), path: '/local', icon: 'menu-folder' },
  { label: t('nav.remoteFiles'), path: '/remote', icon: 'menu-remote' },
  { label: t('nav.history'), path: '/history', icon: 'menu-history' },
  { label: t('nav.settings'), path: '/settings', icon: 'menu-settings' }
])

function recommendationCardKey(card: RecommendationCard): string {
  return `${card.group}:${card.generatedFor}`
}
function todayKey(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
async function loadRecommendations(): Promise<void> {
  if (!statistics.enabled) return
  const generation = statistics.generation
  const response = await window.api.database.command('getHomeRecommendations')
  if (!response.success || !statistics.enabled || generation !== statistics.generation) return
  recommendationCards.value = response.data as RecommendationCard[]
}
async function loadPlaylists(): Promise<void> {
  const [playlistsResponse, coverResponse] = await Promise.all([
    window.api.database.command('listPlaylists'),
    window.api.database.command('getLikedPlaylistCover')
  ])
  if (playlistsResponse.success) userPlaylists.value = playlistsResponse.data as Playlist[]
  if (coverResponse.success)
    likedCover.value = (coverResponse.data as { cover: string | null }).cover
}
async function playPlaylist(playlist: Playlist): Promise<void> {
  if (playingPlaylistId.value !== null || pendingRecommendationCard.value !== null) return
  playingPlaylistId.value = playlist.id
  try {
    if (activePlaylistId.value === playlist.id) {
      const changed = player.isPlaying ? await player.pause() : await player.play()
      if (!changed) showError(t('playlist.playFailed'))
      return
    }
    const response =
      playlist.id === LIKED_PLAYLIST_ID
        ? await window.api.database.command('querySongs', { preference: 1 })
        : await window.api.database.command('queryPlaylistSongs', {
            playlistId: playlist.id,
            query: {}
          })
    if (!response.success) {
      showError(response.error || t('playlist.playFailed'))
      return
    }
    const songs = (response.data as PagedLibrarySongs).data.filter((song) => song.songStatus !== 0)
    if (!songs.length) {
      warning(t('playlist.empty'))
      return
    }
    if (!(await player.playCollection(songs, songs[0].id, playlist.id)))
      showError(t('playlist.playFailed'))
  } finally {
    playingPlaylistId.value = null
  }
}
async function playRecommendation(card: RecommendationCard): Promise<void> {
  if (!statistics.enabled) return
  const generation = statistics.generation
  if (pendingRecommendationCard.value !== null || playingPlaylistId.value !== null) return
  const cardKey = recommendationCardKey(card)
  pendingRecommendationCard.value = cardKey
  try {
    if (activeRecommendationCard.value === cardKey) {
      const changed = player.isPlaying ? await player.pause() : await player.play()
      if (!changed) showError(t('home.playRecommendationFailed'))
      return
    }
    const response = await window.api.database.command('getHomeRecommendationSongs', {
      group: card.group,
      generatedFor: card.generatedFor
    })
    if (!statistics.enabled || generation !== statistics.generation) return
    if (!response.success) {
      showError(response.error || t('home.playRecommendationFailed'))
      return
    }
    const songs = (response.data as LibrarySong[]).filter((song) => song.songStatus !== 0)
    if (!songs.length) {
      warning(t('home.noRecommendationSongs'))
      void loadRecommendations()
      return
    }
    if (!(await player.playCollection(songs, songs[0].id, null, 'recommendation'))) {
      showError(t('home.playRecommendationFailed'))
      return
    }
    playingRecommendationCard.value = cardKey
    recommendationQueue.value = player.queue
  } finally {
    pendingRecommendationCard.value = null
  }
}
async function playRanked(songs: RankedSong[], song: RankedSong): Promise<void> {
  if (!statistics.enabled) return
  const index = songs.findIndex((item) => item.id === song.id)
  if (index < 0) return
  player.setQueue(songs)
  await player.playQueueItem(index)
}
async function loadStatistics(): Promise<void> {
  if (!statistics.enabled) return
  const generation = statistics.generation
  const [statsResult, daysResult, playedResult, durationResult] = await Promise.all([
    window.api.database.command('getOverviewStats'),
    window.api.database.command('getPlayHistoryDays', { days: 365 }),
    window.api.database.command('getTopPlayedSongs', { limit: 10 }),
    window.api.database.command('getTopDurationSongs', { limit: 10 })
  ])
  if (!statistics.enabled || generation !== statistics.generation) return
  if (statsResult.success) stats.value = statsResult.data as OverviewStats
  if (daysResult.success) historyDays.value = daysResult.data as HistoryDay[]
  if (playedResult.success) topPlayed.value = playedResult.data as RankedSong[]
  if (durationResult.success) topDuration.value = durationResult.data as RankedSong[]
}
async function load(): Promise<void> {
  loading.value = true
  try {
    await Promise.all([loadStatistics(), loadPlaylists(), loadRecommendations()])
  } finally {
    loading.value = false
  }
}
watch(
  () => statistics.generation,
  () => {
    stats.value = structuredClone(emptyStats)
    historyDays.value = []
    topPlayed.value = []
    topDuration.value = []
    recommendationCards.value = []
    playingRecommendationCard.value = null
    recommendationQueue.value = null
    if (statistics.enabled) void load()
  }
)
async function refresh(): Promise<void> {
  refreshing.value = true
  try {
    await load()
    success(`${t('home.refreshSuccess')}`)
  } finally {
    refreshing.value = false
  }
}

onMounted(() => {
  void load()
  eventBus.on('playlistsChanged', loadPlaylists)
  eventBus.on('songPreferenceChanged', loadPlaylists)
  eventBus.on('scanFinished', loadPlaylists)
  recommendationDateTimer = setInterval(() => {
    if (recommendationGeneratedFor.value && recommendationGeneratedFor.value !== todayKey())
      void loadRecommendations()
  }, 60_000)
})
onActivated(() => {
  if (!loading.value) void loadRecommendations()
})
onDeactivated(() => {
  uiStore.homeLayoutOpen = false
})
onBeforeUnmount(() => {
  uiStore.homeLayoutOpen = false
  eventBus.off('playlistsChanged', loadPlaylists)
  eventBus.off('songPreferenceChanged', loadPlaylists)
  eventBus.off('scanFinished', loadPlaylists)
  if (recommendationDateTimer) clearInterval(recommendationDateTimer)
})
</script>

<template>
  <main
    class="ep-home home-page custom-scrollbar select-none h-full overflow-y-auto px-7 py-6 text-text"
  >
    <div class="grid grid-cols-1 gap-6 xl:grid-cols-2">
      <template v-for="section in visibleSections" :key="section">
        <section v-if="section === 'welcome'" class="xl:col-span-2">
          <p class="text-sm text-text-l">{{ t('home.welcome') }}</p>
          <h1 class="mt-1 whitespace-pre-wrap break-words text-3xl font-semibold tracking-tight">
            {{ greeting }}
          </h1>
        </section>
        <HomeClock v-if="section === 'clock'" class="xl:col-span-2" />
        <section v-if="section === 'navigation'" class="xl:col-span-2">
          <h2 class="mb-3 text-lg font-semibold">{{ t('home.quickNavigation') }}</h2>
          <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            <button
              v-for="item in navigation"
              :key="item.path"
              class="home-surface home-nav group rounded-xl p-3 text-left transition-colors"
              @click="router.push(item.path)"
            >
              <SvgIcon :name="item.icon" class-name="size-5 text-primary" />
              <span class="mt-3 truncate text-sm">{{ item.label }}</span>
            </button>
          </div>
        </section>
        <HomeRecommendations
          v-if="section === 'recommendations'"
          :cards="recommendationCards"
          :active-card="activeRecommendationCard"
          :pending="pendingRecommendationCard !== null"
          :playlist-busy="playingPlaylistId !== null"
          :is-playing="player.isPlaying"
          @play="playRecommendation"
        />
        <HomePlaylists
          v-if="section === 'playlists'"
          :playlists="playlists"
          :loading="loading"
          :active-playlist-id="activePlaylistId"
          :busy="playingPlaylistId !== null"
          :is-playing="player.isPlaying"
          @play="playPlaylist"
        />
        <HomeOverview
          v-if="section === 'overview'"
          :stats="stats"
          :loading="loading"
          :refreshing="refreshing"
          @refresh="refresh"
        />
        <HomeHeatmap v-if="section === 'heatmap'" :history-days="historyDays" />
        <HomeRankedList
          v-if="section === 'topPlayed'"
          :songs="topPlayed"
          kind="played"
          @play="playRanked(topPlayed, $event)"
        />
        <HomeRankedList
          v-if="section === 'topDuration'"
          :songs="topDuration"
          kind="duration"
          @play="playRanked(topDuration, $event)"
        />
      </template>
    </div>
    <p v-if="!visibleSections.length" class="py-16 text-center text-sm text-text-l">
      {{ t('home.layout.empty') }}
    </p>
    <BaseDialog v-model="uiStore.homeLayoutOpen" :title="t('home.layout.customize')">
      <p class="mb-4 text-sm text-text-l">{{ t('home.layout.hint') }}</p>
      <Draggable
        v-model="sectionOrder"
        :item-key="sectionKey"
        handle=".home-drag-handle"
        :animation="uiStore.reduceMotion ? 0 : 150"
        class="custom-scrollbar max-h-[55vh] space-y-2 overflow-y-auto"
      >
        <template #item="{ element: id }">
          <div class="flex items-center gap-3 rounded-lg border border-border p-3">
            <span class="home-drag-handle cursor-grab text-text-l" :title="t('home.layout.drag')">
              <SvgIcon name="common-drag-handle" class-name="size-4" />
            </span>
            <span :id="`home-section-${id}`" class="min-w-0 flex-1 text-sm">
              {{ t(sectionLabels[id as HomeSection]) }}
            </span>
            <BaseSwitch
              :model-value="isSectionVisible(id)"
              :disabled="!statistics.enabled && statisticsSections.has(id)"
              :aria-labelledby="`home-section-${id}`"
              @update:model-value="setSectionVisible(id, $event)"
            />
          </div>
        </template>
      </Draggable>
      <template #footer>
        <button class="btn-hover px-3 py-2 text-sm" @click="resetLayout">
          {{ t('home.layout.reset') }}
        </button>
        <button
          class="rounded-lg bg-primary px-4 py-2 text-sm text-white"
          @click="uiStore.homeLayoutOpen = false"
        >
          {{ t('home.layout.done') }}
        </button>
      </template>
    </BaseDialog>

    <div class="h-20" />
  </main>
</template>
