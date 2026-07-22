<script setup lang="ts">
import { watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import { useUIStore } from '@/stores/ui/uiStore'

const ui = useUIStore()
const { t } = useI18n()
watch(
  () => ui.closeToTray,
  (enabled) => void window.api.system.setCloseToTray(enabled),
  { immediate: true }
)
watch(
  () => ui.autoStart,
  (enabled) => void window.api.system.setAutoStart(enabled),
  { immediate: true }
)
</script>

<template>
  <div class="system-row">
    <div>
      <h3>{{ t('settings.closeToTray') }}</h3>
      <p>{{ t('settings.closeToTrayDescription') }}</p>
    </div>
    <BaseSwitch v-model="ui.closeToTray" size="md" />
  </div>
  <div class="system-row">
    <div>
      <h3>{{ t('settings.autoStart') }}</h3>
      <p>{{ t('settings.autoStartDescription') }}</p>
    </div>
    <BaseSwitch v-model="ui.autoStart" size="md" />
  </div>
</template>

<style scoped>
.system-row {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1.1rem 1.25rem;
}
.system-row + .system-row {
  border-top: 1px solid var(--color-border);
}
.system-row h3 {
  color: var(--color-text);
  font-size: 0.9rem;
  font-weight: 550;
}
.system-row p {
  margin-top: 0.25rem;
  color: var(--color-text-l);
  font-size: 0.8125rem;
  line-height: 1.45;
}
</style>
