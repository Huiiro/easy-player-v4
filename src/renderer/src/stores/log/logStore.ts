import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { LogEntry } from '@/types/audio'
import { audioBridge } from '@/services/audioBridge'
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
      entries.value.push(entry)
      if (entries.value.length > MAX_ENTRIES) {
        entries.value.shift()
      }
    }

    function clear(): void {
      entries.value = []
    }

    let unsubscribe: (() => void) | null = null

    function subscribe(): void {
      unsubscribe = audioBridge.onLogEntry((data) => {
        addEntry(data as LogEntry)
      })
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
