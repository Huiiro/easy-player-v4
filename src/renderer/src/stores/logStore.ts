import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { LogEntry } from '../types/audio'
import { audioBridge } from '../services/audioBridge'

const MAX_ENTRIES = 1000

export const useLogStore = defineStore('log', () => {
  const entries = ref<LogEntry[]>([])
  const filter = ref<'all' | 'debug' | 'info' | 'warn' | 'error'>('all')

  const filteredEntries = computed(() => {
    if (filter.value === 'all') return entries.value
    return entries.value.filter((e) => e.level === filter.value)
  })

  function addEntry(entry: LogEntry) {
    entries.value.push(entry)
    if (entries.value.length > MAX_ENTRIES) {
      entries.value.shift()
    }
  }

  function clear() {
    entries.value = []
  }

  let unsubscribe: (() => void) | null = null

  function subscribe() {
    unsubscribe = audioBridge.onLogEntry((data) => {
      addEntry(data as LogEntry)
    })
  }

  function unsubscribeEvents() {
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
})
