<script setup lang="ts">
import { onActivated, ref, watch } from 'vue'
import { useVisibleInterval } from '@/hooks/useVisibleInterval'
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useStatisticsStore } from '@/stores/statistics/statisticsStore'
import { useMessage } from '@/components/ui/useMessage'
import type { LibrarySong } from '@/types/library'
import SvgIcon from '@/components/svg/SvgIcon.vue'

type Reason =
  | 'liked'
  | 'replayed'
  | 'finished'
  | 'similarArtist'
  | 'similarAlbum'
  | 'similarGenre'
  | 'similarTag'
  | 'similarEra'
  | 'similarLength'
  | 'unheard'
  | 'skipped'
  | 'activelyChosen'
  | 'recentlyAdded'
  | 'lessRecommended'
interface RecommendedSong extends LibrarySong {
  songId: number
  preference: -1 | 0 | 1
  reason: Reason
  discoveryKind?: 'cold'
}
type Group = 'recommended' | 'discovery' | 'lessRecommended'

const { t } = useI18n()
const { error } = useMessage()
const player = usePlayerStore()
const statistics = useStatisticsStore()
const loading = ref(false)
const groups = ref<Record<Group, RecommendedSong[]>>({
  recommended: [],
  discovery: [],
  lessRecommended: []
})
const groupOrder: Group[] = ['recommended', 'discovery', 'lessRecommended']
const expandedGroups = ref<Record<Group, boolean>>({
  recommended: true,
  discovery: true,
  lessRecommended: true
})
const totals = ref<Record<Group, number>>({ recommended: 0, discovery: 0, lessRecommended: 0 })
const generatedFor = ref('')
const dataThrough = ref('')
const moreLoading = ref<Record<Group, boolean>>({
  recommended: false,
  discovery: false,
  lessRecommended: false
})
const playbackPending = ref(false)
const resettingSongIds = ref(new Set<number>())
let loadRevision = 0

function todayKey(): string {
  const date = new Date()
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

async function load(): Promise<void> {
  if (!statistics.enabled) return
  const revision = ++loadRevision
  loading.value = true
  try {
    const response = await window.api.database.command('getRecommendations', { limit: 20 })
    if (revision !== loadRevision) return
    if (response.success) {
      const data = response.data as Record<Group, RecommendedSong[]> & {
        totals: Record<Group, number>
        generatedFor: string
        dataThrough: string
      }
      groups.value = {
        recommended: data.recommended,
        discovery: data.discovery,
        lessRecommended: data.lessRecommended
      }
      totals.value = data.totals
      generatedFor.value = data.generatedFor
      dataThrough.value = data.dataThrough
    } else error(response.error)
  } finally {
    if (revision === loadRevision) loading.value = false
  }
}

async function showMore(group: Group): Promise<void> {
  if (!statistics.enabled) return
  const revision = loadRevision
  const offset = groups.value[group].length
  moreLoading.value[group] = true
  try {
    const response = await window.api.database.command('getRecommendationPage', {
      group,
      excludeSongIds: groups.value[group].map((song) => song.id),
      limit: 20
    })
    if (revision !== loadRevision || offset !== groups.value[group].length) return
    if (response.success) {
      const page = response.data as {
        items: RecommendedSong[]
        total: number
        generatedFor: string
      }
      if (page.generatedFor !== generatedFor.value) {
        await load()
        return
      }
      groups.value[group].push(...page.items)
      totals.value[group] = page.total
    } else error(response.error)
  } finally {
    moreLoading.value[group] = false
  }
}

async function setPreference(song: RecommendedSong, preference: -1 | 0 | 1): Promise<void> {
  if (!(await player.setPreference(song.id, preference))) {
    error(t('recommendation.failed'))
    return
  }
  song.preference = preference
}

async function resetRecommendation(song: RecommendedSong): Promise<void> {
  if (resettingSongIds.value.has(song.id)) return
  resettingSongIds.value.add(song.id)
  try {
    if (!(await player.resetSongRecommendation(song.id))) {
      error(t('recommendation.failed'))
      return
    }
    for (const group of groupOrder) {
      for (const item of groups.value[group]) if (item.id === song.id) item.preference = 0
    }
    groups.value.lessRecommended = groups.value.lessRecommended.filter(
      (item) => item.id !== song.id
    )
    totals.value.lessRecommended = Math.max(0, totals.value.lessRecommended - 1)
    await load()
  } catch {
    error(t('recommendation.failed'))
  } finally {
    resettingSongIds.value.delete(song.id)
  }
}

async function playGroup(group: Group, song: RecommendedSong): Promise<void> {
  if (!statistics.enabled) return
  const revision = loadRevision
  const response = await window.api.database.command('getRecommendationPage', {
    group,
    limit: 100
  })
  if (!response.success) {
    error(response.error)
    return
  }
  const page = response.data as { items: RecommendedSong[]; generatedFor: string }
  if (!statistics.enabled || revision !== loadRevision) return
  if (page.generatedFor !== generatedFor.value) {
    await load()
    return
  }
  const songs = page.items.filter((item) => item.songStatus !== 0)
  if (songs.some((item) => item.id === song.id))
    await player.playCollection(songs, song.id, null, 'recommendation')
}

function isCurrentSong(song: RecommendedSong): boolean {
  return player.currentQueueSong?.id === song.id && !!player.currentFile
}

async function toggleSongPlayback(group: Group, song: RecommendedSong): Promise<void> {
  if (playbackPending.value) return
  playbackPending.value = true
  try {
    if (isCurrentSong(song)) {
      if (player.isPlaying) await player.pause()
      else await player.play()
    } else await playGroup(group, song)
  } finally {
    playbackPending.value = false
  }
}

function coverUrl(song: RecommendedSong): string | null {
  return song.cover ? `easy-player-media://cover?path=${encodeURIComponent(song.cover)}` : null
}

onActivated(() => void load())
watch(
  () => statistics.generation,
  () => {
    ++loadRevision
    groups.value = { recommended: [], discovery: [], lessRecommended: [] }
    totals.value = { recommended: 0, discovery: 0, lessRecommended: 0 }
    generatedFor.value = ''
    dataThrough.value = ''
    loading.value = false
    if (statistics.enabled) void load()
  }
)
useVisibleInterval(() => {
  if (generatedFor.value && generatedFor.value !== todayKey()) void load()
}, 60_000)
</script>

<template>
  <main class="custom-scrollbar h-full overflow-y-auto px-7 py-6 text-text">
    <header class="mb-6 flex items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold">{{ t('recommendation.title') }}</h1>
        <p class="mt-2 max-w-2xl text-sm text-text-l">
          {{ t(statistics.enabled ? 'recommendation.description' : 'settings.statisticsDisabled') }}
        </p>
        <p v-if="dataThrough" class="mt-1 max-w-2xl text-xs text-text-l">
          {{ t('recommendation.dailySnapshot', { date: dataThrough }) }}
        </p>
      </div>
      <button
        class="btn-hover rounded-lg px-3 py-2 text-sm"
        :disabled="loading || !statistics.enabled"
        @click="load"
      >
        {{ t('recommendation.refresh') }}
      </button>
    </header>
    <section v-for="group in statistics.enabled ? groupOrder : []" :key="group" class="mb-8">
      <h2 class="mb-3">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-lg font-medium hover:bg-hover"
          :aria-expanded="expandedGroups[group]"
          :aria-controls="`recommendation-group-${group}`"
          :title="t(expandedGroups[group] ? 'recommendation.collapse' : 'recommendation.expand')"
          @click="expandedGroups[group] = !expandedGroups[group]"
        >
          <SvgIcon
            :name="expandedGroups[group] ? 'common-expand-up' : 'common-expand-down'"
            class-name="size-5 text-text-l"
          />
          <span>
            {{ t(`recommendation.${group}`) }}
            <span class="text-sm text-text-l">({{ totals[group] }})</span>
          </span>
        </button>
      </h2>
      <div v-show="expandedGroups[group]" :id="`recommendation-group-${group}`">
        <div v-if="groups[group].length" class="grid gap-2 lg:grid-cols-2">
          <article
            v-for="song in groups[group]"
            :key="song.id"
            class="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-border bg-bg-l/30 p-3 transition-[background-color,border-color,box-shadow] duration-200 hover:border-primary/40 hover:bg-hover hover:shadow-sm focus-within:border-primary/40"
          >
            <img
              v-if="coverUrl(song)"
              :src="coverUrl(song)!"
              :alt="song.title"
              class="size-12 shrink-0 rounded-lg object-cover"
            />
            <div v-else class="grid size-12 shrink-0 place-items-center rounded-lg bg-hover">♪</div>
            <div class="min-w-0 flex-1">
              <p class="truncate text-sm font-medium" :title="song.title">{{ song.title }}</p>
              <p class="truncate text-xs text-text-l">{{ song.artist || '—' }}</p>
              <p class="mt-1 text-xs text-primary">
                {{ t(`recommendation.reasons.${song.reason}`) }}
                <span
                  v-if="song.discoveryKind === 'cold'"
                  class="ml-2 text-amber-400"
                  :title="t('recommendation.coldHelp')"
                >
                  {{ t('recommendation.coldPick') }}
                </span>
              </p>
            </div>
            <div class="flex shrink-0 items-center gap-1">
              <button
                v-if="group === 'lessRecommended'"
                class="btn-hover rounded-md px-2 py-1 text-xs text-text-l"
                :title="t('recommendation.resetScoreHelp')"
                :disabled="resettingSongIds.has(song.id)"
                @click="resetRecommendation(song)"
              >
                {{ t('recommendation.removeAndReset') }}
              </button>
              <button
                class="btn-hover rounded-md px-2 py-1 text-xs"
                :title="
                  isCurrentSong(song) && player.isPlaying
                    ? t('recommendation.pause')
                    : t('recommendation.play')
                "
                :aria-label="
                  isCurrentSong(song) && player.isPlaying
                    ? t('recommendation.pause')
                    : t('recommendation.play')
                "
                :disabled="playbackPending"
                @click="toggleSongPlayback(group, song)"
              >
                <SvgIcon
                  :name="isCurrentSong(song) && player.isPlaying ? 'play-pause' : 'play-play'"
                  class-name="size-5"
                />
              </button>
              <button
                class="btn-hover rounded-md px-2 py-1 text-xs"
                :class="song.preference === 1 ? 'text-primary' : ''"
                :disabled="resettingSongIds.has(song.id)"
                :title="
                  song.preference === 1 ? t('recommendation.reset') : t('recommendation.like')
                "
                @click="setPreference(song, song.preference === 1 ? 0 : 1)"
              >
                <SvgIcon
                  :name="song.preference === 1 ? 'play-like-fill' : 'play-like'"
                  class-name="size-5"
                />
              </button>
              <button
                class="btn-hover rounded-md px-2 py-1 text-xs"
                :class="song.preference === -1 ? 'text-red-400' : ''"
                :disabled="resettingSongIds.has(song.id)"
                :title="
                  song.preference === -1 ? t('recommendation.reset') : t('recommendation.dislike')
                "
                @click="setPreference(song, song.preference === -1 ? 0 : -1)"
              >
                <SvgIcon name="play-dislike" class-name="size-6" />
              </button>
            </div>
          </article>
        </div>
        <button
          v-if="groups[group].length < totals[group]"
          class="btn-hover mt-3 rounded-lg px-3 py-2 text-sm"
          :disabled="loading || moreLoading[group]"
          @click="showMore(group)"
        >
          {{ t('recommendation.showMore') }} ({{ totals[group] - groups[group].length }})
        </button>
        <p v-if="!groups[group].length && !loading" class="py-5 text-sm text-text-l">
          {{ t('recommendation.empty') }}
        </p>
      </div>
    </section>
  </main>
</template>
