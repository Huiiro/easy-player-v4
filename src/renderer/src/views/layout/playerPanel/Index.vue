<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { useI18n } from 'vue-i18n'

const ui = useUIStore()
const player = usePlayerStore()
const { t } = useI18n()
const trackTitle = computed(
  () =>
    player.trackInfo?.metadata?.title || player.currentQueueSong?.title || t('playerPanel.noTrack')
)
const trackArtist = computed(
  () =>
    player.trackInfo?.metadata?.artist ||
    player.currentQueueSong?.artist ||
    t('playerPanel.defaultArtist')
)
const coverFailed = ref(false)
const coverUrl = computed(() => {
  const cover = player.currentQueueSong?.cover
  return cover ? `easy-player-media://cover?path=${encodeURIComponent(cover)}` : null
})
const audioDetails = computed(() => {
  const info = player.trackInfo
  if (!info) return []
  const channels =
    info.channels === 1
      ? t('playerPanel.mono')
      : info.channels === 2
        ? t('playerPanel.stereo')
        : t('playerPanel.channels', { count: info.channels })
  return [
    [
      t('playerPanel.format'),
      info.format?.toUpperCase() || info.codecName || t('playerPanel.unavailable')
    ],
    [
      t('playerPanel.sampleRate'),
      info.sampleRate
        ? `${info.sampleRate / 1000} ${t('playerPanel.kilohertz')}`
        : t('playerPanel.unavailable')
    ],
    [
      t('playerPanel.bitDepth'),
      info.bitDepth ? `${info.bitDepth} ${t('playerPanel.bit')}` : t('playerPanel.unavailable')
    ],
    [t('playerPanel.channel'), channels],
    [
      t('playerPanel.bitrate'),
      info.bitrateKbps
        ? `${info.bitrateKbps} ${t('playerPanel.kilobitsPerSecond')}`
        : t('playerPanel.unavailable')
    ]
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
  <div class="fixed inset-0 z-40 bg-bg/80 text-text-l backdrop-blur-2xl">
    <section
      class="size-full overflow-hidden bg-bg/80 shadow-[inset_0_1px_0_rgb(255_255_255_/_18%)]"
      :aria-label="t('playerPanel.label')"
    >
      <header
        class="flex h-16 items-center justify-between px-8 text-xs font-semibold tracking-[0.08em] max-[760px]:px-4"
      >
        <span>{{ t('playerPanel.nowPlaying') }}</span>
        <button
          class="grid size-9 place-items-center rounded-full bg-text/[0.08] text-text transition hover:scale-105"
          :title="t('playerPanel.close')"
          :aria-label="t('playerPanel.close')"
          @click="close"
        >
          <SvgIcon name="common-close" class-name="size-5" />
        </button>
      </header>

      <div
        class="grid h-[calc(100%_-_64px)] grid-cols-[minmax(360px,0.85fr)_minmax(0,1.15fr)] max-[760px]:h-[calc(100%_-_64px)] max-[760px]:grid-cols-1 max-[760px]:overflow-auto"
      >
        <section
          class="flex flex-col items-center justify-center gap-6 border-r border-text/10 px-[clamp(2rem,6vw,7rem)] py-8 max-[760px]:border-r-0 max-[760px]:px-6 max-[760px]:py-6 max-[700px]:gap-4"
        >
          <div
            class="grid aspect-square w-[min(320px,32vw)] place-items-center overflow-hidden rounded-[2rem] bg-gradient-to-br from-primary to-violet-500 text-white shadow-[0_18px_35px_color-mix(in_srgb,var(--color-primary)_38%,transparent)] max-[760px]:w-[min(260px,62vw)] max-[700px]:w-[min(205px,44vh)]"
          >
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
            <h2 class="truncate text-xl font-bold text-text">{{ trackTitle }}</h2>
            <p class="mt-1 truncate text-sm text-text-l">{{ trackArtist }}</p>
          </div>
          <dl
            v-if="audioDetails.length"
            class="grid w-[min(440px,100%)] grid-cols-5 overflow-hidden rounded-xl border border-text/10 bg-text/5 max-[760px]:grid-cols-3"
          >
            <div
              v-for="[label, value] in audioDetails"
              :key="label"
              class="min-w-0 px-1.5 py-2 text-center"
            >
              <dt class="truncate text-[0.65rem] text-text-l">{{ label }}</dt>
              <dd class="mt-1 truncate text-xs font-semibold text-text">{{ value }}</dd>
            </div>
          </dl>
          <div class="w-[min(440px,100%)]">
            <input
              class="h-2 w-full cursor-pointer appearance-auto accent-primary disabled:cursor-default disabled:opacity-45"
              type="range"
              min="0"
              :max="player.durationMs || 0"
              :value="player.positionMs"
              :disabled="!player.durationMs"
              :aria-label="t('playerPanel.progress')"
              @input="seek"
            />
            <div class="flex justify-between text-xs tabular-nums text-text-l">
              <span>{{ player.positionFormatted }}</span
              ><span>{{ player.durationFormatted }}</span>
            </div>
          </div>
          <div class="flex items-center gap-7">
            <button
              class="grid size-12 place-items-center rounded-full text-text transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
              :disabled="!player.queue.length"
              :title="t('playerPanel.previous')"
              @click="playPrevious"
            >
              <SvgIcon name="play-prev" class-name="size-6" />
            </button>
            <button
              class="grid size-[4.25rem] place-items-center rounded-full bg-primary text-white shadow-[0_7px_20px_color-mix(in_srgb,var(--color-primary)_45%,transparent)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
              :disabled="!player.currentFile"
              :title="player.isPlaying ? t('playerPanel.pause') : t('playerPanel.play')"
              @click="togglePlayback"
            >
              <SvgIcon :name="player.isPlaying ? 'play-pause' : 'play-play'" class-name="size-8" />
            </button>
            <button
              class="grid size-12 place-items-center rounded-full text-text transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
              :disabled="!player.queue.length"
              :title="t('playerPanel.next')"
              @click="playNext"
            >
              <SvgIcon name="play-next" class-name="size-6" />
            </button>
          </div>
        </section>

        <section
          class="flex min-w-0 flex-col px-[clamp(2rem,6vw,7rem)] py-8 max-[760px]:min-h-[250px] max-[760px]:border-t max-[760px]:border-text/10 max-[760px]:px-6 max-[760px]:py-6"
          :aria-label="t('playerPanel.lyrics')"
        >
          <p class="text-xs font-semibold tracking-[0.08em] text-text-l">
            {{ t('playerPanel.lyrics') }}
          </p>
          <div class="grid flex-1 place-content-center gap-3 text-center text-text-l">
            <SvgIcon name="common-lyrics" class-name="mx-auto size-8 text-primary" />
            <p class="text-lg font-semibold text-text">{{ t('playerPanel.noLyrics') }}</p>
            <span class="text-sm">{{ t('playerPanel.lyricsHint') }}</span>
          </div>
        </section>
      </div>
    </section>
  </div>
</template>
