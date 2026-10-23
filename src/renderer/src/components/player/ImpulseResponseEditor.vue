<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'
import DspKnobField from './DspKnobField.vue'
import { ref } from 'vue'
const player = usePlayerStore()
const { t } = useI18n()
defineProps<{ error: string }>()
const emit = defineEmits<{ loadError: [code?: string]; clearError: [] }>()
const irFileInput = ref<HTMLInputElement | null>(null)
function openFilePicker(): void {
  irFileInput.value?.click()
}
defineExpose({ openFilePicker })
async function importIr(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  const path = window.api.audio.getFilePath(file)
  if (!path) return emit('loadError', 'path_unavailable')
  const previous = { ...player.impulseResponseConfig }
  player.impulseResponseConfig = { ...previous, enabled: true, path }
  const result = await player.setImpulseResponseConfig()
  if (!result.success) {
    player.impulseResponseConfig = previous
    emit('loadError', result.error)
  } else emit('clearError')
}
async function applyIr(): Promise<void> {
  const result = await player.setImpulseResponseConfig()
  if (!result.success) {
    await player.loadImpulseResponseConfig()
    emit('loadError', result.error)
  } else emit('clearError')
}
</script>
<template>
  <div class="space-y-4 text-xs">
    <p class="text-text-l">{{ t('ap.irDesc') }}</p>
    <input
      ref="irFileInput"
      class="hidden"
      type="file"
      accept=".wav,audio/wav"
      @change="importIr"
    />
    <div class="flex items-center gap-4">
      <button
        class="rounded-lg border border-border px-3 py-1.5 hover:border-primary"
        @click="irFileInput?.click()"
      >
        {{ t('ap.irImport') }}
      </button>
      <p v-if="player.impulseResponseConfig.path" class="break-all text-text-l">
        {{ player.impulseResponseConfig.path }}
      </p>
    </div>
    <BaseSwitch
      v-model="player.impulseResponseConfig.autoGain"
      class="w-fit text-left"
      @change="applyIr"
    >
      {{ t('ap.irAutoGain') }}
      {{ player.impulseResponseConfig.autoPreampDb?.toFixed(1) ?? '0.0' }} dB
    </BaseSwitch>
    <DspKnobField
      v-model="player.impulseResponseConfig.gainDb"
      :label="t('ap.irManualGain')"
      :description="t('ap.irTotalGain')"
      :min="-24"
      :max="12"
      :step="0.5"
      :decimals="1"
      unit="dB"
      :live="false"
      @change="applyIr"
    />
    <p v-if="error" class="text-danger">{{ error }}</p>
  </div>
</template>
