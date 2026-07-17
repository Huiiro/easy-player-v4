<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import SvgIcon from '@/components/svg/SvgIcon.vue'

const ui = useUIStore()
const player = usePlayerStore()
const trackTitle = computed(
  () => player.trackInfo?.metadata?.title || player.currentQueueSong?.title || '未选择音乐'
)
const trackArtist = computed(
  () => player.trackInfo?.metadata?.artist || player.currentQueueSong?.artist || 'Easy Player'
)
const progressPercent = computed(() => `${Math.round(player.progress * 100)}%`)
const coverFailed = ref(false)
const coverUrl = computed(() => {
  const cover = player.currentQueueSong?.cover
  return cover ? `easy-player-media://cover?path=${encodeURIComponent(cover)}` : null
})
const audioDetails = computed(() => {
  const info = player.trackInfo
  if (!info) return []
  const channels =
    info.channels === 1 ? '单声道' : info.channels === 2 ? '立体声' : `${info.channels} 声道`
  return [
    ['格式', info.format?.toUpperCase() || info.codecName || '—'],
    ['采样率', info.sampleRate ? `${info.sampleRate / 1000} kHz` : '—'],
    ['位深', info.bitDepth ? `${info.bitDepth} bit` : '—'],
    ['声道', channels],
    ['码率', info.bitrateKbps ? `${info.bitrateKbps} kbps` : '—']
  ]
})
watch(coverUrl, () => {
  coverFailed.value = false
})

function close(): void {
  ui.showPlayer = false
}
function togglePlayback(): void {
  if (player.isPlaying) void player.pause()
  else if (player.currentFile) void player.play()
}
function playPrevious(): void {
  void player.playPrevious()
}
function playNext(): void {
  void player.playNext()
}
function seek(event: Event): void {
  void player.seek(Number((event.target as HTMLInputElement).value))
}
</script>

<template>
  <div class="player-panel-layer">
    <section class="player-panel" aria-label="播放器面板">
      <header class="panel-header">
        <span>正在播放</span>
        <button class="close-button" title="关闭播放器" aria-label="关闭播放器" @click="close">
          <SvgIcon name="common-close" class-name="size-5" />
        </button>
      </header>

      <div class="panel-layout">
        <section class="panel-content">
          <div class="panel-cover" :class="{ 'is-playing': player.isPlaying }">
            <img
              v-if="coverUrl && !coverFailed"
              :src="coverUrl"
              class="size-full object-cover"
              :alt="trackTitle"
              @error="coverFailed = true"
            />
            <SvgIcon v-else name="common-music" class-name="size-20" />
          </div>
          <div class="min-w-0 text-center">
            <h2 class="truncate text-xl font-bold text-[var(--color-text)]">{{ trackTitle }}</h2>
            <p class="mt-1 truncate text-sm text-[var(--color-text-l)]">{{ trackArtist }}</p>
          </div>
          <dl v-if="audioDetails.length" class="audio-details">
            <div v-for="[label, value] in audioDetails" :key="label">
              <dt>{{ label }}</dt>
              <dd>{{ value }}</dd>
            </div>
          </dl>
          <div class="progress-block">
            <input
              class="panel-range"
              type="range"
              min="0"
              :max="player.durationMs || 0"
              :value="player.positionMs"
              :style="{ '--range-progress': progressPercent }"
              :disabled="!player.durationMs"
              aria-label="播放进度"
              @input="seek"
            />
            <div class="flex justify-between text-xs tabular-nums text-[var(--color-text-l)]">
              <span>{{ player.positionFormatted }}</span
              ><span>{{ player.durationFormatted }}</span>
            </div>
          </div>
          <div class="panel-controls">
            <button
              class="panel-control"
              :disabled="!player.queue.length"
              title="上一首"
              @click="playPrevious"
            >
              <SvgIcon name="play-prev" class-name="size-6" />
            </button>
            <button
              class="panel-play"
              :disabled="!player.currentFile"
              :title="player.isPlaying ? '暂停' : '播放'"
              @click="togglePlayback"
            >
              <SvgIcon :name="player.isPlaying ? 'play-pause' : 'play-play'" class-name="size-8" />
            </button>
            <button
              class="panel-control"
              :disabled="!player.queue.length"
              title="下一首"
              @click="playNext"
            >
              <SvgIcon name="play-next" class-name="size-6" />
            </button>
          </div>
        </section>

        <section class="lyrics-panel" aria-label="歌词">
          <p class="lyrics-label">歌词</p>
          <div class="lyrics-placeholder">
            <SvgIcon name="common-lyrics" class-name="size-8" />
            <p>暂无歌词</p>
            <span>歌词将在这里随播放进度显示</span>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>

<style scoped>
.player-panel-layer {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: color-mix(in srgb, var(--color-bg) 80%, transparent);
  backdrop-filter: blur(20px) saturate(150%);
}
.player-panel {
  width: 100%;
  height: 100%;
  overflow: hidden;
  color: var(--color-text-l);
  background: color-mix(in srgb, var(--color-bg) 82%, transparent);
  border: 0;
  border-radius: 0;
  box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 18%, transparent);
  backdrop-filter: blur(28px) saturate(150%);
  -webkit-backdrop-filter: blur(28px) saturate(150%);
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 64px;
  padding: 0 2rem;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--color-text-l);
}
.close-button,
.panel-control,
.panel-play {
  display: grid;
  place-items: center;
  border: 0;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    background-color 0.18s ease,
    opacity 0.18s ease;
}
.close-button {
  width: 2.25rem;
  height: 2.25rem;
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-text) 8%, transparent);
  border-radius: 999px;
}
.close-button:hover {
  transform: scale(1.08);
}
.panel-layout {
  display: grid;
  grid-template-columns: minmax(360px, 0.85fr) minmax(0, 1.15fr);
  height: calc(100% - 64px);
}
.panel-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1.5rem;
  padding: 2rem clamp(2rem, 6vw, 7rem);
  border-right: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
}
.panel-cover {
  display: grid;
  width: min(320px, 32vw);
  aspect-ratio: 1;
  place-items: center;
  color: white;
  background: linear-gradient(
    135deg,
    var(--color-primary),
    color-mix(in srgb, var(--color-primary) 38%, #8b5cf6)
  );
  border-radius: 2rem;
  box-shadow: 0 18px 35px color-mix(in srgb, var(--color-primary) 38%, transparent);
}
.panel-cover.is-playing {
  animation: breathe 2.5s ease-in-out infinite;
}
.panel-cover img {
  border-radius: inherit;
}
.audio-details {
  display: grid;
  width: min(440px, 100%);
  grid-template-columns: repeat(5, minmax(0, 1fr));
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
  border-radius: 0.85rem;
  background: color-mix(in srgb, var(--color-text) 4%, transparent);
}
.audio-details div {
  min-width: 0;
  padding: 0.55rem 0.35rem;
  text-align: center;
}
.audio-details dt {
  overflow: hidden;
  color: var(--color-text-l);
  font-size: 0.65rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.audio-details dd {
  margin: 0.2rem 0 0;
  overflow: hidden;
  color: var(--color-text);
  font-size: 0.72rem;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.progress-block {
  width: min(440px, 100%);
}
.panel-range {
  --range-progress: 0%;
  width: 100%;
  height: 5px;
  appearance: none;
  cursor: pointer;
  border-radius: 99px;
  background: linear-gradient(
    to right,
    var(--color-primary) var(--range-progress),
    color-mix(in srgb, var(--color-text) 15%, transparent) var(--range-progress)
  );
}
.panel-range::-webkit-slider-thumb {
  width: 13px;
  height: 13px;
  appearance: none;
  background: var(--color-primary);
  border: 2px solid var(--color-bg);
  border-radius: 50%;
}
.panel-range:disabled {
  cursor: default;
  opacity: 0.45;
}
.panel-controls {
  display: flex;
  align-items: center;
  gap: 1.75rem;
}
.panel-control {
  width: 3rem;
  height: 3rem;
  color: var(--color-text);
  background: transparent;
  border-radius: 50%;
}
.panel-control:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}
.panel-play {
  width: 4.25rem;
  height: 4.25rem;
  color: white;
  background: var(--color-primary);
  border-radius: 50%;
  box-shadow: 0 7px 20px color-mix(in srgb, var(--color-primary) 45%, transparent);
}
.panel-play:not(:disabled):hover {
  transform: scale(1.07);
}
.panel-play:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  box-shadow: none;
}
.lyrics-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
  padding: 2rem clamp(2rem, 6vw, 7rem);
}
.lyrics-label {
  margin: 0;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  color: var(--color-text-l);
}
.lyrics-placeholder {
  display: grid;
  flex: 1;
  place-content: center;
  gap: 0.75rem;
  text-align: center;
  color: var(--color-text-l);
}
.lyrics-placeholder svg {
  margin: 0 auto;
  color: var(--color-primary);
}
.lyrics-placeholder p {
  margin: 0;
  color: var(--color-text);
  font-size: 1.1rem;
  font-weight: 600;
}
.lyrics-placeholder span {
  font-size: 0.85rem;
}
@keyframes breathe {
  50% {
    transform: scale(1.03);
    box-shadow: 0 22px 42px color-mix(in srgb, var(--color-primary) 55%, transparent);
  }
}
@media (max-width: 760px) {
  .panel-header {
    padding: 0 1rem;
  }
  .panel-layout {
    grid-template-columns: 1fr;
    overflow: auto;
  }
  .panel-content {
    padding: 1.5rem;
    border-right: 0;
  }
  .panel-cover {
    width: min(260px, 62vw);
  }
  .audio-details {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
  .lyrics-panel {
    min-height: 250px;
    padding: 1.5rem;
    border-top: 1px solid color-mix(in srgb, var(--color-text) 10%, transparent);
  }
}
@media (max-height: 700px) and (min-width: 761px) {
  .panel-content {
    gap: 1rem;
    padding-bottom: 1.5rem;
  }
  .panel-cover {
    width: min(205px, 44vh);
  }
}
</style>
