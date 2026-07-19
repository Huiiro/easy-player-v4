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

const trackTitle = computed(
  () => player.trackInfo?.metadata?.title || player.currentQueueSong?.title || t('footer.noTrack')
)
const trackArtist = computed(
  () =>
    player.trackInfo?.metadata?.artist ||
    player.currentQueueSong?.artist ||
    t('footer.defaultArtist')
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
    info.sampleRate ? `${info.sampleRate / 1000} ${t('footer.kilohertz')}` : '',
    info.bitDepth ? `${info.bitDepth} ${t('footer.bitDepth')}` : ''
  ]
  return parts.filter(Boolean).join(' · ')
})
watch(coverUrl, () => {
  coverFailed.value = false
})
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

function changeVolume(event: WheelEvent): void {
  event.preventDefault()
  void player.setVolume(Math.max(0, Math.min(1, player.volume + (event.deltaY < 0 ? 0.05 : -0.05))))
}

function openPlayerPanel(): void {
  ui.showPlayer = true
}

function toggleCollapsed(): void {
  collapsed.value = !collapsed.value
}

function openAudioControls(): void {
  audioControlsVisible.value = true
}

function openDesktopLyrics(): void {
  ui.useDesktopLyrics = !ui.useDesktopLyrics
}
</script>

<template>
  <div
    class="pointer-events-none bg-gradient-to-t from-bg/30 px-4 pb-4 pt-2 max-[700px]:px-3 max-[700px]:pb-3"
  >
    <section
      class="pointer-events-auto mx-auto grid min-h-[72px] max-w-6xl items-center gap-6 rounded-3xl border border-text/10 bg-bg/75 px-4 py-2.5 text-text-l shadow-[0_12px_35px_rgb(0_0_0_/_20%)] backdrop-blur-2xl transition-all duration-300 max-[700px]:grid-cols-[auto_minmax(0,1fr)_auto] max-[700px]:gap-2.5 max-[700px]:px-3 max-[700px]:py-2"
      :class="
        collapsed
          ? 'grid-cols-[minmax(0,1fr)_auto] min-h-[62px] max-w-md gap-3'
          : 'grid-cols-[minmax(0,1fr)_minmax(270px,1.2fr)_minmax(0,1fr)_auto]'
      "
      :aria-label="t('footer.playerControls')"
      @click="openPlayerPanel"
    >
      <div class="flex min-w-0 items-center gap-3">
        <div
          class="grid size-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br from-primary to-violet-500 text-white shadow-[0_5px_14px_color-mix(in_srgb,var(--color-primary)_35%,transparent)]"
        >
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
          <p class="truncate text-sm font-semibold text-text">{{ trackTitle }}</p>
          <p class="truncate text-xs text-text-l">{{ trackArtist }}</p>
          <p v-if="!collapsed && audioSummary" class="truncate text-[10px] text-text-l">
            {{ audioSummary }}
          </p>
        </div>
      </div>

      <div v-if="!collapsed" class="grid gap-1 max-[700px]:hidden">
        <div class="flex items-center justify-center gap-1.5">
          <button
            class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10 disabled:cursor-not-allowed disabled:opacity-35"
            :title="t('footer.previous')"
            :disabled="!player.queue.length"
            @click.stop="playPrevious"
          >
            <SvgIcon name="play-prev" class-name="size-4" />
          </button>
          <button
            class="grid size-10 place-items-center rounded-full bg-primary text-white shadow-[0_4px_12px_color-mix(in_srgb,var(--color-primary)_45%,transparent)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
            :disabled="!player.currentFile"
            :title="player.isPlaying ? t('footer.pause') : t('footer.play')"
            @click.stop="togglePlayback"
          >
            <SvgIcon :name="player.isPlaying ? 'play-pause' : 'play-play'" class-name="size-5" />
          </button>
          <button
            class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10 disabled:cursor-not-allowed disabled:opacity-35"
            :title="t('footer.next')"
            :disabled="!player.queue.length"
            @click.stop="playNext"
          >
            <SvgIcon name="play-next" class-name="size-4" />
          </button>
        </div>
        <div class="flex items-center gap-2 text-[11px] tabular-nums text-text-l">
          <span>{{ player.positionFormatted }}</span>
          <input
            class="h-2 w-full cursor-pointer appearance-auto accent-primary disabled:cursor-default disabled:opacity-45"
            type="range"
            min="0"
            :max="player.durationMs || 0"
            :value="player.positionMs"
            :disabled="!player.durationMs"
            :aria-label="t('footer.progress')"
            @click.stop
            @input="seek"
          />
          <span>{{ player.durationFormatted }}</span>
        </div>
      </div>
      <div v-if="!collapsed" class="flex min-w-0 items-center justify-end gap-2 max-[700px]:hidden">
        <div
          class="group relative"
          :title="t('footer.volumeValue', { value: Math.round(player.volume * 100) })"
          @click.stop
          @wheel="changeVolume"
        >
          <button
            class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10"
            type="button"
            :aria-label="t('footer.volumeValue', { value: Math.round(player.volume * 100) })"
          >
            <SvgIcon
              :name="player.volume === 0 ? 'volume-volume-mute' : 'volume-volume-high'"
              class-name="size-5"
            />
          </button>
          <div
            class="pointer-events-none absolute bottom-10 left-1/2 z-30 flex h-40 w-10 -translate-x-1/2 flex-col items-center gap-1 rounded-lg bg-[#090c11]/90 px-1 py-2 text-xs opacity-0 shadow-xl backdrop-blur-md transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100"
          >
            <b class="tabular-nums text-text">{{ Math.round(player.volume * 100) }}%</b>
            <input
              class="absolute left-1/2 top-[5.5rem] h-1.5 w-28 -translate-x-1/2 -rotate-90 cursor-pointer accent-primary"
              type="range"
              min="0"
              max="100"
              step="5"
              :value="Math.round(player.volume * 100)"
              :aria-label="t('footer.volume')"
              @input="setVolume"
            />
          </div>
        </div>
        <button
          class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10"
          :title="playModeLabel"
          @click.stop="cyclePlayMode"
        >
          <SvgIcon :name="playModeIcon" class-name="size-5" />
        </button>
        <button
          class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10"
          :title="t('queue.title')"
          @click.stop="queueVisible = true"
        >
          <SvgIcon name="control-playlist" class-name="size-5" />
        </button>
        <button
          class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10"
          :title="t('footer.audioControls')"
          @click.stop="openAudioControls"
        >
          <SvgIcon name="common-equalizer" class-name="size-4" />
        </button>
        <!-- todo -->
        <button
          class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10"
          :title="t('footer.desktopLyrics')"
          @click.stop="openDesktopLyrics"
        >
          <SvgIcon name="common-lyrics2" class-name="size-5" />
        </button>
        <!-- todo -->
        <button
          class="grid size-8 place-items-center rounded-full text-text transition hover:scale-105 hover:bg-text/10"
          :title="t('footer.more')"
          @click.stop="openMoreMenu"
        >
          <SvgIcon name="menu-more-vertical" class-name="size-5" />
        </button>
      </div>

      <button
        class="grid size-8 place-items-center rounded-full bg-text/[0.07] text-text-l transition hover:scale-105 hover:bg-text/[0.13] hover:text-text"
        :title="collapsed ? t('footer.expand') : t('footer.collapse')"
        :aria-label="collapsed ? t('footer.expand') : t('footer.collapse')"
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
      :title="t('footer.audioControls')"
      width="max-w-6xl"
    >
      <AudioControlPanel class="h-[72vh]" />
    </BaseDialog>
  </div>
</template>
