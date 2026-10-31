<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUIStore } from '@/stores/ui/uiStore'
import eventBus from '@/utils/eventBus'
import { useMessage } from './useMessage'
import BaseMessage from './BaseMessage.vue'

const { t } = useI18n()
const ui = useUIStore()
const { success } = useMessage()
let pendingCount = 0
let noticeTimer: ReturnType<typeof setTimeout> | undefined

function clearPendingNotice(): void {
  clearTimeout(noticeTimer)
  noticeTimer = undefined
  pendingCount = 0
}

const removeAutoImportListener = window.api.library.onAutoImported((result) => {
  eventBus.emit('scanFinished')
  if (!ui.autoImportLocalMusic || !ui.showAutoImportNotifications || !(result.added > 0)) return
  pendingCount += result.added
  // One bounded collection window combines batches from multiple watched folders.
  if (noticeTimer) return
  noticeTimer = setTimeout(() => {
    success(t('settings.autoImportSongsAdded', { count: pendingCount }))
    clearPendingNotice()
  }, 1000)
})

watch(
  () => ui.autoImportLocalMusic && ui.showAutoImportNotifications,
  (enabled) => {
    if (!enabled) clearPendingNotice()
  }
)
onBeforeUnmount(() => {
  removeAutoImportListener()
  clearPendingNotice()
})
</script>

<template>
  <BaseMessage />
</template>
