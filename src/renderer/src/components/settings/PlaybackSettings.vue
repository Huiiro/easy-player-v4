<script setup lang="ts">
import SettingGroup from '@/components/settings/SettingGroup.vue'
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

const motionIntensityOptions = computed(() => [
  { label: t('settings.motionIntensityGentle'), value: 0.2 },
  { label: t('settings.motionIntensityModerate'), value: 0.6 },
  { label: t('settings.motionIntensityStrong'), value: 1 }
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
    <SettingGroup :title="t('settings.groups.audio')">
      <SettingRow
        :label="t('settings.audioControlPanel')"
        :description="t('settings.audioControlPanelDescription')"
      >
        <button class="secondary-button" type="button" @click="openAudioControls">
          {{ t('settings.openAudioControlPanel') }}
        </button>
      </SettingRow>
    </SettingGroup>
    <SettingGroup :title="t('settings.groups.timer')">
      <SleepTimerSettings />
    </SettingGroup>
    <SettingGroup :title="t('settings.groups.playback')">
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
    </SettingGroup>
    <SettingGroup :title="t('settings.groups.performance')">
      <SettingRow
        :label="t('settings.motionIntensity')"
        :description="t('settings.motionIntensityDescription')"
      >
        <BaseSelect
          v-model="player.rhythmVisualConfig.intensity"
          class="w-48"
          :options="motionIntensityOptions"
          :aria-label="t('settings.motionIntensity')"
          teleport
        />
      </SettingRow>
      <SettingRow
        :label="t('settings.reduceMotion')"
        :description="t('settings.reduceMotionDescription')"
      >
        <BaseSwitch v-model="ui.reduceMotion" size="md" />
      </SettingRow>
      <SettingRow
        :label="t('settings.pauseAnimationsOnBlur')"
        :description="t('settings.pauseAnimationsOnBlurDescription')"
      >
        <BaseSwitch
          v-model="ui.pauseAnimationsOnBlur"
          :aria-label="t('settings.pauseAnimationsOnBlur')"
          size="md"
        />
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
    </SettingGroup>
  </SettingCard>
</template>
