<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
const { t } = useI18n()
const player = usePlayerStore()
const ui = useUIStore()
const reducedMotion = computed(() => ui.reduceMotion || player.rhythmVisualConfig?.reducedMotion)
const animated = computed(
  () => player.isPlaying && !reducedMotion.value && player.rhythmVisualConfig?.enabled !== false
)
const bars = Array.from({ length: 36 }, (_, index) => ({
  angle: index * 10,
  length: 4 + ((index * 7) % 5),
  style: {
    animationDelay: `${-index * 0.13}s`,
    animationDuration: `${1.4 + (index % 5) * 0.16}s`
  }
}))
</script>
<template>
  <div
    class="flex h-full min-h-48 flex-col items-center justify-center gap-3 pb-24 text-text-l"
    role="status"
    data-instrumental
  >
    <div
      class="instrumental-orbit relative grid size-42 shrink-0 place-items-center"
      :class="{
        'instrumental-orbit--playing': animated,
        'instrumental-orbit--still': reducedMotion
      }"
      aria-hidden="true"
    >
      <svg
        class="instrumental-orbit-ring absolute inset-0 size-full"
        viewBox="0 0 96 96"
        fill="none"
      >
        <g v-for="(bar, index) in bars" :key="index" :transform="`rotate(${bar.angle} 48 48)`">
          <line
            class="instrumental-orbit-bar"
            x1="48"
            y1="6"
            x2="48"
            :y2="6 + bar.length"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            :style="bar.style"
          />
        </g>
      </svg>
      <SvgIcon name="common-music-notes" class-name="instrumental-icon size-14 opacity-60" />
    </div>
    <p class="text-sm opacity-70">{{ t('lyrics.instrumentalHint') }}</p>
  </div>
</template>

<style scoped>
.instrumental-orbit-ring,
.instrumental-icon {
  animation: instrumental-breathe 3.2s ease-in-out infinite paused;
}
.instrumental-orbit-bar {
  transform-box: fill-box;
  transform-origin: center;
  opacity: 0.35;
  animation: instrumental-ripple 1.6s ease-in-out infinite paused;
}
.instrumental-orbit--playing .instrumental-orbit-ring,
.instrumental-orbit--playing .instrumental-icon,
.instrumental-orbit--playing .instrumental-orbit-bar {
  animation-play-state: running;
}
.instrumental-orbit--still .instrumental-orbit-ring,
.instrumental-orbit--still .instrumental-icon,
.instrumental-orbit--still .instrumental-orbit-bar {
  animation: none;
}
@keyframes instrumental-breathe {
  0%,
  100% {
    transform: scale(0.96);
  }
  50% {
    transform: scale(1.04);
  }
}
@keyframes instrumental-ripple {
  0%,
  100% {
    transform: scaleY(0.6);
    opacity: 0.2;
  }
  45% {
    transform: scaleY(1.35);
    opacity: 0.65;
  }
}
@media (prefers-reduced-motion: reduce) {
  .instrumental-orbit-ring,
  .instrumental-icon,
  .instrumental-orbit-bar {
    animation: none;
  }
}
</style>
