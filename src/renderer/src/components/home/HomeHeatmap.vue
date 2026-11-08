<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUIStore } from '@/stores/ui/uiStore'
import type { HistoryDay } from './types'

const props = defineProps<{ historyDays: HistoryDay[] }>()
const { t } = useI18n()
const uiStore = useUIStore()
const heatLevels = ['bg-hover', 'bg-primary/20', 'bg-primary/40', 'bg-primary/70', 'bg-primary']

const historyMap = computed(
  () => new Map(props.historyDays.map((item) => [item.date, item.seconds]))
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
    .filter(
      ({ day, index }) =>
        day.date.endsWith('-01') || (index === 0 && Number(day.date.slice(-2)) <= 14)
    )
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

function heatClass(seconds: number): string {
  if (!seconds) return heatLevels[0]

  const ratio = seconds / maxHeat.value

  switch (true) {
    case ratio > 0.75:
      return heatLevels[4]
    case ratio > 0.45:
      return heatLevels[3]
    case ratio > 0.2:
      return heatLevels[2]
    default:
      return heatLevels[1]
  }
}
</script>

<template>
  <section class="home-section home-surface home-heatmap">
    <div class="home-section-heading">
      <h2>{{ t('home.heatmap') }}</h2>
      <span class="text-xs text-text-l">{{ t('home.lastYear') }}</span>
    </div>
    <div class="custom-scrollbar overflow-x-auto pb-1">
      <div class="home-heatmap-canvas">
        <div class="relative mb-1 h-4 text-[10px] text-text-l">
          <span
            v-for="marker in monthMarkers"
            :key="marker.date"
            class="absolute whitespace-nowrap"
            :style="{ left: `${(marker.week / Math.ceil(heatmapDays.length / 7)) * 100}%` }"
          >
            {{ marker.label }}
          </span>
        </div>
        <div class="home-heatmap-grid">
          <span
            v-for="day in heatmapDays"
            :key="day.date"
            class="home-heatmap-cell rounded-sm"
            :class="heatClass(day.seconds)"
            :title="t('home.heatmapValue', { date: day.date, value: formatDuration(day.seconds) })"
          />
        </div>
      </div>
    </div>
    <div class="mt-3 flex flex-wrap items-center justify-between gap-3">
      <p class="text-xs text-text-l">{{ t('home.heatmapHint') }}</p>
      <div
        class="home-heatmap-legend flex shrink-0 items-center gap-1.5 text-[10px] text-text-l"
        role="img"
        :aria-label="t('home.heatmapHint')"
      >
        <span>{{ t('home.heatmapLess') }}</span>
        <span
          v-for="level in heatLevels"
          :key="level"
          class="size-3 rounded-sm"
          :class="level"
          aria-hidden="true"
        />
        <span>{{ t('home.heatmapMore') }}</span>
      </div>
    </div>
  </section>
</template>
