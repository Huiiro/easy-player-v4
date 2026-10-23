<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import DspKnobField from './DspKnobField.vue'
import { effectFields, type LegacyId } from './dspEffectFields'
import { useMessage } from '@/components/ui/useMessage'
const player = usePlayerStore()
const { t } = useI18n()
defineProps<{ effect: LegacyId | 'limiter' }>()
const { warning } = useMessage()
function effectConfig(id: LegacyId | 'limiter'): Record<string, number> {
  const configs = {
    compressor: player.compressorConfig,
    delay: player.delayConfig,
    reverb: player.reverbConfig,
    chorus: player.chorusConfig,
    noise_gate: player.noiseGateConfig,
    phaser: player.phaserConfig,
    limiter: player.limiterConfig
  }
  return configs[id] as unknown as Record<string, number>
}
async function applyEffect(id: LegacyId | 'limiter'): Promise<void> {
  const actions = {
    compressor: () => player.setCompressorConfig(),
    delay: () => player.setDelayConfig(),
    reverb: () => player.setReverbConfig(),
    chorus: () => player.setChorusConfig(),
    noise_gate: () => player.setNoiseGateConfig(),
    phaser: () => player.setPhaserConfig(),
    limiter: () => player.setLimiter()
  }
  if (!(await actions[id]())) warning(t('ap.v2UpdateFailed'))
  await player.refreshAudioChain()
}
</script>
<template>
  <div class="flex flex-wrap gap-3">
    <p v-if="effect === 'limiter'" class="w-full text-xs text-text-l">
      {{ t('ap.outputClipGuardDesc') }}
    </p>
    <DspKnobField
      v-for="field in effectFields[effect]"
      :key="field.key"
      :model-value="effectConfig(effect)[field.key]"
      :label="t(`ap.${field.label}`)"
      :description="t(`ap.dspHelp.${field.help}`)"
      :min="field.min"
      :max="field.max"
      :step="field.step"
      :decimals="field.decimals"
      :unit="field.unit"
      @update:model-value="effectConfig(effect)[field.key] = $event"
      @change="applyEffect(effect)"
    />
  </div>
</template>
