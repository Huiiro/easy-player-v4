<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  shallowRef,
  watch
} from 'vue'
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import type { OverviewStats } from './types'

const props = defineProps<{ stats: OverviewStats; loading: boolean; refreshing: boolean }>()
const emit = defineEmits<{ refresh: [] }>()
const { t } = useI18n()
const uiStore = useUIStore()

const statCards = computed(() => [
  { label: t('home.stats.songs'), value: String(props.stats.songCount), icon: 'menu-song' },
  {
    label: t('home.stats.albums'),
    value: String(props.stats.albumCount),
    icon: 'common-album-light'
  },
  { label: t('home.stats.artists'), value: String(props.stats.artistCount), icon: 'menu-artist' },
  {
    label: t('home.stats.librarySize'),
    value: formatBytes(props.stats.librarySize),
    icon: 'common-database'
  },
  {
    label: t('home.stats.totalDuration'),
    value: formatHours(props.stats.totalPlaySeconds),
    icon: 'common-time'
  },
  {
    label: t('home.stats.todayDuration'),
    value: formatTodayDuration(props.stats.todayPlaySeconds),
    icon: 'common-time'
  },
  {
    label: t('home.stats.completionRate'),
    value: props.stats.eligiblePlays
      ? `${((props.stats.completedPlays / props.stats.eligiblePlays) * 100).toFixed(1)}%`
      : '—',
    icon: 'common-task',
    hint: t('home.completionCounts', {
      completed: props.stats.completedPlays,
      eligible: props.stats.eligiblePlays
    }),
    title: t('home.completionRule')
  }
])
const periodColors = ['#5e9cce', '#64bdae', '#a48ad4', '#e5a971', '#d8799b', '#8fbe6d']
const qualityColors = ['#5e9cce', '#64bdae', '#a48ad4', '#e5a971']
const totalPeriodSeconds = computed(() =>
  props.stats.timePeriods.reduce((sum, period) => sum + period.playedSeconds, 0)
)
const longestPeriod = computed(() =>
  totalPeriodSeconds.value
    ? props.stats.timePeriods.reduce((longest, period) =>
        period.playedSeconds > longest.playedSeconds ? period : longest
      )
    : null
)
const qualityLevels = computed(() =>
  (
    [
      { id: 'standard', ...props.stats.quality.standard },
      { id: 'high', ...props.stats.quality.high },
      { id: 'ultra', ...props.stats.quality.ultra },
      { id: 'lossless', ...props.stats.quality.lossless }
    ] as const
  ).map((level, index) => ({ ...level, color: qualityColors[index] }))
)
const knownQualityCount = computed(() =>
  qualityLevels.value.reduce((sum, level) => sum + level.count, 0)
)
const dominantQuality = computed(() =>
  knownQualityCount.value
    ? qualityLevels.value.reduce((largest, level) =>
        level.count > largest.count ? level : largest
      )
    : null
)
type StatDetail = 'periods' | 'quality'
const openStatDetail = ref<StatDetail | null>(null)
const donutCircumference = 2 * Math.PI * 48
const detailDonutSegments = computed(() => {
  const parts =
    openStatDetail.value === 'periods'
      ? props.stats.timePeriods.map((period, index) => ({
          id: period.id,
          label: t(`home.periods.${period.id}`),
          value: period.playedSeconds,
          color: periodColors[index]
        }))
      : qualityLevels.value.map((level) => ({
          id: level.id,
          label: t(`home.qualityLevels.${level.id}`),
          value: level.count,
          color: level.color
        }))
  const total = parts.reduce((sum, part) => sum + part.value, 0)
  let offset = 0
  return parts.flatMap((part) => {
    if (part.value <= 0 || total <= 0) return []
    const length = (part.value / total) * donutCircumference
    const segment = {
      ...part,
      percentage: Math.round((part.value / total) * 100),
      dasharray: `${length} ${donutCircumference}`,
      dashoffset: -offset
    }
    offset += length
    return [segment]
  })
})
const detailDonutSummary = computed(() => {
  if (openStatDetail.value === 'periods') {
    const period = longestPeriod.value
    return {
      label: period ? t(`home.periods.${period.id}`) : '—',
      percentage: period ? Math.round((period.playedSeconds / totalPeriodSeconds.value) * 100) : 0
    }
  }
  const level = dominantQuality.value
  return {
    label: level ? t(`home.qualityLevels.${level.id}`) : '—',
    percentage: level ? Math.round((level.count / knownQualityCount.value) * 100) : 0
  }
})
const detailPanel = shallowRef<HTMLElement | null>(null)
const detailTrigger = shallowRef<HTMLElement | null>(null)
const detailPlacement = ref<'top' | 'bottom'>('bottom')
const detailReady = ref(false)
const detailStyle = ref<Record<string, string>>({})
let detailFrame: number | null = null

function setDetailPanel(element: unknown): void {
  detailPanel.value = element instanceof HTMLElement ? element : null
}
function closeStatDetail(): void {
  if (detailFrame !== null) cancelAnimationFrame(detailFrame)
  detailFrame = null
  openStatDetail.value = null
  detailTrigger.value = null
  detailReady.value = false
}
function positionStatDetail(): void {
  const trigger = detailTrigger.value
  const panel = detailPanel.value
  if (!trigger || !panel) return
  const gap = 8
  const margin = 12
  const width = Math.min(520, window.innerWidth - margin * 2)
  panel.style.width = `${width}px`
  const anchor = trigger.getBoundingClientRect()
  const height = panel.offsetHeight
  const below = window.innerHeight - anchor.bottom
  const above = anchor.top
  detailPlacement.value = below < height + gap + margin && above > below ? 'top' : 'bottom'
  const targetTop =
    detailPlacement.value === 'top' ? anchor.top - height - gap : anchor.bottom + gap
  detailStyle.value = {
    width: `${width}px`,
    left: `${Math.max(margin, Math.min(anchor.right - width, window.innerWidth - width - margin))}px`,
    top: `${Math.max(margin, Math.min(targetTop, window.innerHeight - height - margin))}px`,
    maxHeight: `${window.innerHeight - margin * 2}px`
  }
  if (detailReady.value) return
  if (uiStore.reduceMotion) {
    detailReady.value = true
    return
  }
  if (detailFrame !== null) cancelAnimationFrame(detailFrame)
  detailFrame = requestAnimationFrame(() => {
    detailFrame = requestAnimationFrame(() => {
      detailFrame = null
      if (openStatDetail.value && detailPanel.value === panel) detailReady.value = true
    })
  })
}
async function toggleStatDetail(detail: StatDetail, event: MouseEvent): Promise<void> {
  if (openStatDetail.value === detail) {
    closeStatDetail()
    return
  }
  detailTrigger.value = event.currentTarget as HTMLElement
  openStatDetail.value = detail
  detailReady.value = false
  await nextTick()
  positionStatDetail()
}
function onStatDetailPointerDown(event: PointerEvent): void {
  const target = event.target
  if (!(target instanceof Node)) return
  if (detailPanel.value?.contains(target) || detailTrigger.value?.contains(target)) return
  closeStatDetail()
}
function onStatDetailKeyDown(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeStatDetail()
}
function onStatDetailScroll(event: Event): void {
  if (event.target instanceof Node && detailPanel.value?.contains(event.target)) return
  closeStatDetail()
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
function percentage(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
}
function qualityRange(id: 'standard' | 'high' | 'ultra' | 'lossless'): string {
  const { highKbps, ultraKbps, losslessKbps } = props.stats.quality.thresholds
  return t(`home.qualityRanges.${id}`, {
    high: highKbps,
    ultra: ultraKbps,
    lossless: losslessKbps
  })
}
function formatBytes(bytes: number): string {
  if (!bytes) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** index
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`
}

onMounted(() => {
  document.addEventListener('pointerdown', onStatDetailPointerDown)
  window.addEventListener('keydown', onStatDetailKeyDown)
  window.addEventListener('resize', positionStatDetail)
  window.addEventListener('scroll', onStatDetailScroll, true)
})
onDeactivated(closeStatDetail)
onBeforeUnmount(() => {
  closeStatDetail()
  document.removeEventListener('pointerdown', onStatDetailPointerDown)
  window.removeEventListener('keydown', onStatDetailKeyDown)
  window.removeEventListener('resize', positionStatDetail)
  window.removeEventListener('scroll', onStatDetailScroll, true)
})
watch(
  () => props.stats,
  async () => {
    if (!openStatDetail.value) return
    await nextTick()
    positionStatDetail()
  }
)
</script>

<template>
  <section class="xl:col-span-2">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="text-lg font-semibold">{{ t('home.overview') }}</h2>
      <button
        class="btn-hover flex items-center gap-1.5 px-2 py-1 text-sm"
        :disabled="refreshing"
        @click="emit('refresh')"
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
        class="home-surface home-stat group flex h-24 items-center gap-4 rounded-xl p-4 transition-all duration-[var(--motion-duration-standard)] hover:-translate-y-1"
        :title="t('home.listeningPeriodsHint')"
      >
        <span
          class="grid size-14 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary transition-transform duration-[var(--motion-duration-standard)] group-hover:scale-110 group-hover:rotate-3"
        >
          <SvgIcon name="common-time" class-name="size-5" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-xs text-text-l">{{ t('home.listeningPeriods') }}</p>
          <p class="mt-1 truncate text-xl font-semibold">
            {{ !loading && longestPeriod ? t(`home.periods.${longestPeriod.id}`) : '—' }}
          </p>
          <p v-if="!loading && longestPeriod" class="mt-1 text-xs text-text-l">
            {{ formatPeriodDuration(longestPeriod.playedSeconds) }} ·
            {{ percentage(longestPeriod.playedSeconds, totalPeriodSeconds) }}%
          </p>
        </div>
        <button
          type="button"
          class="grid size-8 shrink-0 place-items-center rounded-lg text-text-l transition hover:bg-primary/15 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
          :aria-label="
            t(openStatDetail === 'periods' ? 'home.hideDetails' : 'home.showDetails', {
              item: t('home.listeningPeriods')
            })
          "
          :aria-expanded="openStatDetail === 'periods'"
          aria-controls="home-stat-detail-panel"
          @click.stop="toggleStatDetail('periods', $event)"
        >
          <SvgIcon
            :name="
              openStatDetail === 'periods' && detailPlacement === 'top'
                ? 'arrow-arrow-up'
                : 'arrow-arrow-down'
            "
            class-name="size-4"
          />
        </button>
      </article>
      <article
        class="home-surface home-stat group flex h-24 items-center gap-4 rounded-xl p-4 transition-all duration-[var(--motion-duration-standard)] hover:-translate-y-1"
        :title="t('home.qualityHint')"
      >
        <span
          class="grid size-14 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary transition-transform duration-[var(--motion-duration-standard)] group-hover:scale-110 group-hover:rotate-3"
        >
          <SvgIcon name="common-music" class-name="size-5" />
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-xs text-text-l">{{ t('home.qualityStats') }}</p>
          <p class="mt-1 truncate text-xl font-semibold">
            {{ !loading && dominantQuality ? t(`home.qualityLevels.${dominantQuality.id}`) : '—' }}
          </p>
          <p v-if="!loading && dominantQuality" class="mt-1 text-xs text-text-l">
            {{ t('home.qualitySongCount', { count: dominantQuality.count }) }} ·
            {{ percentage(dominantQuality.count, knownQualityCount) }}%
          </p>
        </div>
        <button
          type="button"
          class="grid size-8 shrink-0 place-items-center rounded-lg text-text-l transition hover:bg-primary/15 hover:text-primary focus-visible:outline-2 focus-visible:outline-primary"
          :aria-label="
            t(openStatDetail === 'quality' ? 'home.hideDetails' : 'home.showDetails', {
              item: t('home.qualityStats')
            })
          "
          :aria-expanded="openStatDetail === 'quality'"
          aria-controls="home-stat-detail-panel"
          @click.stop="toggleStatDetail('quality', $event)"
        >
          <SvgIcon
            :name="
              openStatDetail === 'quality' && detailPlacement === 'top'
                ? 'arrow-arrow-up'
                : 'arrow-arrow-down'
            "
            class-name="size-4"
          />
        </button>
      </article>
    </div>
    <Teleport to="body">
      <section
        v-if="openStatDetail"
        id="home-stat-detail-panel"
        :ref="setDetailPanel"
        class="home-stat-detail-panel fixed z-[100] max-h-[calc(100vh-24px)] overflow-y-auto rounded-xl border border-border bg-bg p-6 text-text shadow-xl"
        :class="[
          detailReady
            ? 'translate-y-0 scale-100 opacity-100'
            : 'pointer-events-none translate-y-1 scale-[0.98] opacity-0',
          detailPlacement === 'top' ? 'origin-bottom-right' : 'origin-top-right',
          !uiStore.reduceMotion && 'transition-[opacity,transform] duration-200 ease-out'
        ]"
        :style="detailStyle"
        role="dialog"
        :aria-label="
          t(openStatDetail === 'periods' ? 'home.listeningPeriods' : 'home.qualityStats')
        "
      >
        <div class="mb-3 flex items-start justify-between gap-3">
          <div>
            <h3 class="font-semibold">
              {{ t(openStatDetail === 'periods' ? 'home.listeningPeriods' : 'home.qualityStats') }}
            </h3>
            <p class="mt-1 text-xs text-text-l">
              {{
                t(openStatDetail === 'periods' ? 'home.listeningPeriodsHint' : 'home.qualityHint')
              }}
            </p>
          </div>
          <button
            type="button"
            class="grid size-7 shrink-0 place-items-center rounded-md text-text-l hover:bg-hover hover:text-text"
            :aria-label="t('home.closeDetails')"
            @click="closeStatDetail"
          >
            <SvgIcon name="common-close" class-name="size-4" />
          </button>
        </div>
        <div class="home-stat-detail-content">
          <div class="relative mx-auto size-40 shrink-0" aria-hidden="true">
            <svg :key="openStatDetail" class="size-full" viewBox="0 0 120 120">
              <defs>
                <mask
                  id="home-stat-donut-mask"
                  maskUnits="userSpaceOnUse"
                  x="0"
                  y="0"
                  width="120"
                  height="120"
                >
                  <circle
                    cx="60"
                    cy="60"
                    r="48"
                    fill="none"
                    stroke="white"
                    stroke-width="12"
                    :stroke-dasharray="`${donutCircumference} ${donutCircumference}`"
                    :class="!uiStore.reduceMotion && 'home-stat-ring-reveal'"
                    :style="{ '--donut-circumference': String(donutCircumference) }"
                    transform="rotate(-90 60 60)"
                  />
                </mask>
              </defs>
              <circle
                cx="60"
                cy="60"
                r="48"
                fill="none"
                stroke="var(--color-border)"
                stroke-width="11"
              />
              <g mask="url(#home-stat-donut-mask)">
                <circle
                  v-for="segment in detailDonutSegments"
                  :key="segment.id"
                  cx="60"
                  cy="60"
                  r="48"
                  fill="none"
                  :stroke="segment.color"
                  stroke-width="11"
                  :stroke-dasharray="segment.dasharray"
                  :stroke-dashoffset="segment.dashoffset"
                  transform="rotate(-90 60 60)"
                >
                  <title>{{ segment.label }} · {{ segment.percentage }}%</title>
                </circle>
              </g>
            </svg>
            <div
              class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
            >
              <strong class="text-2xl">{{ detailDonutSummary.percentage }}%</strong>
              <span class="max-w-20 truncate text-xs text-text-l">{{
                detailDonutSummary.label
              }}</span>
            </div>
          </div>
          <div class="min-w-0">
            <div v-if="openStatDetail === 'periods'" class="space-y-3">
              <div v-for="(period, index) in stats.timePeriods" :key="period.id">
                <div class="flex items-center justify-between gap-2 text-sm">
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      class="size-2 shrink-0 rounded-full"
                      :style="{ backgroundColor: periodColors[index] }"
                    />
                    <span class="font-medium">{{ t(`home.periods.${period.id}`) }}</span>
                    <span class="text-xs text-text-l">{{
                      t(`home.periodRanges.${period.id}`)
                    }}</span>
                  </div>
                  <span class="shrink-0"
                    >{{ percentage(period.playedSeconds, totalPeriodSeconds) }}%</span
                  >
                </div>
                <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hover">
                  <div
                    class="h-full origin-left rounded-full"
                    :class="!uiStore.reduceMotion && 'home-stat-bar'"
                    :style="{
                      width: `${percentage(period.playedSeconds, totalPeriodSeconds)}%`,
                      backgroundColor: periodColors[index]
                    }"
                  />
                </div>
                <p class="mt-1 text-xs text-text-l">
                  {{
                    t('home.listeningPeriodTooltip', {
                      count: period.plays,
                      duration: formatPeriodDuration(period.playedSeconds)
                    })
                  }}
                </p>
              </div>
            </div>
            <div v-else class="space-y-3">
              <div v-for="level in qualityLevels" :key="level.id">
                <div class="flex items-center justify-between gap-2 text-sm">
                  <div class="flex min-w-0 items-center gap-2">
                    <span
                      class="size-2 shrink-0 rounded-full"
                      :style="{ backgroundColor: level.color }"
                    />
                    <span class="font-medium">{{ t(`home.qualityLevels.${level.id}`) }}</span>
                    <span class="text-xs text-text-l">{{ qualityRange(level.id) }}</span>
                  </div>
                  <span class="shrink-0">{{ percentage(level.count, knownQualityCount) }}%</span>
                </div>
                <div class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-hover">
                  <div
                    class="h-full origin-left rounded-full"
                    :class="!uiStore.reduceMotion && 'home-stat-bar'"
                    :style="{
                      width: `${percentage(level.count, knownQualityCount)}%`,
                      backgroundColor: level.color
                    }"
                  />
                </div>
                <p class="mt-1 text-xs text-text-l">
                  {{ t('home.qualitySongCount', { count: level.count }) }} ·
                  {{ formatBytes(level.bytes) }}
                </p>
              </div>
              <div class="space-y-1 border-t border-border pt-2 text-xs text-text-l">
                <p>
                  {{
                    t('home.qualityMethodCounts', {
                      bitrate: stats.quality.bitrateCount,
                      fallback: stats.quality.sizeFallbackCount
                    })
                  }}
                </p>
                <p v-if="stats.quality.sizeFallbackCount">
                  {{
                    t('home.qualitySizeFallbackRule', {
                      high: stats.quality.thresholds.highMiB,
                      ultra: stats.quality.thresholds.ultraMiB,
                      lossless: stats.quality.thresholds.losslessMiB
                    })
                  }}
                </p>
                <p v-if="stats.quality.unknownCount">
                  {{ t('home.qualityUnknown', { count: stats.quality.unknownCount }) }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>
    </Teleport>
  </section>
</template>

<style scoped>
.home-stat-detail-content {
  display: grid;
  grid-template-columns: 10rem minmax(0, 1fr);
  align-items: center;
  gap: 1rem;
}
.home-stat-bar {
  animation: home-stat-grow 320ms ease-out both;
}
.home-stat-ring-reveal {
  animation: home-stat-ring-draw 550ms ease-out both;
}
@keyframes home-stat-grow {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}
@keyframes home-stat-ring-draw {
  from {
    stroke-dashoffset: var(--donut-circumference);
  }
  to {
    stroke-dashoffset: 0;
  }
}
@media (max-width: 480px) {
  .home-stat-detail-content {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (prefers-reduced-motion: reduce) {
  .home-stat-detail-panel {
    transition: none;
  }
  .home-stat-bar,
  .home-stat-ring-reveal {
    animation: none;
  }
}
</style>
