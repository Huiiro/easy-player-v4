<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseMessage from '@/components/ui/BaseMessage.vue'
import { useMessage } from '@/components/ui/useMessage'
import router from '@/router'
import { flushPlayerDataStorage } from '@/stores/persistence'

const { t } = useI18n()
const { success } = useMessage()
const removeDownloadProgress = window.api.downloads.onProgress((progress) => {
  if (progress.status !== 'done' || router.currentRoute.value.path === '/download') return
  success(t('download.completed', { title: progress.title || t('download.mediaFile') }))
})
const clearPerformanceEntries = (): void => {
  performance.clearMarks()
  performance.clearMeasures()
}
let performanceCleanupTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  performanceCleanupTimer = setInterval(clearPerformanceEntries, 10_000)
  window.addEventListener('beforeunload', flushPlayerDataStorage)
})
onBeforeUnmount(() => {
  removeDownloadProgress()
  if (performanceCleanupTimer) clearInterval(performanceCleanupTimer)
  window.removeEventListener('beforeunload', flushPlayerDataStorage)
  flushPlayerDataStorage()
  clearPerformanceEntries()
})
</script>
<template>
  <router-view v-slot="{ Component }">
    <component :is="Component" />
  </router-view>
  <BaseMessage />
</template>
