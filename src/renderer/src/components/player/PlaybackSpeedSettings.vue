<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import DspKnobField from './DspKnobField.vue'
const player = usePlayerStore()
const { t } = useI18n()
</script>
<template>
  <div class="space-y-4 text-xs">
    <div class="flex items-center gap-3">
      <BaseSwitch
        v-model="player.playbackSpeedConfig.enabled"
        class="w-fit text-left"
        @change="player.setPlaybackSpeed()"
      >
        {{ t('ap.playSpeed') }}
      </BaseSwitch>
    </div>
    <DspKnobField
      v-model="player.playbackSpeedConfig.speed"
      :label="t('ap.playSpeed')"
      :description="t('ap.v2SpeedHelp')"
      :min="0.5"
      :max="2"
      :step="0.05"
      :decimals="2"
      unit="×"
      @change="player.setPlaybackSpeed()"
    />
  </div>
</template>
