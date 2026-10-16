<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { SearchIndexStatus } from '../../../../shared/searchIndex'

const { t } = useI18n()
const status = ref<SearchIndexStatus | null>(null)
const open = ref(false)
const unavailable = ref(false)
const root = ref<HTMLElement | null>(null)
const visible = computed(() =>
  Boolean(
    status.value?.pending && (status.value.phase === 'indexing' || status.value.phase === 'queued')
  )
)
let disposed = false
let offStatus: (() => void) | undefined
let retryTimer: ReturnType<typeof setTimeout> | undefined
const percentage = computed(() =>
  status.value?.total ? Math.min(100, (status.value.completed / status.value.total) * 100) : 0
)
const label = computed(() =>
  unavailable.value
    ? t('searchIndex.unavailable')
    : status.value
      ? t(`searchIndex.${status.value.phase}`, {
          completed: status.value.completed,
          total: status.value.total,
          count: status.value.retrying
        })
      : ''
)
const retryTime = computed(() =>
  status.value?.nextRetryAt ? new Date(status.value.nextRetryAt).toLocaleTimeString() : ''
)

function accept(value: SearchIndexStatus | null): void {
  if (disposed || !value || (status.value && value.revision < status.value.revision)) return
  status.value = value
  unavailable.value = false
  if (!visible.value) open.value = false
}
async function refresh(): Promise<void> {
  try {
    const value = await window.api.database.getSearchIndexStatus()
    if (!value) throw new Error('Search status unavailable')
    accept(value)
  } catch {
    if (disposed) return
    unavailable.value = !status.value
    retryTimer = setTimeout(() => void refresh(), 5000)
  }
}
function outside(event: PointerEvent): void {
  if (event.target instanceof Node && !root.value?.contains(event.target)) open.value = false
}
function escape(event: KeyboardEvent): void {
  if (event.key === 'Escape') open.value = false
}
onMounted(() => {
  offStatus = window.api.database.onSearchIndexStatusChanged(accept)
  void refresh()
  window.addEventListener('pointerdown', outside)
  window.addEventListener('keydown', escape)
})
onBeforeUnmount(() => {
  disposed = true
  offStatus?.()
  if (retryTimer) clearTimeout(retryTimer)
  window.removeEventListener('pointerdown', outside)
  window.removeEventListener('keydown', escape)
})
</script>

<template>
  <div v-if="visible" ref="root" class="relative min-w-0 [-webkit-app-region:no-drag]">
    <button
      class="btn-hover flex max-w-[220px] items-center gap-1.5 rounded px-2 py-1 text-xs text-text-l"
      :aria-label="label"
      :aria-expanded="open"
      aria-controls="search-index-details"
      @click="open = !open"
    >
      <span
        class="size-1.5 shrink-0 rounded-full"
        :class="status?.phase === 'ready' && !unavailable ? 'bg-primary' : 'bg-current'"
      />
      <span class="truncate">{{ label }}</span>
    </button>
    <section
      v-if="open"
      id="search-index-details"
      class="absolute right-0 top-full z-30 mt-2 w-72 rounded-lg border border-border bg-bg p-4 text-xs text-text shadow-lg"
      :aria-label="t('searchIndex.title')"
    >
      <p class="font-medium">{{ t('searchIndex.title') }}</p>
      <p class="mt-2" role="status">{{ label }}</p>
      <template v-if="status">
        <div
          class="mt-3 h-1.5 overflow-hidden rounded-full bg-hover"
          role="progressbar"
          :aria-label="t('searchIndex.progress')"
          :aria-valuemin="0"
          :aria-valuemax="status.total"
          :aria-valuenow="status.completed"
        >
          <div class="h-full bg-primary transition-[width]" :style="{ width: `${percentage}%` }" />
        </div>
        <p class="mt-2 text-text-l">
          {{
            t('searchIndex.counts', {
              completed: status.completed,
              total: status.total,
              pending: status.pending
            })
          }}
        </p>
        <p v-if="status.currentTitle" class="mt-2 truncate" :title="status.currentTitle">
          {{ t('searchIndex.current', { title: status.currentTitle }) }}
        </p>
        <p v-if="status.retrying" class="mt-2 text-text-l">
          {{ t('searchIndex.retryCount', { count: status.retrying }) }}
        </p>
        <p v-if="retryTime" class="mt-1 text-text-l">
          {{ t('searchIndex.retryAt', { time: retryTime }) }}
        </p>
        <p class="mt-3 text-text-l">
          {{ t(status.pending ? 'searchIndex.pendingHint' : 'searchIndex.readyHint') }}
        </p>
      </template>
    </section>
  </div>
</template>
