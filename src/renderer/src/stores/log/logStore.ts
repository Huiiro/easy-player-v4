import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { LogEntry } from '@/types/audio'
import { playerDataStorage } from '@/stores/persistence'

const MAX_ENTRIES = 1000

export const useLogStore = defineStore(
  'log',
  () => {
    const entries = ref<LogEntry[]>([])
    const filter = ref<'all' | 'debug' | 'info' | 'warn' | 'error'>('all')

    const filteredEntries = computed(() => {
      if (filter.value === 'all') return entries.value
      return entries.value.filter((e) => e.level === filter.value)
    })

    function addEntry(entry: LogEntry): void {
      window.api.log.write(entry.level, entry.message)
    }

    function receive(entry: LogEntry): void {
      if (entry.id !== undefined && entries.value.some((item) => item.id === entry.id)) return
      entries.value.push(entry)
      entries.value.sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
      if (entries.value.length > MAX_ENTRIES) {
        entries.value.shift()
      }
    }

    function clear(): void {
      entries.value = []
    }

    let unsubscribe: (() => void) | null = null

    function subscribe(): void {
      if (unsubscribe) return
      unsubscribe = window.api.log.onEntry(receive)
      void window.api.log
        .recent()
        .then((history) => history.forEach(receive))
        .catch(() => undefined)
    }

    function unsubscribeEvents(): void {
      unsubscribe?.()
      unsubscribe = null
    }

    return {
      entries,
      filteredEntries,
      filter,
      addEntry,
      clear,
      subscribe,
      unsubscribeEvents
    }
  },
  {
    persist: {
      key: 'log.preferences.v1',
      storage: playerDataStorage,
      pick: ['filter']
    }
  }
)
