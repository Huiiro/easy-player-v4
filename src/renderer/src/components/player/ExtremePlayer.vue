<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlayerStore } from '@/stores/player/playerStore'
import { useUIStore } from '@/stores/ui/uiStore'
import { useSeekProgress } from './useSeekProgress'
const player = usePlayerStore()
const { displayPositionMs, previewSeek, commitSeek, cancelSeek } = useSeekProgress(player)
const ui = useUIStore()
const { t } = useI18n()
const title = computed(
  () => player.currentQueueSong?.title || player.trackInfo?.metadata?.title || t('footer.noTrack')
)
const subtitle = computed(() =>
  [
    player.currentQueueSong?.artist || player.trackInfo?.metadata?.artist,
    player.currentQueueSong?.album || player.trackInfo?.metadata?.album
  ]
    .filter(Boolean)
    .join(' · ')
)
const progress = computed(() =>
  Math.max(0, Math.min(100, (displayPositionMs.value / (player.durationMs || 1)) * 100))
)
function time(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  return Math.floor(seconds / 60) + ':' + String(seconds % 60).padStart(2, '0')
}
</script>

<template>
  <main class="extreme-player" :style="{ '--color-primary': ui.activeThemeColor }">
    <div class="playback-body">
      <div class="song-info">
        <h1 :title="title">{{ title }}</h1>
        <p v-if="subtitle" :title="subtitle">{{ subtitle }}</p>
      </div>
      <div class="progress">
        <input
          class="slider"
          type="range"
          min="0"
          :max="player.durationMs || 1"
          :value="displayPositionMs"
          :style="{ '--fill': progress + '%' }"
          :aria-label="t('footer.progress')"
          @input="previewSeek"
          @change="commitSeek"
          @pointercancel="cancelSeek"
          @blur="cancelSeek"
        />
        <div class="time">
          <span>{{ time(displayPositionMs) }}</span
          ><span>{{ time(player.durationMs) }}</span>
        </div>
      </div>
      <div class="controls">
        <button
          class="transport"
          type="button"
          :aria-label="t('footer.previous')"
          @click="player.playPrevious()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5h2v14H6zM18 5v14L9 12z" /></svg>
        </button>
        <button
          class="transport play"
          type="button"
          :aria-label="t(player.isPlaying ? 'footer.pause' : 'footer.play')"
          @click="player.isPlaying ? player.pause() : player.play()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path v-if="player.isPlaying" d="M7 5h4v14H7zM14 5h4v14h-4z" />
            <path v-else d="m8 5 11 7-11 7z" />
          </svg>
        </button>
        <button
          class="transport"
          type="button"
          :aria-label="t('footer.next')"
          @click="player.playNext()"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 5h2v14h-2zM6 5l9 7-9 7z" /></svg>
        </button>
      </div>
      <div class="volume-row">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 9v6h4l5 4V5L8 9H4z" />
          <path class="sound-wave" d="M17 8a6 6 0 0 1 0 8" />
        </svg>
        <input
          class="slider"
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="player.volume"
          :style="{ '--fill': player.volume * 100 + '%' }"
          :aria-label="t('footer.volume')"
          @input="player.setVolume(Number(($event.target as HTMLInputElement).value))"
        />
        <span>{{ Math.round(player.volume * 100) }}%</span>
      </div>
      <button
        class="exit"
        type="button"
        :disabled="player.playbackModeChanging"
        @click="player.setExtremePlayback(false)"
      >
        {{ t('settings.returnFullPlayer') }} <span aria-hidden="true">↗</span>
      </button>
    </div>
    <p class="mode-status">{{ t('settings.extremePlaybackActive') }}</p>
  </main>
</template>

<style scoped>
.extreme-player {
  box-sizing: border-box;
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto minmax(0, 1fr);
  justify-items: center;
  padding: 28px 36px;
  background: #151515;
  color: #eee;
}
.playback-body {
  grid-row: 2;
  min-height: 0;
  width: min(440px, 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  text-align: center;
}
.song-info {
  width: 100%;
  text-align: center;
}
h1 {
  padding: 0;
  margin: 0;
  font-size: 22px;
  line-height: 1.3;
  font-weight: 600;
  letter-spacing: -0.02em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.song-info p {
  line-height: 1.5;
  margin: 7px 0 0;
  font-size: 12px;
  color: #a6aaa8;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.progress {
  width: 100%;
}
.slider {
  box-sizing: border-box;
  padding: 0;
  border: 0;
  display: block;
  appearance: none;
  -webkit-appearance: none;
  width: 100%;
  height: 5px;
  margin: 0;
  border-radius: 8px;
  background: linear-gradient(to right, var(--color-primary) var(--fill), #ffffff24 var(--fill));
  accent-color: var(--color-primary);
  cursor: pointer;
}
.slider::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--color-primary);
  border: 0;
}
.slider:focus-visible,
button:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 5px;
}
.time {
  line-height: 1.4;
  display: flex;
  justify-content: space-between;
  margin-top: 9px;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  color: #929895;
}
.controls {
  display: grid;
  grid-template-columns: 36px 42px 36px;
  justify-content: center;
  align-items: center;
  gap: 24px;
}
.transport {
  box-sizing: border-box;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  padding: 8px;
  border: 0;
  border-radius: 50%;
  color: #d6dcda;
  background: transparent;
}
.transport:hover {
  background: #ffffff12;
  color: #fff;
}
.transport.play {
  width: 42px;
  height: 42px;
  padding: 11px;
  background: var(--color-primary);
  color: #101713;
}
svg {
  display: block;
  width: 100%;
  height: 100%;
  fill: currentColor;
}
.volume-row {
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) 34px;
  align-items: center;
  gap: 12px;
  width: min(260px, 100%);
  color: #969e99;
}
.volume-row svg {
  justify-self: center;
  width: 16px;
  height: 16px;
}
.sound-wave {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
}
.volume-row span {
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 1.4;
  text-align: center;
}
.exit {
  font-family: inherit;
  line-height: 1.5;
  padding: 3px 0;
  border: 0;
  background: transparent;
  color: #a6afaa;
  font-size: 11px;
}
.exit:hover {
  color: var(--color-primary);
}
.exit span {
  padding-left: 3px;
}
.mode-status {
  grid-row: 3;
  align-self: end;
  margin: 0;
  text-align: center;
  font-size: 10px;
  line-height: 1.4;
  letter-spacing: 0.04em;
  color: #727c76;
}
</style>
