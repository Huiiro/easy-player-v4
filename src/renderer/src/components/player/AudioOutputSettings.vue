<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import DspKnobField from './DspKnobField.vue'
import BaseButton from '@/components/ui/BaseButton.vue'
import BaseSelect from '@/components/ui/BaseSelect.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { computed, ref } from 'vue'
import { useMessage } from '@/components/ui/useMessage'
const player = usePlayerStore()
const { t } = useI18n()
const { warning } = useMessage()
const refreshing = ref(false)

async function refreshDevices(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  try {
    await player.refreshDevices()
  } catch {
    warning(t('ap.v2UpdateFailed'))
  } finally {
    refreshing.value = false
  }
}

function backendLabel(backend: string): string {
  if (backend === 'wasapi_shared') return t('ap.wasapiShared')
  if (backend === 'wasapi_exclusive') return t('ap.wasapiExclusive')
  if (backend === 'asio') return 'ASIO'
  if (backend === 'directsound')
    return window.electron.process.platform === 'darwin' ? 'CoreAudio' : 'DirectSound'
  return backend
}
const deviceOptions = computed(() =>
  player.devices.map((device) => ({
    value: `${device.backend}\u0000${device.id}`,
    label: `${backendLabel(device.backend)} · ${device.name}${device.isDefault ? ` (${t('ap.defaultDevice')})` : ''}`
  }))
)
const selectedDevice = computed(() => `${player.currentBackend}\u0000${player.currentDeviceId}`)
const volumeBypassed = computed(
  () =>
    player.audioChain?.outputTransport === 'dop' ||
    player.audioChain?.activeNodes.includes('DoP encoded transport') === true
)
function setVolume(value: number): void {
  if (!volumeBypassed.value) void player.setVolume(value / 100)
}
async function selectDevice(value: string | number | (string | number)[]): Promise<void> {
  if (typeof value !== 'string') return
  const device = player.devices.find((item) => `${item.backend}\u0000${item.id}` === value)
  if (device && !(await player.selectOutputDevice(device))) warning(t('ap.v2UpdateFailed'))
  await player.refreshAudioChain()
}
</script>
<template>
  <div class="space-y-6 text-xs">
    <section class="space-y-3">
      <h4 class="text-sm font-semibold">{{ t('ap.outputDevice') }}</h4>
      <div class="flex flex-wrap items-center gap-3">
        <BaseSelect
          teleport
          :model-value="selectedDevice"
          :options="deviceOptions"
          :aria-label="t('ap.outputDevice')"
          class="min-w-48 flex-1"
          @change="selectDevice"
        />
        <BaseButton size="sm" variant="secondary" :loading="refreshing" @click="refreshDevices">
          <template #left><SvgIcon name="common-refresh" class-name="size-3" /></template>
          {{ t('ap.refreshDevice') }}
        </BaseButton>
      </div>
    </section>
    <section class="space-y-3">
      <h4 class="text-sm font-semibold">{{ t('ap.outputVolume') }}</h4>
      <fieldset :disabled="volumeBypassed" class="min-w-0 disabled:opacity-60">
        <DspKnobField
          :model-value="Math.round(player.volume * 100)"
          :label="t('ap.volume')"
          :description="volumeBypassed ? t('ap.volumeForPcm') : t('ap.v2VolumeHelp')"
          :min="0"
          :max="100"
          unit="%"
          @update:model-value="setVolume"
        />
      </fieldset>
      <p v-if="volumeBypassed" role="status" class="text-text-l">
        {{ t('ap.volumeBypassedForDop') }}
      </p>
    </section>
  </div>
</template>
