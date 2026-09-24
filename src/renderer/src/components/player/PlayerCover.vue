<script setup lang="ts">
import { PlayerCoverStyle } from '@/consts'
import CoverAuraCanvas from '@/components/background/CoverAuraCanvas.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'

defineProps<{
  coverStyle: PlayerCoverStyle
  coverUrl: string | null
  title: string
  primary: string
  secondary: string
  rhythmAmount: number
  visualEnabled: boolean
  active: boolean
  playing: boolean
  reduceMotion: boolean
  spin: boolean
}>()
const emit = defineEmits<{ load: [event: Event]; error: [event: Event] }>()

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
  <div class="cover-frame" :style="{ transform: `scale(${1 + rhythmAmount * 0.025})` }">
    <CoverAuraCanvas
      v-if="visualEnabled"
      class="cover-aura"
      :style="{ opacity: 0.48 + rhythmAmount * 0.52 }"
      :primary="primary"
      :secondary="secondary"
      :shape="coverStyle === PlayerCoverStyle.VINYL ? 'circle' : 'rounded'"
    />
    <div
      v-if="active"
      class="cover-particles-anchor"
      :style="{ opacity: 0.16 + rhythmAmount * 0.52 }"
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
    <div v-if="coverStyle === PlayerCoverStyle.STANDARD" class="cover-card">
      <img
        v-if="coverUrl"
        :src="coverUrl"
        class="size-full object-cover"
        :alt="title"
        crossorigin="anonymous"
        @load="emit('load', $event)"
        @error="emit('error', $event)"
      />
      <SvgIcon v-else name="common-music" class-name="size-20" />
    </div>
    <div v-else class="vinyl-record">
      <div class="vinyl-disc" :class="{ 'vinyl-disc--spinning': playing && spin && !reduceMotion }">
        <div class="vinyl-label">
          <img
            v-if="coverUrl"
            :src="coverUrl"
            class="size-full object-cover"
            :alt="title"
            crossorigin="anonymous"
            @load="emit('load', $event)"
            @error="emit('error', $event)"
          />
          <SvgIcon v-else name="common-music" class-name="size-12" />
        </div>
      </div>
      <span class="vinyl-sheen" aria-hidden="true" />
    </div>
  </div>
</template>

<style scoped>
.cover-frame {
  width: min(540px, 38vw, calc(100dvh - 29rem));
  max-width: 100%;
  position: relative;
  isolation: isolate;
  transform-origin: center;
  transition: transform var(--motion-duration-fast);
}
@media (max-width: 760px) {
  .cover-frame {
    width: min(340px, 64vw, calc(100dvh - 24rem));
  }
}
@media (max-width: 700px) {
  .cover-frame {
    width: min(245px, 46vh);
  }
}
.cover-aura {
  transition: opacity 160ms ease;
}
.cover-card {
  position: relative;
  z-index: 10;
  display: grid;
  width: 100%;
  aspect-ratio: 1;
  place-items: center;
  overflow: hidden;
  border-radius: 2rem;
  background: linear-gradient(135deg, var(--color-primary), #8b5cf6);
  color: white;
}
.vinyl-record {
  position: relative;
  z-index: 10;
  display: grid;
  width: 100%;
  aspect-ratio: 1;
  place-items: center;
  border-radius: 50%;
  background: #14161a;
  box-shadow: inset 0 0 0 2px rgb(255 255 255 / 0.08);
}
.vinyl-disc {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 50%;
  background:
    repeating-radial-gradient(circle, rgb(255 255 255 / 0.025) 0 1px, transparent 2px 5px),
    radial-gradient(circle, #202227 0%, #111317 72%, #090a0c 100%);
  animation: vinyl-rotation 12s linear infinite paused;
}
.vinyl-disc--spinning {
  animation-play-state: running;
}
.vinyl-sheen {
  position: absolute;
  z-index: 2;
  inset: 0;
  border-radius: 50%;
  background: radial-gradient(ellipse 82% 70% at 24% 18%, rgb(255 255 255 / 0.24), transparent 70%);
  mask-image: radial-gradient(circle, transparent 0 24%, #000 27%);
  pointer-events: none;
}
.vinyl-label {
  position: relative;
  z-index: 1;
  display: grid;
  width: 50%;
  aspect-ratio: 1;
  place-items: center;
  overflow: hidden;
  border: 5px solid #101115;
  border-radius: 50%;
  background: linear-gradient(135deg, #b47b89, #604475);
  color: white;
}
@keyframes vinyl-rotation {
  to {
    transform: rotate(360deg);
  }
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
  .vinyl-disc,
  .beat-particle {
    animation: none;
  }
}
</style>
