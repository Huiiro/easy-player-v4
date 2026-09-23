<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import SleepTimerSettings from './SleepTimerSettings.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import eventBus from '@/utils/eventBus'

const ui = useUIStore()
const { t } = useI18n()

function openAudioControls(): void {
  eventBus.emit('openAudioControls')
}
</script>
<template>
  <div class="settings-card">
    <div class="setting-row">
      <div>
        <h3>{{ t('settings.audioControlPanel') }}</h3>
        <p>{{ t('settings.audioControlPanelDescription') }}</p>
      </div>
      <button class="secondary-button" type="button" @click="openAudioControls">
        {{ t('settings.openAudioControlPanel') }}
      </button>
    </div>
    <SleepTimerSettings />
    <div class="setting-row">
      <div>
        <h3>{{ t('settings.autoPlayOnRestore') }}</h3>
        <p>{{ t('settings.autoPlayOnRestoreDescription') }}</p>
      </div>
      <BaseSwitch v-model="ui.autoPlayOnRestore" size="md" />
    </div>

    <div class="setting-row">
      <div>
        <h3>{{ t('settings.reduceMotion') }}</h3>
        <p>{{ t('settings.reduceMotionDescription') }}</p>
      </div>
      <BaseSwitch v-model="ui.reduceMotion" size="md" />
    </div>
  </div>
</template>

<style scoped>
.settings-card {
  border: 1px solid var(--color-border);
  border-radius: 14px;
  background: color-mix(in srgb, var(--color-bg-l) 35%, transparent);
  box-shadow: 0 1px 1px color-mix(in srgb, var(--color-black-20) 30%, transparent);
}

.setting-row {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1.1rem 1.25rem;
}

.setting-row h3 {
  color: var(--color-text);
  font-size: 0.9rem;
  font-weight: 550;
}

.setting-row p {
  margin-top: 0.25rem;
  color: var(--color-text-l);
  font-size: 0.8125rem;
  line-height: 1.45;
}

.secondary-button {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  white-space: nowrap;
  border: 1px solid var(--color-border);
  border-radius: 7px;
  padding: 0.45rem 0.7rem;
  color: var(--color-text);
  font-size: 0.78rem;
  transition:
    border-color var(--motion-duration-standard) var(--motion-ease-standard),
    background-color var(--motion-duration-standard) var(--motion-ease-standard),
    color var(--motion-duration-standard) var(--motion-ease-standard);
}

.secondary-button:hover {
  border-color: var(--color-primary);
  background: var(--color-hover);
  color: var(--color-primary);
}
</style>
