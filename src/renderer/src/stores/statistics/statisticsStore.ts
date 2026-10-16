import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import {
  STATISTICS_SETTING_KEY,
  normalizeStatisticsState,
  type StatisticsState
} from '../../../../shared/statistics'

export const useStatisticsStore = defineStore('statistics', () => {
  // Read the main-process preference before the player can start recording.
  const state = ref<StatisticsState>({ enabled: false, generation: '' })
  const ready = ref(false)
  const busy = ref(false)
  let revision = 0
  try {
    const result = window.api.database.getSync(STATISTICS_SETTING_KEY)
    if (result.success) {
      state.value = normalizeStatisticsState(result.data)
      ready.value = true
    }
  } catch {
    // Fail closed until the database is available.
  }
  const enabled = computed(() => state.value.enabled)
  const generation = computed(() => state.value.generation)

  async function refresh(): Promise<void> {
    if (busy.value) return
    const request = ++revision
    const response = await window.api.database.command('getStatisticsState')
    if (request !== revision) return
    if (!response.success) throw new Error(response.error)
    state.value = normalizeStatisticsState(response.data)
    ready.value = true
  }

  async function change(
    action: 'setStatisticsEnabled' | 'clearStatisticsData',
    value?: boolean
  ): Promise<void> {
    if (busy.value) return
    const request = ++revision
    busy.value = true
    try {
      const response = await window.api.database.command(
        action,
        action === 'setStatisticsEnabled' ? { enabled: value } : undefined
      )
      if (!response.success) throw new Error(response.error)
      if (request !== revision) return
      state.value = normalizeStatisticsState(response.data)
      ready.value = true
    } finally {
      busy.value = false
    }
  }

  return {
    enabled,
    generation,
    ready,
    busy,
    refresh,
    setEnabled: (value: boolean) => change('setStatisticsEnabled', value),
    clear: () => change('clearStatisticsData')
  }
})
