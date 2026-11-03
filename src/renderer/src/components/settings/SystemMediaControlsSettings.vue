<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import SettingRow from './SettingRow.vue'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useMessage } from '@/components/ui/useMessage'

const { t } = useI18n()
const { error } = useMessage()
const available = ref(false)
const enabled = ref(false)
const busy = ref(true)

onMounted(async () => {
  try {
    const result = await window.api.system.getSystemMediaControls()
    if (result.success && result.data) {
      available.value = result.data.available
      enabled.value = result.data.enabled
    }
  } catch {
    available.value = false
  } finally {
    busy.value = false
  }
})

async function change(value: boolean | string | number): Promise<void> {
  if (typeof value !== 'boolean' || busy.value) return
  busy.value = true
  try {
    const result = await window.api.system.setSystemMediaControls(value)
    if (!result.success || !result.data) throw new Error(result.error || t('settings.smtcFailed'))
    available.value = result.data.available
    enabled.value = result.data.enabled
  } catch {
    error(t('settings.smtcFailed'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <SettingRow
    :label="t('settings.smtc')"
    :description="
      !busy && !available ? t('settings.smtcUnavailable') : t('settings.smtcDescription')
    "
  >
    <template #default="{ labelId, descriptionId }">
      <BaseSwitch
        :model-value="enabled"
        :disabled="busy || !available"
        :aria-labelledby="labelId"
        :aria-describedby="descriptionId"
        @update:model-value="change"
      />
    </template>
  </SettingRow>
</template>
