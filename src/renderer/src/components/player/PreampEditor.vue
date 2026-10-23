<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import DspKnobField from './DspKnobField.vue'
const player = usePlayerStore()
const { t } = useI18n()
</script>
<template>
  <div class="space-y-3 text-xs">
    <DspKnobField
      :model-value="player.preampDb"
      :label="t('ap.preamp')"
      :description="t('ap.v2PreampHelp')"
      :min="-24"
      :max="24"
      :step="0.1"
      :decimals="1"
      unit="dB"
      @update:model-value="player.preampDb = $event"
      @change="player.setPreamp(player.preampDb, player.preampEnabled)"
    />
  </div>
</template>
