<script setup lang="ts">
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useMessage } from '@/components/ui/useMessage'
import eventBus from '@/utils/eventBus'
import BaseButton from '@/components/ui/BaseButton.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import type { DuplicateTaskState } from '../../../../shared/duplicateFiles'

const DuplicateFilesDialog = defineAsyncComponent(() =>
  import('../settings/DuplicateFilesDialog.vue').then((module) => module.default)
)
const { t } = useI18n()
const { success, error } = useMessage()
const task = ref<DuplicateTaskState | null>(null)
const open = ref(false)
const loaded = ref(false)
const dismissed = ref<string | null>(null)
// Startup restores access to the report, not a notification for historical completion.
const notificationReady = ref(false)
const noticeVisible = computed(
  () =>
    task.value &&
    notificationReady.value &&
    !open.value &&
    dismissed.value !== `${task.value.id}:${task.value.status}`
)
let receivedEvent = false
let disposed = false
const label = computed(() => {
  if (task.value?.status !== 'running') return t(`duplicates.taskStatus.${task.value?.status}`)
  const progress = task.value.progress
  return progress
    ? `${t(`duplicates.${progress.phase}`)} ${progress.current} / ${progress.total}`
    : t('duplicates.scanning')
})
function show(): void {
  loaded.value = true
  open.value = true
}
function dismiss(): void {
  if (task.value) dismissed.value = `${task.value.id}:${task.value.status}`
}
watch(
  [open, () => task.value?.id, () => task.value?.status],
  () => {
    if (open.value && task.value?.status === 'completed') dismiss()
  },
  { flush: 'sync' }
)
eventBus.on('openDuplicateReport', show)
const off = window.api.library.onDuplicateTask((value) => {
  receivedEvent = true
  const previous = task.value
  if (
    value &&
    (value.status !== 'completed' || previous?.id !== value.id || previous.status !== 'completed')
  )
    notificationReady.value = true
  task.value = value
  if (
    value?.status === 'completed' &&
    (previous?.id !== value.id || previous.status !== 'completed')
  ) {
    success(t('duplicates.completed', { count: value.groupCount ?? 0 }))
  } else if (value?.status === 'failed' && previous?.status !== 'failed') {
    error(t(`duplicates.errors.${value.error ?? 'failed'}`))
  }
})
void window.api.library
  .getDuplicateTaskState()
  .then((value) => {
    if (!disposed && !receivedEvent) {
      notificationReady.value = !!value && value.status !== 'completed'
      task.value = value
    }
  })
  .catch(() => {})
onBeforeUnmount(() => {
  disposed = true
  off()
  eventBus.off('openDuplicateReport', show)
})
</script>

<template>
  <div
    v-if="task && noticeVisible"
    class="duplicate-task-entry fixed right-4 bottom-28 z-40 flex items-center gap-2 border"
  >
    <BaseButton
      variant="ghost"
      class="duplicate-task-open min-w-0 flex-1"
      :aria-label="t('duplicates.openTask')"
      @click="show"
    >
      <span class="flex w-full min-w-0 items-center gap-3 text-left">
        <span
          class="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/8 text-primary"
        >
          <span v-if="task.status === 'running'" class="ep-spinner" aria-hidden="true" />
          <SvgIcon
            v-else
            :name="
              task.status === 'completed'
                ? 'common-check'
                : task.status === 'failed'
                  ? 'common-warning'
                  : 'common-time'
            "
            class-name="size-4"
          />
        </span>
        <span class="grid min-w-0 flex-1 gap-1">
          <span class="text-xs font-medium">{{ t('duplicates.title') }}</span>
          <span class="text-xs font-normal leading-relaxed text-text-l" role="status">
            {{ label }}
          </span>
        </span>
      </span>
    </BaseButton>
    <div class="flex shrink-0 flex-col items-center gap-1">
      <BaseButton
        variant="ghost"
        size="xs"
        icon-only
        :aria-label="t('duplicates.dismissTask')"
        :title="t('duplicates.dismissTask')"
        @click="dismiss"
      >
        <SvgIcon name="common-close" class-name="size-3" />
      </BaseButton>
      <BaseButton
        variant="ghost"
        size="xs"
        icon-only
        :aria-label="t('duplicates.openTask')"
        :title="t('duplicates.openTask')"
        @click="show"
      >
        <SvgIcon name="arrow-arrow-right-light" class-name="size-4" />
      </BaseButton>
    </div>
  </div>
  <DuplicateFilesDialog v-if="loaded" v-model="open" />
</template>

<style>
.duplicate-task-entry {
  width: min(22rem, calc(100vw - 2rem));
  height: auto;
  padding: 0.85rem 1rem;
  border-color: var(--color-border);
  border-radius: var(--ep-dialog-radius);
  background: var(--ep-dialog-bg);
  box-shadow: var(--ep-surface-shadow);
  white-space: normal;
}
.duplicate-task-entry .duplicate-task-open {
  height: auto;
  padding: 0;
  white-space: normal;
}
.duplicate-task-entry .duplicate-task-open:hover {
  background: transparent;
  color: var(--color-text);
}
.duplicate-task-open > span {
  width: 100%;
  min-width: 0;
}
</style>
