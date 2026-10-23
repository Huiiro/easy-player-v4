<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import DspKnobField from './DspKnobField.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import { computed } from 'vue'
import { useMessage } from '@/components/ui/useMessage'
const player = usePlayerStore()
const { t } = useI18n()
const { warning } = useMessage()
function backendLabel(backend: string): string {
  if (backend === 'wasapi_shared') return t('ap.wasapiShared')
  if (backend === 'wasapi_exclusive') return t('ap.wasapiExclusive')
  if (backend === 'asio') return 'ASIO'
  if (backend === 'directsound') return 'DirectSound'
  return backend
}
const deviceOptions = computed(() =>
  player.devices.map((device) => ({
    value: `${device.backend}\u0000${device.id}`,
    label: `${backendLabel(device.backend)} · ${device.name}${device.isDefault ? ` (${t('ap.defaultDevice')})` : ''}`
  }))
)
const selectedDevice = computed(() => `${player.currentBackend}\u0000${player.currentDeviceId}`)
async function selectDevice(value: string | number | (string | number)[]): Promise<void> {
  if (typeof value !== 'string') return
  const device = player.devices.find((item) => `${item.backend}\u0000${item.id}` === value)
  if (device && !(await player.selectOutputDevice(device))) warning(t('ap.v2UpdateFailed'))
  await player.refreshAudioChain()
}
</script>
<template>
  <div class="space-y-4 text-xs">
    <div class="my-2">{{ t('ap.outputDevice') }}</div>
    <label class="flex flex-wrap items-center gap-3">
      <BaseSelect
        teleport
        :model-value="selectedDevice"
        :options="deviceOptions"
        class="min-w-48 flex-1"
        @change="selectDevice"
      />
      <button
        class="rounded border border-border px-2.5 py-1.5 hover:border-primary"
        @click="player.refreshDevices()"
      >
        {{ t('ap.refreshDevice') }}
      </button>
    </label>
    <DspKnobField
      :model-value="Math.round(player.volume * 100)"
      :label="t('ap.volume')"
      :description="t('ap.v2VolumeHelp')"
      :min="0"
      :max="100"
      unit="%"
      @update:model-value="player.setVolume($event / 100)"
    />
  </div>
</template>
