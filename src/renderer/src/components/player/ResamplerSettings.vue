<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { computed } from 'vue'
const player = usePlayerStore()
const { t } = useI18n()
const sampleRateOptions = [44100, 48000, 88200, 96000, 176400, 192000].map((value) => ({
  value,
  label: `${value / 1000} kHz`
}))
const qualityOptions = computed(() => [
  { value: 'best', label: t('ap.qualityBest') },
  { value: 'medium', label: t('ap.qualityMedium') },
  { value: 'fast', label: t('ap.qualityFast') }
])
</script>
<template>
  <div class="space-y-4 text-xs">
    <div class="flex items-center gap-3">
      <BaseSwitch
        v-model="player.resamplerConfig.forceOutputRate"
        class="w-fit text-left"
        @change="player.setResamplerConfig(player.resamplerConfig)"
      >
        {{ t('ap.resampler') }}
      </BaseSwitch>
    </div>
    <div class="flex flex-wrap gap-3">
      <BaseSelect
        v-model="player.resamplerConfig.targetSampleRate"
        teleport
        :options="sampleRateOptions"
        class="w-44"
        @change="player.setResamplerConfig(player.resamplerConfig)"
      /><BaseSelect
        v-model="player.resamplerConfig.quality"
        teleport
        :options="qualityOptions"
        class="w-44"
        @change="player.setResamplerConfig(player.resamplerConfig)"
      />
    </div>
    <div class="flex items-center gap-3">
      <BaseSwitch
        class="w-fit text-left"
        :model-value="player.dopEnabled"
        @change="(value) => player.setDopEnabled(value === true)"
      >
        {{ t('ap.enableDoP') }}
      </BaseSwitch>
    </div>
    <p class="text-text-l">{{ t('ap.dopDesc') }} {{ t('ap.dopNextPlayback') }}</p>
  </div>
</template>
