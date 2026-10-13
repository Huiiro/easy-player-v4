<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUIStore } from '@/stores/ui/uiStore'
import type { HistoryDay } from './types'

const props = defineProps<{ historyDays: HistoryDay[] }>()
const { t } = useI18n()
const uiStore = useUIStore()

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
</script>

<template>
  <section class="home-surface rounded-xl p-5 xl:col-span-2">
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
            :title="t('home.heatmapValue', { date: day.date, value: formatDuration(day.seconds) })"
          />
        </div>
      </div>
    </div>
    <p class="mt-3 text-xs text-text-l">{{ t('home.heatmapHint') }}</p>
  </section>
</template>
