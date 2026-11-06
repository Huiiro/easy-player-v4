<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { useAppUpdateStore } from '@/stores/appUpdate'

const updates = useAppUpdateStore()
const { t } = useI18n()
const percent = computed(() => {
  const value = updates.status?.state === 'downloading' ? updates.status.percent : 0
  return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0
})
const failed = computed(() => updates.downloadAttempted && updates.status?.state === 'error')
const errorMessage = computed(() => updates.actionError || t('settings.updateActionFailed'))
</script>

<template>
  <div
    v-if="
      updates.status?.state === 'downloading' || updates.status?.state === 'downloaded' || failed
    "
    class="app-update-status mx-2 flex min-w-0 shrink-0 items-center gap-2 text-xs [-webkit-app-region:no-drag]"
  >
    <template v-if="updates.status?.state === 'downloading'">
      <SvgIcon name="common-update" class-name="size-4 text-primary" />
      <progress
        :value="percent"
        max="100"
        :aria-label="t('settings.updateDownloading', { percent })"
        class="h-1 w-12 accent-primary sm:w-16"
      />
      <span class="tabular-nums text-text-l">{{ percent }}%</span>
    </template>
    <button
      v-else-if="updates.status?.state === 'downloaded'"
      type="button"
      class="flex items-center gap-1.5 rounded px-2 py-1 text-primary transition-colors hover:bg-hover disabled:opacity-50"
      :title="
        updates.actionError !== null
          ? errorMessage
          : t('settings.updateDownloaded', { version: updates.status.version })
      "
      :disabled="updates.busy"
      @click="updates.installUpdate"
    >
      <SvgIcon name="common-update" class-name="size-4" />
      {{ t('settings.restartAndInstall') }}
    </button>
    <button
      v-else
      type="button"
      class="rounded px-2 py-1 text-danger transition-colors hover:bg-hover disabled:opacity-50"
      :title="errorMessage"
      :disabled="updates.busy"
      @click="updates.downloadUpdate()"
    >
      {{ t('settings.retryUpdate') }}
    </button>
    <span v-if="updates.actionError !== null" role="alert" class="sr-only">
      {{ errorMessage }}
    </span>
  </div>
</template>
