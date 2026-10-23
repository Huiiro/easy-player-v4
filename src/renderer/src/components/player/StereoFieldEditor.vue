<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import DspKnobField from './DspKnobField.vue'
const player = usePlayerStore()
const { t } = useI18n()
</script>
<template>
  <div class="flex flex-wrap gap-3 text-xs">
    <p class="w-full text-text-l">{{ t('ap.stereoFieldDesc') }}</p>
    <DspKnobField
      v-model="player.stereoFieldConfig.width"
      :label="t('ap.stereoWidth')"
      :description="t('ap.stereoWidthHelp')"
      :min="0"
      :max="2"
      :step="0.05"
      :decimals="2"
      @change="player.setStereoFieldConfig()"
    />
    <DspKnobField
      v-model="player.stereoFieldConfig.midDb"
      :label="t('ap.midGain')"
      :description="t('ap.midGainHelp')"
      :min="-12"
      :max="6"
      :step="0.5"
      :decimals="1"
      unit="dB"
      @change="player.setStereoFieldConfig()"
    />
    <DspKnobField
      v-model="player.stereoFieldConfig.sideDb"
      :label="t('ap.sideGain')"
      :description="t('ap.sideGainHelp')"
      :min="-12"
      :max="6"
      :step="0.5"
      :decimals="1"
      unit="dB"
      @change="player.setStereoFieldConfig()"
    />
  </div>
</template>
