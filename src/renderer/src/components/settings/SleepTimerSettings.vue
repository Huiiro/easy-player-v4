<script setup lang="ts">
import SettingRow from './SettingRow.vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import BaseSwitch from '@/components/ui/BaseSwitch.vue'

const player = usePlayerStore()
const { t } = useI18n()
const minutes = ref(30)
const deadline = ref<number | null>(null)
const now = ref(Date.now())
const finishCurrentTrack = ref(false)
let timer: number | undefined

const remainingSeconds = computed(() =>
  deadline.value ? Math.max(0, Math.ceil((deadline.value - now.value) / 1000)) : 0
)
const remainingLabel = computed(() => {
  const minutesLeft = Math.floor(remainingSeconds.value / 60)
  const secondsLeft = remainingSeconds.value % 60
  return `${minutesLeft}:${String(secondsLeft).padStart(2, '0')}`
})

function clearTimer(): void {
  if (timer) window.clearInterval(timer)
  timer = undefined
  deadline.value = null
}
function startTimer(): void {
  const duration = Math.max(1, Math.min(720, Number(minutes.value) || 30))
  minutes.value = duration
  player.setStopAfterCurrent(false)
  deadline.value = Date.now() + duration * 60_000
  now.value = Date.now()
  if (timer) window.clearInterval(timer)
  timer = window.setInterval(() => {
    now.value = Date.now()
    if (deadline.value && now.value >= deadline.value) {
      clearTimer()
      if (finishCurrentTrack.value && player.isPlaying) player.setStopAfterCurrent(true)
      else void player.pause()
    }
  }, 1000)
}
watch(finishCurrentTrack, (enabled) => {
  if (!enabled) player.setStopAfterCurrent(false)
})
onBeforeUnmount(clearTimer)
</script>

<template>
  <SettingRow :label="t('settings.sleepTimer')" :description="t('settings.sleepTimerDescription')">
    <div class="flex items-center gap-2 text-nowrap">
      <span v-if="deadline" class="tabular-nums text-sm text-primary">{{ remainingLabel }}</span>
      <input
        v-model.number="minutes"
        class="input-base w-16 text-center"
        type="number"
        min="1"
        max="720"
      />
      <span class="text-xs text-text-l mx-1">{{ t('settings.minutes') }}</span>
      <button class="secondary-button" @click="deadline ? clearTimer() : startTimer()">
        {{ deadline ? t('settings.cancelSleepTimer') : t('settings.startSleepTimer') }}
      </button>
    </div>
  </SettingRow>
  <SettingRow
    :label="t('settings.stopAfterCurrent')"
    :description="t('settings.stopAfterCurrentDescription')"
  >
    <BaseSwitch v-model="finishCurrentTrack" size="md" />
  </SettingRow>
</template>
