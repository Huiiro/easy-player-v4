<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseConfirmDialog from '@/components/ui/BaseConfirmDialog.vue'
import { useStatisticsStore } from '@/stores/statistics/statisticsStore'
import { useMessage } from '@/components/ui/useMessage'

const statistics = useStatisticsStore()
const { t } = useI18n()
const { success, error } = useMessage()
const clearVisible = ref(false)

async function setEnabled(value: boolean | string | number): Promise<void> {
  try {
    await statistics.setEnabled(Boolean(value))
  } catch {
    error(t('settings.statisticsSaveFailed'))
  }
}

async function clear(): Promise<void> {
  try {
    await statistics.clear()
    success(t('settings.statisticsCleared'))
  } catch {
    error(t('settings.statisticsClearFailed'))
  }
}

onMounted(() => {
  if (!statistics.ready)
    void statistics.refresh().catch(() => error(t('settings.statisticsSaveFailed')))
})
</script>

<template>
  <div class="setting-row">
    <div>
      <h3>{{ t('settings.statistics') }}</h3>
      <p>{{ t('settings.statisticsDescription') }}</p>
    </div>
    <BaseSwitch
      :model-value="statistics.enabled"
      :disabled="!statistics.ready || statistics.busy"
      :aria-label="t('settings.statistics')"
      size="md"
      @update:model-value="setEnabled"
    />
  </div>
  <div class="setting-row">
    <div>
      <h3>{{ t('settings.clearStatistics') }}</h3>
      <p>{{ t('settings.clearStatisticsDescription') }}</p>
    </div>
    <BaseButton
      variant="danger"
      size="sm"
      :disabled="!statistics.ready || statistics.busy"
      @click="clearVisible = true"
    >
      {{ t('settings.clearStatistics') }}
    </BaseButton>
  </div>
  <BaseConfirmDialog
    v-model="clearVisible"
    :title="t('settings.clearStatistics')"
    :message="t('settings.confirmClearStatistics')"
    :confirm-text="t('settings.clearStatistics')"
    variant="danger"
    @confirm="clear"
  />
</template>
