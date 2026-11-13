<script setup lang="ts">
import { computed } from 'vue'
import CoverAuraCanvas from '@/components/background/CoverAuraCanvas.vue'

const props = defineProps<{
  enabled: boolean
  primary: string
  secondary: string
  shape: 'circle' | 'rounded'
  rhythmAmount: number
  visualEnabled: boolean
  active: boolean
  reduceMotion: boolean
}>()
const amount = computed(() =>
  props.enabled &&
  props.visualEnabled &&
  props.active &&
  !props.reduceMotion &&
  Number.isFinite(props.rhythmAmount)
    ? Math.max(0, Math.min(1, props.rhythmAmount))
    : 0
)

const particleColors = ['#ffffff', '#7dd3fc', '#c4b5fd', '#f9a8d4', '#fde68a', '#86efac']
const particles = Array.from({ length: 24 }, (_, index) => {
  const angle = (Math.PI * 2 * index) / 24 - Math.PI / 2
  const originDistance = 46 + (index % 3) * 2
  const travelDistance = 24 + (index % 4) * 8
  return {
    originX: `${Math.cos(angle) * originDistance}%`,
    originY: `${Math.sin(angle) * originDistance}%`,
    x: `${Math.cos(angle) * travelDistance}px`,
    y: `${Math.sin(angle) * travelDistance}px`,
    delay: `${-index * 0.14}s`,
    duration: `${2.8 + (index % 3) * 0.3}s`,
    size: `${3 + (index % 3)}px`,
    color: particleColors[index % particleColors.length]
  }
})
</script>

<template>
  <div class="player-cover-glow" :style="{ transform: `scale(${1 + amount * 0.025})` }">
    <CoverAuraCanvas
      v-if="enabled && visualEnabled"
      class="cover-aura"
      :style="{ opacity: 0.48 + amount * 0.52 }"
      :primary="primary"
      :secondary="secondary"
      :shape="shape"
    />
    <div
      v-if="enabled && visualEnabled && active && !reduceMotion"
      class="cover-particles-anchor"
      :style="{ opacity: 0.16 + amount * 0.52 }"
      aria-hidden="true"
    >
      <div class="beat-particles">
        <i
          v-for="(particle, index) in particles"
          :key="index"
          class="beat-particle"
          :style="{
            '--particle-x': particle.x,
            '--particle-y': particle.y,
            '--particle-origin-x': particle.originX,
            '--particle-origin-y': particle.originY,
            '--particle-delay': particle.delay,
            '--particle-duration': particle.duration,
            '--particle-size': particle.size,
            '--particle-color': particle.color
          }"
        />
      </div>
    </div>
    <slot />
  </div>
</template>

<style scoped>
.player-cover-glow {
  position: relative;
  width: 100%;
  isolation: isolate;
  transform-origin: center;
  transition: transform var(--motion-duration-fast);
}
.cover-aura {
  transition: opacity 160ms ease;
}
.cover-particles-anchor {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  transition: opacity 220ms ease;
}
.beat-particles {
  position: absolute;
  inset: 0;
  overflow: visible;
}
.beat-particle {
  position: absolute;
  top: calc(50% + var(--particle-origin-y));
  left: calc(50% + var(--particle-origin-x));
  width: var(--particle-size);
  height: var(--particle-size);
  border-radius: 50%;
  background: var(--particle-color);
  opacity: 0;
  box-shadow:
    0 0 9px color-mix(in srgb, var(--particle-color) 78%, white),
    0 0 20px var(--particle-color);
  transform: translate(-50%, -50%);
  animation: particle-drift var(--particle-duration) ease-out infinite;
  animation-delay: var(--particle-delay);
}
@keyframes particle-drift {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.65);
  }
  28% {
    opacity: 0.55;
  }
  to {
    opacity: 0;
    transform: translate(calc(-50% + var(--particle-x)), calc(-50% + var(--particle-y))) scale(1.1);
  }
}
@media (prefers-reduced-motion: reduce) {
  .beat-particle {
    animation: none;
  }
}
</style>
