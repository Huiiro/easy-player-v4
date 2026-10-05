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
