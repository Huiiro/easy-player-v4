<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { useI18n } from 'vue-i18n'
import BaseMessage from '@/components/ui/BaseMessage.vue'
import ThemePreviewDialog from '@/components/settings/ThemePreviewDialog.vue'
import { useMessage } from '@/components/ui/useMessage'
import router from '@/router'
import { flushPlayerDataStorage } from '@/stores/persistence'

const { t } = useI18n()
const ui = useUIStore()
const { success } = useMessage()
function prepareToClose(): void {
  ui.cancelCustomThemePreview()
  flushPlayerDataStorage()
}
const removeDownloadProgress = window.api.downloads.onProgress((progress) => {
  if (progress.status !== 'done' || router.currentRoute.value.path === '/download') return
  success(t('download.completed', { title: progress.title || t('download.mediaFile') }))
})
const clearPerformanceEntries = (): void => {
  performance.clearMarks()
  performance.clearMeasures()
}
let performanceCleanupTimer: ReturnType<typeof setInterval> | undefined
watch(
  () => ui.extremePlayback,
  (enabled) => {
    if (performanceCleanupTimer) clearInterval(performanceCleanupTimer)
    performanceCleanupTimer = enabled ? undefined : setInterval(clearPerformanceEntries, 10_000)
  }
)
onMounted(() => {
  if (!ui.extremePlayback) performanceCleanupTimer = setInterval(clearPerformanceEntries, 10_000)
  window.addEventListener('beforeunload', prepareToClose)
  window.addEventListener('focus', ui.checkCustomThemePreviewDeadline)
  document.addEventListener('visibilitychange', ui.checkCustomThemePreviewDeadline)
})
onBeforeUnmount(() => {
  removeDownloadProgress()
  if (performanceCleanupTimer) clearInterval(performanceCleanupTimer)
  window.removeEventListener('beforeunload', prepareToClose)
  window.removeEventListener('focus', ui.checkCustomThemePreviewDeadline)
  document.removeEventListener('visibilitychange', ui.checkCustomThemePreviewDeadline)
  ui.cancelCustomThemePreview()
  flushPlayerDataStorage()
  clearPerformanceEntries()
})
</script>
<template>
  <router-view v-slot="{ Component }">
    <component :is="Component" />
  </router-view>
  <BaseMessage />
  <ThemePreviewDialog />
</template>
