<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'

const player = usePlayerStore()
const { t } = useI18n()
const minutes = ref(30)
const deadline = ref<number | null>(null)
const now = ref(Date.now())
const finishCurrentTrack = ref(false)
let timer: ReturnType<typeof setInterval> | undefined

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
function toggleStopAfterCurrent(): void {
  finishCurrentTrack.value = !finishCurrentTrack.value
  if (!finishCurrentTrack.value) player.setStopAfterCurrent(false)
}

onBeforeUnmount(clearTimer)
</script>

<template>
  <div class="setting-row sleep-timer-row">
    <div>
      <h3>{{ t('settings.sleepTimer') }}</h3>
      <p>{{ t('settings.sleepTimerDescription') }}</p>
    </div>
    <div class="flex items-center gap-2 text-nowrap">
      <span v-if="deadline" class="tabular-nums text-sm text-primary">{{ remainingLabel }}</span>
      <input
        v-model.number="minutes"
        class="input-base w-16 text-center"
        type="number"
        min="1"
        max="720"
      />
      <span class="text-xs text-text-l">{{ t('settings.minutes') }}</span>
      <button class="secondary-button" @click="deadline ? clearTimer() : startTimer()">
        {{ deadline ? t('settings.cancelSleepTimer') : t('settings.startSleepTimer') }}
      </button>
    </div>
  </div>
  <div class="setting-row sleep-timer-row">
    <div>
      <h3>{{ t('settings.stopAfterCurrent') }}</h3>
      <p>{{ t('settings.stopAfterCurrentDescription') }}</p>
    </div>
    <button
      class="secondary-button"
      :class="finishCurrentTrack && 'sleep-timer-active'"
      @click="toggleStopAfterCurrent"
    >
      {{ finishCurrentTrack ? t('settings.enabled') : t('settings.disabled') }}
    </button>
  </div>
</template>

<style scoped>
.sleep-timer-row {
  display: flex;
  min-height: 76px;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1.1rem 1.25rem;
}
.sleep-timer-row h3 {
  color: var(--color-text);
  font-size: 0.9rem;
  font-weight: 550;
}
.sleep-timer-row p {
  margin-top: 0.25rem;
  color: var(--color-text-l);
  font-size: 0.8125rem;
  line-height: 1.45;
}
.secondary-button {
  border: 1px solid var(--color-border);
  border-radius: 7px;
  padding: 0.45rem 0.7rem;
  color: var(--color-text);
  font-size: 0.78rem;
  transition:
    background-color 0.2s,
    color 0.2s;
}
.secondary-button:hover {
  background: var(--color-hover);
}
.sleep-timer-active {
  border-color: var(--color-primary);
  color: var(--color-primary);
}
</style>
