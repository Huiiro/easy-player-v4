<script setup lang="ts">
import SettingCard from './SettingCard.vue'
import SettingRow from './SettingRow.vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import SleepTimerSettings from './SleepTimerSettings.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import eventBus from '@/utils/eventBus'

const ui = useUIStore()
const player = usePlayerStore()
const { t } = useI18n()
const songPlayTriggerOptions = computed(() => [
  { label: t('settings.songPlayDoubleClick'), value: 'double' },
  { label: t('settings.songPlaySingleClick'), value: 'single' }
])

const playQueuePositionOptions = computed(() => [
  { label: t('settings.playQueueRight'), value: 'right' },
  { label: t('settings.playQueueLeft'), value: 'left' }
])

function openAudioControls(): void {
  eventBus.emit('openAudioControls')
}

function setSmartShuffle(value: boolean | string | number): void {
  void player.setSmartShuffleEnabled(value === true)
}
</script>
<template>
  <SettingCard>
    <SettingRow
      :label="t('settings.audioControlPanel')"
      :description="t('settings.audioControlPanelDescription')"
    >
      <button class="secondary-button" type="button" @click="openAudioControls">
        {{ t('settings.openAudioControlPanel') }}
      </button>
    </SettingRow>
    <hr class="mx-5 my-4 border-0 border-t border-border" />
    <SleepTimerSettings />
    <SettingRow
      :label="t('settings.songPlayTrigger')"
      :description="t('settings.songPlayTriggerDescription')"
    >
      <BaseSelect
        v-model="ui.songPlayTrigger"
        class="w-48"
        :options="songPlayTriggerOptions"
        :aria-label="t('settings.songPlayTrigger')"
        teleport
      />
    </SettingRow>
    <SettingRow
      :label="t('settings.playQueuePosition')"
      :description="t('settings.playQueuePositionDescription')"
    >
      <BaseSelect
        v-model="ui.playQueuePosition"
        class="w-48"
        :options="playQueuePositionOptions"
        :aria-label="t('settings.playQueuePosition')"
        teleport
      />
    </SettingRow>
    <SettingRow
      :label="t('settings.autoPlayOnRestore')"
      :description="t('settings.autoPlayOnRestoreDescription')"
    >
      <BaseSwitch v-model="ui.autoPlayOnRestore" size="md" />
    </SettingRow>
    <SettingRow
      :label="t('settings.smartShuffle')"
      :description="t('settings.smartShuffleDescription')"
    >
      <BaseSwitch
        :model-value="player.smartShuffleEnabled"
        size="md"
        @update:model-value="setSmartShuffle"
      />
    </SettingRow>
    <hr class="mx-5 my-4 border-0 border-t border-border" />
    <SettingRow
      :label="t('settings.reduceMotion')"
      :description="t('settings.reduceMotionDescription')"
    >
      <BaseSwitch v-model="ui.reduceMotion" size="md" />
    </SettingRow>
    <SettingRow
      :label="t('settings.extremePlayback')"
      :description="t('settings.extremePlaybackDescription')"
    >
      <BaseSwitch
        :model-value="ui.extremePlayback"
        :disabled="player.playbackModeChanging"
        size="md"
        @update:model-value="player.setExtremePlayback($event === true)"
      />
    </SettingRow>
  </SettingCard>
</template>
