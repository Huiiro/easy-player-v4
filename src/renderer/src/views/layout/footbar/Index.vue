<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { PlayMode } from '@/consts'
import BaseDrawer from '@/components/ui/BaseDrawer.vue'
import BaseDialog from '@/components/ui/BaseDialog.vue'
import PlayQueue from '@/components/player/PlayQueue.vue'
import AudioControlPanel from '@/components/player/AudioControlPanel.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import SvgIcon from '@/components/svg/SvgIcon.vue'

const ui = useUIStore()
const player = usePlayerStore()
const { t } = useI18n()
const collapsed = ref(false)
const queueVisible = ref(false)
const audioControlsVisible = ref(false)
let audioControlsLoaded = false

const trackTitle = computed(
  () => player.trackInfo?.metadata?.title || player.currentQueueSong?.title || '未选择音乐'
)
const trackArtist = computed(
  () => player.trackInfo?.metadata?.artist || player.currentQueueSong?.artist || 'Easy Player'
)
const coverFailed = ref(false)
const coverUrl = computed(() => {
  const cover = player.currentQueueSong?.cover
  return cover ? `easy-player-media://cover?path=${encodeURIComponent(cover)}` : null
})
const audioSummary = computed(() => {
  const info = player.trackInfo
  if (!info) return ''
  const parts = [
    info.format?.toUpperCase(),
    info.sampleRate ? `${info.sampleRate / 1000} kHz` : '',
    info.bitDepth ? `${info.bitDepth} bit` : ''
  ]
  return parts.filter(Boolean).join(' · ')
})
watch(coverUrl, () => {
  coverFailed.value = false
})
const progressPercent = computed(() => `${Math.round(player.progress * 100)}%`)
const volumePercent = computed(() => `${Math.round(player.volume * 100)}%`)
const playModeIcon = computed(() => {
  const icons: Record<PlayMode, string> = {
    [PlayMode.Sequential]: 'control-order',
    [PlayMode.List]: 'control-loop',
    [PlayMode.Single]: 'control-single',
    [PlayMode.Random]: 'control-shuffle'
  }
  return icons[player.playMode]
})
const playModeLabel = computed(() => {
  const labels: Record<PlayMode, string> = {
    [PlayMode.Sequential]: 'queue.sequential',
    [PlayMode.List]: 'queue.list',
    [PlayMode.Single]: 'queue.single',
    [PlayMode.Random]: 'queue.random'
  }
  return t(labels[player.playMode])
})

function togglePlayback(): void {
  if (player.isPlaying) {
    void player.pause()
    return
  }
  if (player.currentFile) void player.play()
}

function playPrevious(): void {
  void player.playPrevious()
}

function playNext(): void {
  void player.playNext()
}

function cyclePlayMode(): void {
  player.setPlayMode(((player.playMode + 1) % 4) as PlayMode)
}

function seek(event: Event): void {
  void player.seek(Number((event.target as HTMLInputElement).value))
}

function setVolume(event: Event): void {
  void player.setVolume(Number((event.target as HTMLInputElement).value) / 100)
}

function openPlayerPanel(): void {
  ui.showPlayer = true
}

function toggleCollapsed(): void {
  collapsed.value = !collapsed.value
}
async function openAudioControls(): Promise<void> {
  audioControlsVisible.value = true
  if (audioControlsLoaded) return
  audioControlsLoaded = true
  await Promise.all([
    player.loadEqBands(),
    player.loadDspNodes(),
    player.loadCompressorConfig(),
    player.loadDelayConfig(),
    player.loadReverbConfig(),
    player.loadChorusConfig(),
    player.loadNoiseGateConfig(),
    player.loadPhaserConfig(),
    player.loadResamplerConfig(),
    player.loadChannelMatrixConfig(),
    player.loadLimiter(),
    player.loadReplayGain(),
    player.loadPlaybackSpeed(),
    player.loadDopEnabled(),
    player.loadTransitionConfig(),
    player.refreshAudioChain(),
    player.refreshDevices(),
    player.loadOutputDeviceSettings()
  ])
}
</script>

<template>
  <div class="footbar-shell px-4 pb-4 pt-2" :class="{ 'is-card-mode': ui.useCardView }">
    <section
      class="footbar-dock"
      :class="{ 'is-collapsed': collapsed }"
      aria-label="播放器控制栏，点击打开播放器面板"
      @click="openPlayerPanel"
    >
      <div class="track-info">
        <div class="cover-art" :class="{ 'is-playing': player.isPlaying }">
          <img
            v-if="coverUrl && !coverFailed"
            :src="coverUrl"
            class="size-full object-cover"
            :alt="trackTitle"
            @error="coverFailed = true"
          />
          <SvgIcon v-else name="common-music" class-name="size-6" />
        </div>
        <div class="min-w-0">
          <p class="truncate text-sm font-semibold text-[var(--color-text)]">{{ trackTitle }}</p>
          <p class="truncate text-xs text-[var(--color-text-l)]">{{ trackArtist }}</p>
          <p
            v-if="!collapsed && audioSummary"
            class="truncate text-[10px] text-[var(--color-text-l)]"
          >
            {{ audioSummary }}
          </p>
        </div>
      </div>

      <div v-if="!collapsed" class="player-controls">
        <div class="flex items-center justify-center gap-1.5">
          <button
            class="control-button"
            title="上一首"
            :disabled="!player.queue.length"
            @click.stop="playPrevious"
          >
            <SvgIcon name="play-prev" class-name="size-4" />
          </button>
          <button
            class="play-button"
            :disabled="!player.currentFile"
            :title="player.isPlaying ? '暂停' : '播放'"
            @click.stop="togglePlayback"
          >
            <SvgIcon :name="player.isPlaying ? 'play-pause' : 'play-play'" class-name="size-5" />
          </button>
          <button
            class="control-button"
            title="下一首"
            :disabled="!player.queue.length"
            @click.stop="playNext"
          >
            <SvgIcon name="play-next" class-name="size-4" />
          </button>
        </div>
        <div class="flex items-center gap-2 text-[11px] tabular-nums text-[var(--color-text-l)]">
          <span>{{ player.positionFormatted }}</span>
          <input
            class="dock-range progress-range"
            type="range"
            min="0"
            :max="player.durationMs || 0"
            :value="player.positionMs"
            :style="{ '--range-progress': progressPercent }"
            :disabled="!player.durationMs"
            aria-label="播放进度"
            @click.stop
            @input="seek"
          />
          <span>{{ player.durationFormatted }}</span>
        </div>
      </div>

      <div v-if="!collapsed" class="volume-control">
        <button class="control-button" :title="playModeLabel" @click.stop="cyclePlayMode">
          <SvgIcon :name="playModeIcon" class-name="size-4" />
        </button>
        <SvgIcon
          :name="player.volume === 0 ? 'volume-volume-mute' : 'volume-volume-high'"
          class-name="size-5"
        />
        <input
          class="dock-range volume-range"
          type="range"
          min="0"
          max="100"
          :value="Math.round(player.volume * 100)"
          :style="{ '--range-progress': volumePercent }"
          aria-label="音量"
          @click.stop
          @input="setVolume"
        />
        <button class="control-button" :title="t('queue.title')" @click.stop="queueVisible = true">
          <SvgIcon name="control-playlist" class-name="size-4" />
        </button>
        <button class="control-button" title="音频控制" @click.stop="openAudioControls">
          <SvgIcon name="common-equalizer" class-name="size-4" />
        </button>
      </div>

      <button
        class="collapse-button"
        :title="collapsed ? '展开控制栏' : '收起控制栏'"
        :aria-label="collapsed ? '展开控制栏' : '收起控制栏'"
        @click.stop="toggleCollapsed"
      >
        <SvgIcon :name="collapsed ? 'arrow-arrow-up' : 'arrow-arrow-down'" class-name="size-4" />
      </button>
    </section>
    <BaseDrawer
      v-model="queueVisible"
      class="pointer-events-auto"
      :title="t('queue.title')"
      direction="right"
      width="26rem"
    >
      <PlayQueue />
    </BaseDrawer>
    <BaseDialog
      v-model="audioControlsVisible"
      class="pointer-events-auto"
      title="音频控制"
      width="max-w-6xl"
    >
      <AudioControlPanel class="h-[72vh]" />
    </BaseDialog>
  </div>
</template>

<style scoped>
.footbar-shell {
  pointer-events: none;
  background: linear-gradient(
    to top,
    color-mix(in srgb, var(--color-bg) 28%, transparent),
    transparent
  );
}
.footbar-dock {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(270px, 1.2fr) minmax(0, 1fr) auto;
  align-items: center;
  gap: 1.5rem;
  min-height: 72px;
  max-width: 1160px;
  margin: 0 auto;
  padding: 0.625rem 1rem;
  color: var(--color-text-l);
  background: color-mix(in srgb, var(--color-bg) 72%, transparent);
  border: 1px solid color-mix(in srgb, var(--color-text) 14%, transparent);
  border-radius: 1.5rem;
  box-shadow:
    0 12px 35px color-mix(in srgb, #000 20%, transparent),
    inset 0 1px 0 color-mix(in srgb, #fff 22%, transparent);
  backdrop-filter: blur(22px) saturate(145%);
  -webkit-backdrop-filter: blur(22px) saturate(145%);
  pointer-events: auto;
  transition:
    max-width 0.32s cubic-bezier(0.34, 1.56, 0.64, 1),
    min-height 0.32s cubic-bezier(0.34, 1.56, 0.64, 1),
    padding 0.25s cubic-bezier(0.34, 1.3, 0.64, 1),
    gap 0.25s ease;
}
.track-info,
.volume-control {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  min-width: 0;
}
.volume-control {
  justify-content: flex-end;
}
.collapse-button {
  display: grid;
  width: 2rem;
  height: 2rem;
  place-items: center;
  color: var(--color-text-l);
  background: color-mix(in srgb, var(--color-text) 7%, transparent);
  border: 0;
  border-radius: 999px;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    background-color 0.18s ease;
}
.collapse-button:hover {
  color: var(--color-text);
  background: color-mix(in srgb, var(--color-text) 13%, transparent);
  transform: scale(1.08);
}
.footbar-dock.is-collapsed {
  grid-template-columns: minmax(0, 1fr) auto;
  min-height: 62px;
  max-width: 410px;
  gap: 0.75rem;
}
.cover-art {
  display: grid;
  flex: 0 0 auto;
  width: 3.1rem;
  height: 3.1rem;
  place-items: center;
  color: white;
  background: linear-gradient(
    135deg,
    var(--color-primary),
    color-mix(in srgb, var(--color-primary) 45%, #8b5cf6)
  );
  border-radius: 0.9rem;
  box-shadow: 0 5px 14px color-mix(in srgb, var(--color-primary) 35%, transparent);
}
.cover-art.is-playing {
  animation: cover-breathe 2.5s ease-in-out infinite;
}
.player-controls {
  display: grid;
  gap: 0.25rem;
}
.control-button,
.play-button {
  display: grid;
  place-items: center;
  border: 0;
  cursor: pointer;
  transition:
    transform 0.18s ease,
    background-color 0.18s ease,
    opacity 0.18s ease;
}
.control-button {
  width: 2rem;
  height: 2rem;
  color: var(--color-text);
  background: transparent;
  border-radius: 999px;
}
.control-button:not(:disabled):hover {
  background: color-mix(in srgb, var(--color-text) 10%, transparent);
  transform: scale(1.06);
}
.control-button:disabled {
  cursor: not-allowed;
  opacity: 0.35;
}
.play-button {
  width: 2.45rem;
  height: 2.45rem;
  color: white;
  background: var(--color-primary);
  border-radius: 999px;
  box-shadow: 0 4px 12px color-mix(in srgb, var(--color-primary) 45%, transparent);
}
.play-button:not(:disabled):hover {
  transform: scale(1.08);
}
.play-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  box-shadow: none;
}
.dock-range {
  --range-progress: 0%;
  width: 100%;
  height: 4px;
  appearance: none;
  cursor: pointer;
  border-radius: 999px;
  background: linear-gradient(
    to right,
    var(--color-primary) var(--range-progress),
    color-mix(in srgb, var(--color-text) 15%, transparent) var(--range-progress)
  );
}
.dock-range::-webkit-slider-thumb {
  width: 11px;
  height: 11px;
  appearance: none;
  background: var(--color-primary);
  border: 2px solid color-mix(in srgb, var(--color-bg) 85%, white);
  border-radius: 999px;
  box-shadow: 0 1px 4px rgb(0 0 0 / 22%);
}
.dock-range:disabled {
  cursor: default;
  opacity: 0.45;
}
.volume-range {
  max-width: 100px;
}
@keyframes cover-breathe {
  50% {
    transform: scale(1.045);
    box-shadow: 0 7px 20px color-mix(in srgb, var(--color-primary) 55%, transparent);
  }
}
@media (max-width: 700px) {
  .footbar-shell {
    padding: 0.5rem 0.75rem 0.75rem;
  }
  .footbar-dock {
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 0.65rem;
    padding: 0.55rem 0.7rem;
  }
  .volume-control {
    display: none;
  }
  .footbar-dock.is-collapsed {
    grid-template-columns: minmax(0, 1fr) auto;
  }
  .track-info p {
    max-width: 120px;
  }
}
</style>
