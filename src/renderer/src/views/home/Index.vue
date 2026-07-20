<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
import { useMessage } from '@/components/ui/useMessage'
import type { LibrarySong } from '@/types/library'

interface OverviewStats {
  songCount: number
  albumCount: number
  artistCount: number
  librarySize: number
  totalPlaySeconds: number
  todayPlaySeconds: number
}
interface HistoryDay {
  date: string
  seconds: number
}
interface RankedSong extends LibrarySong {
  value: number
}

const { t } = useI18n()
const { success } = useMessage()
const router = useRouter()
const player = usePlayerStore()
const uiStore = useUIStore()
const loading = ref(true)

const stats = ref<OverviewStats>({
  songCount: 0,
  albumCount: 0,
  artistCount: 0,
  librarySize: 0,
  totalPlaySeconds: 0,
  todayPlaySeconds: 0
})

const historyDays = ref<HistoryDay[]>([])
const topPlayed = ref<RankedSong[]>([])
const topDuration = ref<RankedSong[]>([])
const refreshing = ref(false)

const greeting = computed(() => {
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
    value: formatDuration(stats.value.totalPlaySeconds),
    icon: 'common-time'
  },
  {
    label: t('home.stats.todayDuration'),
    value: formatDuration(stats.value.todayPlaySeconds),
    icon: 'common-time'
  }
])
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
    .map((day, index) => ({ day, week: Math.floor(index / 7) }))
    .filter(({ day, week }) => week === 0 || day.date.endsWith('-01'))
    .map(({ day, week }) => ({
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
async function playRanked(songs: RankedSong[], song: RankedSong): Promise<void> {
  const index = songs.findIndex((item) => item.id === song.id)
  if (index < 0) return
  player.setQueue(songs)
  await player.playQueueItem(index)
}
async function load(): Promise<void> {
  loading.value = true
  try {
    const [statsResult, daysResult, playedResult, durationResult] = await Promise.all([
      window.api.database.command('getOverviewStats'),
      window.api.database.command('getPlayHistoryDays', { days: 365 }),
      window.api.database.command('getTopPlayedSongs', { limit: 10 }),
      window.api.database.command('getTopDurationSongs', { limit: 10 })
    ])
    if (statsResult.success) stats.value = statsResult.data as OverviewStats
    if (daysResult.success) historyDays.value = daysResult.data as HistoryDay[]
    if (playedResult.success) topPlayed.value = playedResult.data as RankedSong[]
    if (durationResult.success) topDuration.value = durationResult.data as RankedSong[]
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

onMounted(() => void load())
</script>

<template>
  <main class="custom-scrollbar select-none h-full overflow-y-auto px-7 py-6 text-text">
    <!-- text -->
    <section v-if="uiStore.showWelcomeText" class="mb-8">
      <p class="text-sm text-text-l">{{ t('home.welcome') }}</p>
      <h1 class="mt-1 text-3xl font-semibold tracking-tight">{{ greeting }}</h1>
    </section>
    <!-- navigation -->
    <section class="mb-9">
      <h2 class="mb-3 text-lg font-semibold">{{ t('home.quickNavigation') }}</h2>
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
        <button
          v-for="item in navigation"
          :key="item.path"
          class="group rounded-xl bg-bg-l p-3 text-left transition-colors hover:bg-hover"
          @click="router.push(item.path)"
        >
          <SvgIcon :name="item.icon" class-name="size-5 text-primary" />
          <span class="mt-3 truncate text-sm">{{ item.label }}</span>
        </button>
      </div>
    </section>
    <!-- stats -->
    <section class="mb-9">
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
          class="group flex items-center gap-4 rounded-xl bg-bg-l p-4 transition-all duration-200 hover:-translate-y-1 hover:bg-hover hover:shadow-lg hover:shadow-black/10"
        >
          <span
            class="grid size-10 place-items-center rounded-lg bg-primary/15 text-primary transition-transform duration-200 group-hover:scale-110 group-hover:rotate-3"
          >
            <SvgIcon :name="item.icon" class-name="size-5" />
          </span>
          <div>
            <p class="text-xs text-text-l">{{ item.label }}</p>
            <p class="mt-1 text-xl font-semibold">{{ loading ? '—' : item.value }}</p>
          </div>
        </article>
      </div>
    </section>
    <!-- heatMap -->
    <section class="mb-9 rounded-xl bg-bg-l p-5">
      <div class="mb-4 flex items-center justify-between">
        <h2 class="text-lg font-semibold">{{ t('home.heatmap') }}</h2>
        <span class="text-xs text-text-l">{{ t('home.lastYear') }}</span>
      </div>
      <div class="overflow-x-auto pb-1">
        <div class="w-max min-w-[53rem]">
          <div class="relative mb-1 h-4 text-[10px] text-text-l">
            <span
              v-for="marker in monthMarkers"
              :key="`${marker.week}-${marker.label}`"
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
    <!-- topPlayedData -->
    <section class="grid gap-6 xl:grid-cols-2">
      <article class="rounded-xl bg-bg-l p-5">
        <h2 class="mb-3 text-lg font-semibold">{{ t('home.topPlayed') }}</h2>
        <ol v-if="topPlayed.length" class="space-y-1">
          <li v-for="(song, index) in topPlayed" :key="song.id">
            <button
              class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-hover"
              @click="playRanked(topPlayed, song)"
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
                  song.artist || t('songList.unknownArtist')
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
      <article class="rounded-xl bg-bg-l p-5">
        <h2 class="mb-3 text-lg font-semibold">{{ t('home.topDuration') }}</h2>
        <ol v-if="topDuration.length" class="space-y-1">
          <li v-for="(song, index) in topDuration" :key="song.id">
            <button
              class="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-hover"
              @click="playRanked(topDuration, song)"
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
                  song.artist || t('songList.unknownArtist')
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
    </section>

    <div class="h-20" />
  </main>
</template>
