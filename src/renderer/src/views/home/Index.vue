<script setup lang="ts">
import {
  computed,
  onActivated,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  shallowRef
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import Draggable from 'vuedraggable'
import HomeClock from '@/components/home/HomeClock.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import {
  DEFAULT_HIDDEN_HOME_SECTIONS,
  DEFAULT_HOME_SECTION_ORDER,
  useUIStore
} from '@/stores/ui/uiStore'
import { useMessage } from '@/components/ui/useMessage'
import type { LibrarySong, PagedLibrarySongs } from '@/types/library'
import { formatArtists } from '@/utils/artists'
import eventBus from '@/utils/eventBus'

interface OverviewStats {
  songCount: number
  albumCount: number
  artistCount: number
  librarySize: number
  totalPlaySeconds: number
  todayPlaySeconds: number
  eligiblePlays: number
  completedPlays: number
  timePeriods: Array<{
    id: 'lateNight' | 'morning' | 'noon' | 'earlyAfternoon' | 'afternoon' | 'evening'
    playedSeconds: number
    plays: number
  }>
}
interface HistoryDay {
  date: string
  seconds: number
}
interface RankedSong extends LibrarySong {
  value: number
}
interface Playlist {
  id: number
  name: string
  cover: string | null
  description: string | null
}
type RecommendationGroup = 'recommended' | 'discovery'
interface RecommendationCard {
  group: RecommendationGroup
  generatedFor: string
  songs: LibrarySong[]
  total: number
}

const { t } = useI18n()
const { success, warning, error: showError } = useMessage()
const router = useRouter()
const player = usePlayerStore()
const uiStore = useUIStore()
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

const stats = ref<OverviewStats>({
  songCount: 0,
  albumCount: 0,
  artistCount: 0,
  librarySize: 0,
  totalPlaySeconds: 0,
  todayPlaySeconds: 0,
  eligiblePlays: 0,
  completedPlays: 0,
  timePeriods: []
})

const historyDays = ref<HistoryDay[]>([])
const topPlayed = ref<RankedSong[]>([])
const topDuration = ref<RankedSong[]>([])
const playlists = ref<Playlist[]>([])
const playingPlaylistId = ref<number | null>(null)
const recommendationIcons: Record<RecommendationGroup, string> = {
  recommended: 'play-like',
  discovery: 'control-shuffle'
}
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
  const customText = uiStore.homeWelcomeText.trim()
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
const statCards = computed(() => [
  { label: t('home.stats.songs'), value: String(stats.value.songCount), icon: 'menu-song' },
  {
    label: t('home.stats.albums'),
    value: String(stats.value.albumCount),
    icon: 'common-album-light'
  },
  { label: t('home.stats.artists'), value: String(stats.value.artistCount), icon: 'menu-artist' },
  {
    label: t('home.stats.librarySize'),
    value: formatBytes(stats.value.librarySize),
    icon: 'common-database'
  },
  {
    label: t('home.stats.totalDuration'),
    value: formatHours(stats.value.totalPlaySeconds),
    icon: 'common-time'
  },
  {
    label: t('home.stats.todayDuration'),
    value: formatTodayDuration(stats.value.todayPlaySeconds),
    icon: 'common-time'
  },
  {
    label: t('home.stats.completionRate'),
    value: stats.value.eligiblePlays
      ? `${((stats.value.completedPlays / stats.value.eligiblePlays) * 100).toFixed(1)}%`
      : '—',
    icon: 'common-task',
    hint: t('home.completionCounts', {
      completed: stats.value.completedPlays,
      eligible: stats.value.eligiblePlays
    }),
    title: t('home.completionRule')
  }
])
const periodColors = ['#5e9cce', '#64bdae', '#a48ad4', '#e5a971', '#d8799b', '#8fbe6d']
const periodCircumference = 2 * Math.PI * 19
const hoveredPeriodId = ref<OverviewStats['timePeriods'][number]['id'] | null>(null)
const totalPeriodSeconds = computed(() =>
  stats.value.timePeriods.reduce((sum, period) => sum + period.playedSeconds, 0)
)
const periodSegments = computed(() => {
  let start = 0
  return stats.value.timePeriods.flatMap((period, index) => {
    if (!period.playedSeconds || !totalPeriodSeconds.value) return []
    const length = (period.playedSeconds / totalPeriodSeconds.value) * periodCircumference
    const segment = {
      ...period,
      color: periodColors[index],
      dasharray: `${length} ${periodCircumference}`,
      dashoffset: -start
    }
    start += length
    return [segment]
  })
})
const longestPeriod = computed(() =>
  totalPeriodSeconds.value
    ? stats.value.timePeriods.reduce((longest, period) =>
        period.playedSeconds > longest.playedSeconds ? period : longest
      )
    : null
)
const displayedPeriod = computed(
  () =>
    stats.value.timePeriods.find((period) => period.id === hoveredPeriodId.value) ??
    longestPeriod.value
)
const historyMap = computed(
  () => new Map(historyDays.value.map((item) => [item.date, item.seconds]))
)
const heatmapDays = computed(() => {
  const days: Array<{ date: string; seconds: number }> = []
  const today = new Date()
  for (let index = 364; index >= 0; index--) {
    const date = new Date(today)
    date.setDate(today.getDate() - index)
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    days.push({ date: key, seconds: historyMap.value.get(key) || 0 })
  }
  return days
})
const maxHeat = computed(() => Math.max(1, ...heatmapDays.value.map((item) => item.seconds)))
const monthMarkers = computed(() =>
  heatmapDays.value
    .map((day, index) => ({ day, index, week: Math.floor(index / 7) }))
    .filter(({ day, index }) => index === 0 || day.date.endsWith('-01'))
    .map(({ day, week }) => ({
      date: day.date,
      week,
      label: new Intl.DateTimeFormat(uiStore.locale === 'zh' ? 'zh-CN' : 'en-US', {
        month: 'short'
      }).format(new Date(`${day.date}T00:00:00`))
    }))
)

function formatDuration(seconds: number): string {
  if (!seconds) return t('home.duration.zero')
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days) return t('home.duration.dayHour', { days, hours })
  if (hours) return t('home.duration.hourMinute', { hours, minutes })
  return t('home.duration.minute', { minutes: Math.max(1, minutes) })
}
function formatHours(seconds: number): string {
  return `${(Math.max(0, seconds) / 3600).toFixed(1)} h`
}
function formatTodayDuration(seconds: number): string {
  const hours = Math.floor(Math.max(0, seconds) / 3600)
  const minutes = Math.floor((Math.max(0, seconds) % 3600) / 60)
  if (hours) return `${hours} h ${minutes} m`
  return `${seconds > 0 ? Math.max(1, minutes) : 0} m`
}
function formatPeriodDuration(seconds: number): string {
  if (seconds >= 3600) return formatHours(seconds)
  if (seconds >= 60) return t('home.duration.minuteDecimal', { minutes: (seconds / 60).toFixed(1) })
  return seconds > 0
    ? t('home.duration.second', { seconds: Math.max(1, Math.round(seconds)) })
    : t('home.duration.zero')
}
function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`
}
function heatClass(seconds: number): string {
  if (!seconds) return 'bg-hover'

  const ratio = seconds / maxHeat.value

  switch (true) {
    case ratio > 0.75:
      return 'bg-primary'
    case ratio > 0.45:
      return 'bg-primary/70'
    case ratio > 0.2:
      return 'bg-primary/40'
    default:
      return 'bg-primary/20'
  }
}
function coverUrl(song: RankedSong): string | null {
  return song.cover ? `easy-player-media://cover?path=${encodeURIComponent(song.cover)}` : null
}
function playlistCoverUrl(playlist: Playlist): string | null {
  return playlist.cover
    ? `easy-player-media://cover?path=${encodeURIComponent(playlist.cover)}`
    : null
}
function recommendationCardKey(card: RecommendationCard): string {
  return `${card.group}:${card.generatedFor}`
}
function recommendationCardName(card: RecommendationCard): string {
  return `${t(`recommendation.${card.group}`)} · ${card.generatedFor}`
}
function recommendationCoverUrl(card: RecommendationCard): string | null {
  const cover = card.songs.find((song) => song.cover)?.cover
  return cover ? `easy-player-media://cover?path=${encodeURIComponent(cover)}` : null
}
function todayKey(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
async function loadRecommendations(): Promise<void> {
  const response = await window.api.database.command('getHomeRecommendations')
  if (!response.success) return
  recommendationCards.value = response.data as RecommendationCard[]
}
async function loadPlaylists(): Promise<void> {
  const response = await window.api.database.command('listPlaylists')
  if (response.success) playlists.value = response.data as Playlist[]
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
    const response = await window.api.database.command('queryPlaylistSongs', {
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
  const index = songs.findIndex((item) => item.id === song.id)
  if (index < 0) return
  player.setQueue(songs)
  await player.playQueueItem(index)
}
async function load(): Promise<void> {
  loading.value = true
  try {
    const [statsResult, daysResult, playedResult, durationResult, playlistsResult] =
      await Promise.all([
        window.api.database.command('getOverviewStats'),
        window.api.database.command('getPlayHistoryDays', { days: 365 }),
        window.api.database.command('getTopPlayedSongs', { limit: 10 }),
        window.api.database.command('getTopDurationSongs', { limit: 10 }),
        window.api.database.command('listPlaylists'),
        loadRecommendations()
      ])
    if (statsResult.success) stats.value = statsResult.data as OverviewStats
    if (daysResult.success) historyDays.value = daysResult.data as HistoryDay[]
    if (playedResult.success) topPlayed.value = playedResult.data as RankedSong[]
    if (durationResult.success) topDuration.value = durationResult.data as RankedSong[]
    if (playlistsResult.success) playlists.value = playlistsResult.data as Playlist[]
  } finally {
    loading.value = false
  }
}
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
  if (recommendationDateTimer) clearInterval(recommendationDateTimer)
})
</script>

<template>
  <main class="custom-scrollbar select-none h-full overflow-y-auto px-7 py-6 text-text">
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
        <section v-if="section === 'recommendations'" class="xl:col-span-2">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-lg font-semibold">{{ t('recommendation.title') }}</h2>
            <button
              class="text-sm text-text-l hover:text-primary"
              @click="router.push('/recommend')"
            >
              {{ t('home.viewRecommendations') }}
            </button>
          </div>
          <div class="flex flex-wrap gap-4">
            <article
              v-for="card in recommendationCards"
              :key="recommendationCardKey(card)"
              class="w-36 shrink-0"
            >
              <button
                class="group relative grid size-36 place-items-center overflow-hidden rounded-xl bg-bg-l disabled:cursor-not-allowed disabled:opacity-50"
                :aria-label="
                  activeRecommendationCard === recommendationCardKey(card) && player.isPlaying
                    ? t('footer.pause')
                    : t('home.playRecommendation', { name: recommendationCardName(card) })
                "
                :title="
                  activeRecommendationCard === recommendationCardKey(card) && player.isPlaying
                    ? t('footer.pause')
                    : t('home.playRecommendation', { name: recommendationCardName(card) })
                "
                :disabled="
                  pendingRecommendationCard !== null ||
                  playingPlaylistId !== null ||
                  card.total === 0
                "
                @click="playRecommendation(card)"
              >
                <img
                  v-if="recommendationCoverUrl(card)"
                  :src="recommendationCoverUrl(card)!"
                  class="size-full object-cover transition-transform duration-[var(--motion-duration-standard)] group-hover:scale-105"
                  :alt="t(`recommendation.${card.group}`)"
                />
                <SvgIcon
                  v-else
                  :name="recommendationIcons[card.group]"
                  class-name="size-12 text-primary"
                />
                <span
                  v-if="card.total > 0"
                  class="playlist-cover-overlay pointer-events-none absolute inset-0 bg-black/45 opacity-0 transition-opacity duration-[var(--motion-duration-standard)] group-hover:opacity-100 group-focus-visible:opacity-100"
                  aria-hidden="true"
                />
                <span
                  v-if="card.total > 0"
                  class="playlist-cover-action pointer-events-none absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 scale-90 place-items-center rounded-full bg-primary text-white opacity-0 shadow-lg transition-all duration-[var(--motion-duration-standard)] group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100"
                >
                  <SvgIcon
                    :name="
                      activeRecommendationCard === recommendationCardKey(card) && player.isPlaying
                        ? 'play-pause'
                        : 'play-play'
                    "
                    class-name="size-6"
                  />
                </span>
              </button>
              <button
                class="mt-2 block w-full truncate text-center text-sm font-medium hover:text-primary focus-visible:text-primary disabled:cursor-not-allowed"
                :class="
                  activeRecommendationCard === recommendationCardKey(card) ? 'text-primary' : ''
                "
                :aria-label="recommendationCardName(card)"
                :title="recommendationCardName(card)"
                :disabled="
                  pendingRecommendationCard !== null ||
                  playingPlaylistId !== null ||
                  card.total === 0
                "
                @click="playRecommendation(card)"
              >
                {{ t(`recommendation.${card.group}`) }}
              </button>
              <p class="text-center text-xs text-text-l">{{ card.generatedFor }}</p>
              <p class="text-center text-xs text-text-l">
                {{ t('home.recommendationCount', { count: card.total }) }}
              </p>
            </article>
          </div>
        </section>
        <section v-if="section === 'playlists'" class="xl:col-span-2">
          <h2 class="mb-3 text-lg font-semibold">{{ t('home.playlists') }}</h2>
          <div v-if="playlists.length" class="flex flex-wrap gap-4">
            <article v-for="playlist in playlists" :key="playlist.id" class="w-36 shrink-0">
              <button
                class="group relative grid size-36 place-items-center overflow-hidden rounded-xl bg-bg-l"
                :aria-label="
                  activePlaylistId === playlist.id && player.isPlaying
                    ? t('footer.pause')
                    : t('home.playPlaylist', { name: playlist.name })
                "
                :title="
                  activePlaylistId === playlist.id && player.isPlaying
                    ? t('footer.pause')
                    : t('home.playPlaylist', { name: playlist.name })
                "
                :disabled="playingPlaylistId !== null"
                @click="playPlaylist(playlist)"
              >
                <img
                  v-if="playlistCoverUrl(playlist)"
                  :src="playlistCoverUrl(playlist)!"
                  class="size-full object-cover transition-transform duration-[var(--motion-duration-standard)] group-hover:scale-105"
                  :alt="playlist.name"
                />
                <SvgIcon v-else name="common-music" class-name="size-12 text-text-l" />
                <span
                  class="playlist-cover-overlay pointer-events-none absolute inset-0 bg-black/45 opacity-0 transition-opacity duration-[var(--motion-duration-standard)] group-hover:opacity-100 group-focus-visible:opacity-100"
                  aria-hidden="true"
                />
                <span
                  class="playlist-cover-action pointer-events-none absolute left-1/2 top-1/2 grid size-12 -translate-x-1/2 -translate-y-1/2 scale-90 place-items-center rounded-full bg-primary text-white opacity-0 shadow-lg transition-all duration-[var(--motion-duration-standard)] group-hover:scale-100 group-hover:opacity-100 group-focus-visible:scale-100 group-focus-visible:opacity-100"
                >
                  <SvgIcon
                    :name="
                      activePlaylistId === playlist.id && player.isPlaying
                        ? 'play-pause'
                        : 'play-play'
                    "
                    class-name="size-6"
                  />
                </span>
              </button>
              <button
                class="mt-2 block w-full truncate text-center text-sm font-medium hover:text-primary focus-visible:text-primary"
                :class="activePlaylistId === playlist.id ? 'text-primary' : ''"
                :aria-label="
                  activePlaylistId === playlist.id
                    ? `${playlist.name} · ${t('home.nowPlaying')}`
                    : playlist.name
                "
                :title="playlist.name"
                @click="router.push(`/playlist/${playlist.id}`)"
              >
                {{ playlist.name }}
              </button>
              <p
                v-if="playlist.description"
                class="truncate text-center text-xs text-text-l"
                :title="playlist.description"
              >
                {{ playlist.description }}
              </p>
            </article>
          </div>
          <p v-else-if="!loading" class="py-6 text-center text-sm text-text-l">
            {{ t('home.noPlaylists') }}
          </p>
        </section>
        <section v-if="section === 'overview'" class="xl:col-span-2">
          <div class="mb-3 flex items-center justify-between">
            <h2 class="text-lg font-semibold">{{ t('home.overview') }}</h2>
            <button
              class="btn-hover flex items-center gap-1.5 px-2 py-1 text-sm"
              :disabled="refreshing"
              @click="refresh"
            >
              <SvgIcon
                name="common-refresh"
                class-name="size-4"
                :class="refreshing ? 'animate-spin' : ''"
              />
              {{ t('home.refresh') }}
            </button>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <article
              v-for="item in statCards"
              :key="item.label"
              class="home-surface home-stat group flex h-24 items-center gap-4 rounded-xl p-4 transition-all duration-[var(--motion-duration-standard)] hover:-translate-y-1"
              :title="item.title"
            >
              <span
                class="grid size-14 place-items-center rounded-lg bg-primary/15 text-primary transition-transform duration-[var(--motion-duration-standard)] group-hover:scale-110 group-hover:rotate-3"
              >
                <SvgIcon :name="item.icon" class-name="size-5" />
              </span>
              <div>
                <p class="text-xs text-text-l">{{ item.label }}</p>
                <p class="mt-1 text-2xl font-semibold">{{ loading ? '—' : item.value }}</p>
                <p v-if="item.hint && !loading" class="mt-1 text-xs text-text-l">
                  {{ item.hint }}
                </p>
              </div>
            </article>
            <article
              class="home-surface home-stat flex h-24 items-center gap-4 rounded-xl p-4 transition-all duration-[var(--motion-duration-standard)] hover:-translate-y-1"
              :title="t('home.listeningPeriodsHint')"
            >
              <svg
                class="size-14 shrink-0"
                viewBox="0 0 48 48"
                role="group"
                :aria-label="t('home.listeningPeriods')"
              >
                <circle
                  cx="24"
                  cy="24"
                  r="19"
                  fill="none"
                  stroke="var(--color-border)"
                  stroke-width="8"
                />
                <circle
                  v-for="period in periodSegments"
                  :key="period.id"
                  cx="24"
                  cy="24"
                  r="19"
                  fill="none"
                  :stroke="period.color"
                  stroke-width="8"
                  :stroke-dasharray="period.dasharray"
                  :stroke-dashoffset="period.dashoffset"
                  transform="rotate(-90 24 24)"
                  tabindex="0"
                  :aria-label="`${t(`home.periods.${period.id}`)} · ${t(`home.periodRanges.${period.id}`)} · ${t('home.listeningPeriodTooltip', { count: period.plays, duration: formatPeriodDuration(period.playedSeconds) })}`"
                  @mouseenter="hoveredPeriodId = period.id"
                  @mouseleave="hoveredPeriodId = null"
                  @focus="hoveredPeriodId = period.id"
                  @blur="hoveredPeriodId = null"
                >
                  <title>
                    {{ t(`home.periods.${period.id}`) }} ·
                    {{ t(`home.periodRanges.${period.id}`) }} ·
                    {{
                      t('home.listeningPeriodTooltip', {
                        count: period.plays,
                        duration: formatPeriodDuration(period.playedSeconds)
                      })
                    }}
                  </title>
                </circle>
              </svg>
              <div class="min-w-0">
                <p class="text-xs text-text-l">{{ t('home.listeningPeriods') }}</p>
                <p class="mt-1 truncate text-xl font-semibold">
                  {{ !loading && displayedPeriod ? t(`home.periods.${displayedPeriod.id}`) : '—' }}
                </p>
                <p v-if="!loading && displayedPeriod" class="mt-1 text-xs text-text-l">
                  {{ formatPeriodDuration(displayedPeriod.playedSeconds) }} ·
                  {{ Math.round((displayedPeriod.playedSeconds / totalPeriodSeconds) * 100) }}%
                </p>
              </div>
            </article>
          </div>
        </section>
        <section v-if="section === 'heatmap'" class="home-surface rounded-xl p-5 xl:col-span-2">
          <div class="mb-4 flex items-center justify-between">
            <h2 class="text-lg font-semibold">{{ t('home.heatmap') }}</h2>
            <span class="text-xs text-text-l">{{ t('home.lastYear') }}</span>
          </div>
          <div class="overflow-x-auto pb-1">
            <div class="w-max min-w-[53rem]">
              <div class="relative mb-1 h-4 text-[10px] text-text-l">
                <span
                  v-for="marker in monthMarkers"
                  :key="marker.date"
                  class="absolute whitespace-nowrap"
                  :style="{ left: `${marker.week * 16}px` }"
                  >{{ marker.label }}</span
                >
              </div>
              <div class="grid grid-flow-col grid-rows-7 gap-1 [grid-auto-columns:0.75rem]">
                <span
                  v-for="day in heatmapDays"
                  :key="day.date"
                  class="size-3 rounded-sm"
                  :class="heatClass(day.seconds)"
                  :title="
                    t('home.heatmapValue', { date: day.date, value: formatDuration(day.seconds) })
                  "
                />
              </div>
            </div>
          </div>
          <p class="mt-3 text-xs text-text-l">{{ t('home.heatmapHint') }}</p>
        </section>
        <article v-if="section === 'topPlayed'" class="home-surface rounded-xl p-5">
          <h2 class="mb-3 text-lg font-semibold">{{ t('home.topPlayed') }}</h2>
          <ol v-if="topPlayed.length" class="space-y-1">
            <li v-for="(song, index) in topPlayed" :key="song.id">
              <button
                class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-hover"
                @dblclick="playRanked(topPlayed, song)"
              >
                <span class="w-5 text-center text-sm text-text-l">{{ index + 1 }}</span>
                <img
                  v-if="coverUrl(song)"
                  :src="coverUrl(song)!"
                  class="size-9 shrink-0 rounded-md object-cover"
                  :alt="song.title"
                />
                <span v-else class="grid size-9 shrink-0 place-items-center rounded-md bg-hover">
                  <SvgIcon name="common-music" class-name="size-4" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm">{{ song.title }}</span>
                  <span class="block truncate text-xs text-text-l">{{
                    formatArtists(
                      song.artist,
                      uiStore.artistSeparator,
                      uiStore.normalizeArtistSeparator
                    ) || t('songList.unknownArtist')
                  }}</span>
                </span>
                <span class="text-xs text-text-l">{{
                  t('home.playCount', { count: song.value })
                }}</span>
              </button>
            </li>
          </ol>
          <p v-else class="py-8 text-center text-sm text-text-l">
            {{ t('home.noStats') }}
          </p>
        </article>
        <article v-if="section === 'topDuration'" class="home-surface rounded-xl p-5">
          <h2 class="mb-3 text-lg font-semibold">{{ t('home.topDuration') }}</h2>
          <ol v-if="topDuration.length" class="space-y-1">
            <li v-for="(song, index) in topDuration" :key="song.id">
              <button
                class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-hover"
                @dblclick="playRanked(topDuration, song)"
              >
                <span class="w-5 text-center text-sm text-text-l">{{ index + 1 }}</span>
                <img
                  v-if="coverUrl(song)"
                  :src="coverUrl(song)!"
                  class="size-9 shrink-0 rounded-md object-cover"
                  :alt="song.title"
                />
                <span v-else class="grid size-9 shrink-0 place-items-center rounded-md bg-hover">
                  <SvgIcon name="common-music" class-name="size-4" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm">{{ song.title }}</span>
                  <span class="block truncate text-xs text-text-l">{{
                    formatArtists(
                      song.artist,
                      uiStore.artistSeparator,
                      uiStore.normalizeArtistSeparator
                    ) || t('songList.unknownArtist')
                  }}</span>
                </span>
                <span class="text-xs text-text-l">{{ formatDuration(song.value) }}</span>
              </button>
            </li>
          </ol>
          <p v-else class="py-8 text-center text-sm text-text-l">
            {{ t('home.noStats') }}
          </p>
        </article>
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

<style scoped>
.home-surface {
  border: 1px solid color-mix(in srgb, var(--color-border) 76%, transparent);
  background: color-mix(in srgb, var(--color-bg-l) 24%, transparent);
  box-shadow: 0 1px 1px color-mix(in srgb, var(--color-black-20) 30%, transparent);
  backdrop-filter: blur(8px);
}
.home-nav:hover {
  border-color: color-mix(in srgb, var(--color-primary) 42%, transparent);
  background: color-mix(in srgb, var(--color-primary) 10%, transparent);
}
.home-stat:hover {
  border-color: color-mix(in srgb, var(--color-primary) 32%, var(--color-border));
  background: color-mix(in srgb, var(--color-bg-l) 34%, transparent);
  box-shadow: 0 12px 26px color-mix(in srgb, var(--color-black-20) 48%, transparent);
}
@media (hover: none) {
  .playlist-cover-overlay,
  .playlist-cover-action {
    opacity: 1;
  }
  .playlist-cover-action {
    scale: 1;
  }
}
</style>
