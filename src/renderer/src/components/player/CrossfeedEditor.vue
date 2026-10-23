<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import DspKnobField from './DspKnobField.vue'
const player = usePlayerStore()
const { t } = useI18n()
</script>
<template>
  <div class="flex flex-wrap gap-3 text-xs">
    <p class="w-full text-text-l">{{ t('ap.crossfeedDesc') }}</p>
    <DspKnobField
      v-model="player.crossfeedConfig.strength"
      :label="t('ap.crossfeedStrength')"
      :description="t('ap.crossfeedStrengthHelp')"
      :min="0"
      :max="1"
      :step="0.05"
      :decimals="2"
      @change="player.setCrossfeedConfig()"
    />
    <DspKnobField
      v-model="player.crossfeedConfig.cutoffHz"
      :label="t('ap.crossfeedCutoff')"
      :description="t('ap.crossfeedCutoffHelp')"
      :min="300"
      :max="1500"
      :step="50"
      unit="Hz"
      @change="player.setCrossfeedConfig()"
    />
    <DspKnobField
      v-model="player.crossfeedConfig.delayMs"
      :label="t('ap.crossfeedDelay')"
      :description="t('ap.crossfeedDelayHelp')"
      :min="0"
      :max="0.6"
      :step="0.05"
      :decimals="2"
      unit="ms"
      @change="player.setCrossfeedConfig()"
    />
  </div>
</template>
