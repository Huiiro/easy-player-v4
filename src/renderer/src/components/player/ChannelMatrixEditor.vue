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
    <div class="flex flex-wrap items-center gap-5">
      <div class="flex items-center gap-2">
        <BaseSwitch
          v-model="player.channelMatrixConfig.swapStereo"
          class="w-fit text-left"
          @change="player.setChannelMatrixConfig()"
        >
          {{ t('ap.changeChannels') }}
        </BaseSwitch>
      </div>
      <div class="flex items-center gap-2">
        <BaseSwitch
          v-model="player.channelMatrixConfig.monoDownmix"
          class="w-fit text-left"
          @change="player.setChannelMatrixConfig()"
        >
          {{ t('ap.stereoToMono') }}
        </BaseSwitch>
      </div>
    </div>
    <DspKnobField
      v-model="player.channelMatrixConfig.balance"
      :label="t('ap.channelMatrix')"
      :description="t('ap.v2BalanceHelp')"
      :min="-1"
      :max="1"
      :step="0.05"
      :decimals="2"
      @change="player.setChannelMatrixConfig()"
    />

    <div class="flex flex-wrap gap-3">
      <DspKnobField
        v-for="(_gain, index) in player.channelMatrixConfig.outputGains"
        :key="index"
        v-model="player.channelMatrixConfig.outputGains[index]"
        :label="t('ap.channelNumber', { number: index + 1 })"
        :description="t('ap.v2OutputGainHelp')"
        :min="0"
        :max="2"
        :step="0.01"
        :decimals="2"
        @change="player.setChannelMatrixConfig()"
      />
    </div>
  </div>
</template>
