<script setup lang="ts">
import { DEFAULT_PLAYER_COVER_EFFECT, PlayerCoverEffect, PlayerCoverStyle } from '@/constants'
import PlayerCoverGlow from './PlayerCoverGlow.vue'
import SvgIcon from '@/components/svg/SvgIcon.vue'

withDefaults(
  defineProps<{
    effect?: PlayerCoverEffect
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
  }>(),
  { effect: DEFAULT_PLAYER_COVER_EFFECT }
)
const emit = defineEmits<{ load: [event: Event]; error: [event: Event] }>()
</script>

<template>
  <div class="cover-frame" @dragstart.prevent>
    <PlayerCoverGlow
      :enabled="effect === PlayerCoverEffect.GLOW"
      :primary="primary"
      :secondary="secondary"
      :shape="coverStyle === PlayerCoverStyle.VINYL ? 'circle' : 'rounded'"
      :rhythm-amount="rhythmAmount"
      :visual-enabled="visualEnabled"
      :active="active"
      :reduce-motion="reduceMotion"
    >
      <div v-if="coverStyle === PlayerCoverStyle.STANDARD" class="cover-card">
        <img
          v-if="coverUrl"
          :src="coverUrl"
          class="size-full object-cover"
          :alt="title"
          draggable="false"
          crossorigin="anonymous"
          @load="emit('load', $event)"
          @error="emit('error', $event)"
        />
        <SvgIcon v-else name="common-music" class-name="size-20" />
      </div>
      <div v-else class="vinyl-record">
        <div
          class="vinyl-disc"
          :class="{ 'vinyl-disc--spinning': playing && spin && !reduceMotion }"
        >
          <div class="vinyl-label">
            <img
              v-if="coverUrl"
              :src="coverUrl"
              class="size-full object-cover"
              :alt="title"
              draggable="false"
              crossorigin="anonymous"
              @load="emit('load', $event)"
              @error="emit('error', $event)"
            />
            <SvgIcon v-else name="common-music" class-name="size-12" />
          </div>
        </div>
        <span class="vinyl-sheen" aria-hidden="true" />
      </div>
    </PlayerCoverGlow>
  </div>
</template>

<style scoped>
.cover-frame {
  width: calc(min(540px, 38vw, 100dvh - 29rem) * 0.9);
  max-width: 100%;
  position: relative;
  isolation: isolate;
}
@media (max-width: 760px) {
  .cover-frame {
    width: calc(min(340px, 64vw, 100dvh - 24rem) * 0.9);
  }
}
@media (max-width: 700px) {
  .cover-frame {
    width: calc(min(245px, 46vh) * 0.9);
  }
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
@media (prefers-reduced-motion: reduce) {
  .vinyl-disc {
    animation: none;
  }
}
</style>
