<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseConfirmDialog from '@/components/ui/BaseConfirmDialog.vue'
import { restoreDefaultPreferences } from '@/services/resetPreferences'
import { useUIStore } from '@/stores/ui/uiStore'
import { useMessage } from '@/components/ui/useMessage'

const emit = defineEmits<{ reset: [] }>()
const { t, locale } = useI18n()
const { success, error } = useMessage()
const visible = ref(false)
const busy = ref(false)
async function restore(): Promise<void> {
  if (busy.value) return
  busy.value = true
  try {
    await restoreDefaultPreferences()
    locale.value = useUIStore().locale
    emit('reset')
    success(t('settings.preferencesRestored'))
  } catch {
    error(t('settings.preferencesRestoreFailed'))
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="setting-row">
    <div>
      <h3>{{ t('settings.restorePreferences') }}</h3>
      <p>{{ t('settings.restorePreferencesDescription') }}</p>
    </div>
    <BaseButton size="sm" variant="danger" :disabled="busy" @click="visible = true">
      {{ t('settings.restorePreferences') }}
    </BaseButton>
  </div>
  <BaseConfirmDialog
    v-model="visible"
    :title="t('settings.restorePreferences')"
    :message="t('settings.confirmRestorePreferences')"
    :confirm-text="t('settings.restorePreferences')"
    @confirm="restore"
  />
</template>
