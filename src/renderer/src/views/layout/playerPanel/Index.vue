<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import { useI18n } from 'vue-i18n'
import { PlayerBgType } from '@/consts'
import { PlayMode } from '@/consts'
import PlayerLyrics from '@/components/lyrics/PlayerLyrics.vue'
import LyricsManagerDialog from '@/components/lyrics/LyricsManagerDialog.vue'
import PlayQueueDrawer from '@/components/player/PlayQueueDrawer.vue'
import PlayerSpectrum from '@/components/player/PlayerSpectrum.vue'

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
const showSpectrum = ref(false)
const showQueue = ref(false)
const showLyricsManager = ref(false)
const lyricReloadToken = ref(0)
const progressStyle = ref<'thin' | 'thick'>('thin')
const collapsed = ref(false)
let collapseTriggeredByPointer = false
const playModeIcon = computed(
  () => ['control-order', 'control-loop', 'control-single', 'control-shuffle'][player.playMode]
)
const playModeLabel = computed(() =>
  t(['queue.sequential', 'queue.list', 'queue.single', 'queue.random'][player.playMode])
)
const lyricsStyleLabel = computed(() =>
  t(`playerPanel.lyricEffect${ui.lyricsStyle[0].toUpperCase()}${ui.lyricsStyle.slice(1)}`)
)
const coverUrl = computed(() => {
  const cover = player.currentQueueSong?.cover
  return cover ? `easy-player-media://cover?path=${encodeURIComponent(cover)}` : null
})
const targetRhythmAmount = computed(() => {
  if (
    !player.isPlaying ||
    !player.rhythmVisualConfig.enabled ||
    player.rhythmVisualConfig.reducedMotion
  )
    return 0
  const { rms, lowEnergy, onsetStrength } = player.audioAnalysis
  const energy = Math.max(0, Math.min(1, Math.max(rms, lowEnergy, onsetStrength)))
  return Math.min(1, energy * player.rhythmVisualConfig.intensity * 1.8)
})
const rhythmAmount = ref(0)
let lastVisualUpdateAt = 0

watch(
  targetRhythmAmount,
  (target) => {
    if (target === 0) {
      rhythmAmount.value = 0
      return
    }

    const now = performance.now()
    if (now - lastVisualUpdateAt < 1000 / 30) return
    lastVisualUpdateAt = now
    rhythmAmount.value += (target - rhythmAmount.value) * 0.72
  },
  { immediate: true }
)
// `DEFAULT` was the old persisted value before the album-art setting existed.
// Treat it as album artwork so existing users receive the new default immediately.
const useAlbumArtwork = computed(
  () => ui.playerBgType === PlayerBgType.ALBUM || ui.playerBgType === PlayerBgType.DEFAULT
)
const backgroundSource = computed(() => {
  if (useAlbumArtwork.value && coverUrl.value && !coverFailed.value) return coverUrl.value
  if (ui.playerBgType === PlayerBgType.CUSTOM && ui.customBg.url) return ui.customBg.url
  return null
})
const backgroundStyle = computed(() => ({
  transform: `scale(${1.1 + rhythmAmount.value * 0.1})`
}))
const coverColors = ref({ primary: '77 136 220', secondary: '205 78 165' })
const glowStyle = computed(() => ({
  transform: `scale(${1 + rhythmAmount.value * 0.62})`,
  opacity: String(0.68 + rhythmAmount.value * 0.32),
  '--cover-primary': `rgb(${coverColors.value.primary} / 58%)`,
  '--cover-secondary': `rgb(${coverColors.value.secondary} / 52%)`
}))
const coverGlowStyle = computed(() => ({
  transform: `scale(${1 + rhythmAmount.value * 0.5})`,
  opacity: String(0.62 + rhythmAmount.value * 0.38),
  '--cover-primary-solid': `rgb(${coverColors.value.primary})`,
  '--cover-secondary-solid': `rgb(${coverColors.value.secondary})`
}))

const coverFrameStyle = computed(() => ({
  transform: `scale(${1 + rhythmAmount.value * 0.085})`,
  filter: `brightness(${1 + rhythmAmount.value * 0.12})`
}))
const coverCardStyle = computed(() => {
  const energy = rhythmAmount.value
  const primary = coverColors.value.primary

  return {
    '--cover-shadow-rgb': primary,
    boxShadow: `0 ${18 + energy * 10}px ${35 + energy * 28}px rgb(${primary} / ${0.3 + energy * 0.38})`
  }
})
const shouldAnimate = computed(
  () =>
    player.isPlaying &&
    player.rhythmVisualConfig.enabled &&
    !player.rhythmVisualConfig.reducedMotion
)
const beatRingRef = ref<HTMLElement>()

function restartBeatRing(): void {
  const ring = beatRingRef.value
  if (!ring || !shouldAnimate.value) return
  ring.classList.remove('beat-ring--pulse')
  void ring.offsetWidth
  ring.classList.add('beat-ring--pulse')
}

watch(() => [player.audioAnalysis.beatSequence, shouldAnimate.value], restartBeatRing, {
  flush: 'post'
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
function toggleCollapsed(): void {
  collapsed.value = !collapsed.value
}
function handleCollapsePointerDown(event: PointerEvent): void {
  if (event.button !== 0) return
  event.preventDefault()
  collapseTriggeredByPointer = true
  toggleCollapsed()
}
function handleCollapseClick(): void {
  // Pointer input toggles on press; keyboard activation has no pointer event.
  if (collapseTriggeredByPointer) {
    collapseTriggeredByPointer = false
    return
  }
  toggleCollapsed()
}
function clearCollapsePointerTrigger(): void {
  requestAnimationFrame(() => {
    collapseTriggeredByPointer = false
  })
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
function seekTo(positionMs: number): void {
  void player.seek(positionMs)
}
function cyclePlayMode(): void {
  player.setPlayMode(((player.playMode + 1) % 4) as PlayMode)
}
function setSpeed(event: Event): void {
  player.playbackSpeedConfig.speed = Number((event.target as HTMLSelectElement).value)
  player.playbackSpeedConfig.enabled = player.playbackSpeedConfig.speed !== 1
  void player.setPlaybackSpeed()
}
function changeVolume(event: WheelEvent): void {
  event.preventDefault()
  void player.setVolume(Math.max(0, Math.min(1, player.volume + (event.deltaY < 0 ? 0.05 : -0.05))))
}
function changeLyricSize(event: WheelEvent): void {
  event.preventDefault()
  ui.setLyricsFontSize(
    Math.max(1.4, Math.min(4, ui.lyricsFontSize + (event.deltaY < 0 ? 0.1 : -0.1)))
  )
}
function changeLyricPadding(event: WheelEvent): void {
  event.preventDefault()
  ui.setLyricsFontPadding(
    Math.max(2, Math.min(80, ui.lyricsFontPadding + (event.deltaY < 0 ? 2 : -2)))
  )
}
function averageColor(
  data: Uint8ClampedArray,
  startX: number,
  endX: number,
  width: number
): string {
  let red = 0
  let green = 0
  let blue = 0
  let count = 0
  for (let y = 0; y < width; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const offset = (y * width + x) * 4
      const alpha = data[offset + 3] / 255
      red += data[offset] * alpha
      green += data[offset + 1] * alpha
      blue += data[offset + 2] * alpha
      count += alpha
    }
  }
  if (!count) return '77 136 220'
  return `${Math.round(red / count)} ${Math.round(green / count)} ${Math.round(blue / count)}`
}
function extractCoverColors(event: Event): void {
  const image = event.currentTarget as HTMLImageElement
  if (!image.naturalWidth || !image.naturalHeight) return
  try {
    const canvas = document.createElement('canvas')
    const size = 32
    canvas.width = size
    canvas.height = size
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return
    context.drawImage(image, 0, 0, size, size)
    const pixels = context.getImageData(0, 0, size, size).data
    coverColors.value = {
      primary: averageColor(pixels, 0, size / 2, size),
      secondary: averageColor(pixels, size / 2, size, size)
    }
  } catch {
    // Keep the neutral fallback colors for covers that cannot be sampled.
  }
}
</script>

<template>
  <div class="fixed inset-0 z-40 isolate overflow-hidden bg-[#101416] text-text-l select-none">
    <!-- Visuals live in one isolated full-screen layer. UI elements never create a backdrop above it. -->
    <div class="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      <Transition name="panel-background">
        <img
          v-if="backgroundSource"
          :key="backgroundSource"
          :src="backgroundSource"
          class="panel-background-item absolute -inset-10 size-[calc(100%_+_5rem)] max-w-none object-cover blur-[28px] transition-transform duration-150"
          :class="[
            useAlbumArtwork ? 'opacity-100' : 'opacity-0',
            shouldAnimate ? 'panel-cover--animated' : ''
          ]"
          :style="backgroundStyle"
          alt=""
          crossorigin="anonymous"
          @load="extractCoverColors"
          @error="coverFailed = true"
        />
      </Transition>
      <div
        class="absolute -left-[12%] -top-[16%] size-[58vw] max-h-[76vh] max-w-[76vh] rounded-full panel-orb panel-orb-primary"
        :class="shouldAnimate ? 'panel-orb--animated' : ''"
        :style="glowStyle"
      />
      <div
        class="absolute -bottom-[22%] -right-[13%] size-[62vw] max-h-[82vh] max-w-[82vh] rounded-full panel-orb panel-orb-secondary"
        :class="shouldAnimate ? 'panel-orb--animated panel-orb--delayed' : ''"
        :style="glowStyle"
      />
      <div
        class="absolute inset-0 panel-ambient"
        :class="[
          (ui.playerBgType as PlayerBgType) === PlayerBgType.AMBIENT ? 'opacity-100' : 'opacity-58',
          shouldAnimate ? 'panel-ambient--animated' : ''
        ]"
        :style="glowStyle"
      />
      <div
        v-if="shouldAnimate"
        ref="beatRingRef"
        class="absolute left-1/2 top-1/2 size-[min(78vw,78vh)] -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/15 beat-ring"
        :style="{ '--beat-strength': String(0.35 + rhythmAmount * 0.65) }"
      />
      <div class="absolute inset-0 panel-gradient" />
    </div>
    <!-- content -->
    <section
      class="relative z-10 size-full overflow-hidden bg-transparent"
      :aria-label="t('playerPanel.label')"
    >
      <!-- Floating controls do not occupy or paint a header band. -->
      <header
        class="pointer-events-none absolute inset-x-0 top-0 z-30 flex h-16 items-center justify-between bg-transparent px-5 text-xs font-semibold tracking-[0.08em] max-[760px]:px-4"
      >
        <button
          type="button"
          class="pointer-events-auto grid size-10 place-items-center rounded-full bg-text/[0.08] text-text transition hover:scale-105 [-webkit-app-region:no-drag]"
          :title="collapsed ? t('playerPanel.expandLyrics') : t('playerPanel.collapseLyrics')"
          :aria-expanded="!collapsed"
          @pointerdown="handleCollapsePointerDown"
          @pointerup="clearCollapsePointerTrigger"
          @pointercancel="clearCollapsePointerTrigger"
          @click="handleCollapseClick"
        >
          <SvgIcon
            :name="collapsed ? 'arrow-arrow-right-light' : 'arrow-arrow-left-light'"
            class-name="size-5 text-white"
          />
        </button>
        <button
          type="button"
          class="pointer-events-auto grid size-9 place-items-center rounded-full bg-text/[0.08] text-text transition hover:scale-105 [-webkit-app-region:no-drag]"
          :title="t('playerPanel.close')"
          :aria-label="t('playerPanel.close')"
          @click="close"
        >
          <SvgIcon name="common-close" class-name="size-5 text-white" />
        </button>
      </header>

      <div
        class="relative grid size-full overflow-hidden pt-16 max-[760px]:overflow-auto"
        :class="
          collapsed
            ? 'grid-cols-1'
            : 'grid-cols-[minmax(360px,0.85fr)_minmax(0,1.15fr)] max-[760px]:grid-cols-1'
        "
      >
        <!-- metadata & control -->
        <section
          class="panel-side flex flex-col items-center justify-center gap-5 px-[clamp(2rem,6vw,7rem)] py-8 max-[760px]:border-r-0 max-[760px]:px-6 max-[760px]:py-6 max-[700px]:gap-4"
          :class="collapsed && 'panel-side--collapsed'"
        >
          <!-- cover -->
          <div
            class="cover-frame relative w-[min(320px,32vw)] transition-[transform,filter] duration-100 max-[760px]:w-[min(260px,62vw)] max-[700px]:w-[min(205px,44vh)]"
            :style="coverFrameStyle"
          >
            <div
              class="pointer-events-none absolute -inset-10 rounded-[2.75rem] cover-aura"
              :class="shouldAnimate ? 'cover-aura--breathing' : ''"
              :style="coverGlowStyle"
            />
            <div
              class="cover-card relative grid aspect-square w-full place-items-center overflow-hidden rounded-[2rem] bg-gradient-to-br from-primary to-violet-500 text-white"
              :class="shouldAnimate ? 'cover-card--breathing' : ''"
              :style="coverCardStyle"
            >
              <img
                v-if="coverUrl && !coverFailed"
                :src="coverUrl"
                class="size-full object-cover"
                :alt="trackTitle"
                crossorigin="anonymous"
                @load="extractCoverColors"
                @error="coverFailed = true"
              />
              <SvgIcon v-else name="common-music" class-name="size-20" />
            </div>
          </div>
          <!-- title && artist -->
          <div class="min-w-0 text-center cursor-pointer">
            <h2
              class="max-w-[min(440px,72vw)] truncate text-2xl text-white font-bold"
              :title="trackTitle"
            >
              {{ trackTitle }}
            </h2>
            <p class="mt-1 truncate text-white/50">{{ trackArtist }}</p>
          </div>
          <!-- metadata -->
          <dl
            v-if="audioDetails.length"
            class="grid w-[min(440px,100%)] grid-cols-5 overflow-hidden rounded-xl bg-white/5 max-[760px]:grid-cols-3 cursor-default"
          >
            <div
              v-for="[label, value] in audioDetails"
              :key="label"
              class="min-w-0 px-1.5 py-2 text-center"
            >
              <dt class="truncate text-[0.65rem] text-white/50">{{ label }}</dt>
              <dd class="mt-1 truncate text-xs font-semibold text-white">{{ value }}</dd>
            </div>
          </dl>
          <!-- args control -->
          <div class="flex flex-wrap items-center justify-center gap-2 text-xs">
            <!-- volume -->
            <label
              class="panel-tool vertical-tool"
              :title="t('footer.volume')"
              @wheel="changeVolume"
            >
              <svg-icon name="volume-volume-high" class-name="w-[16px] h-[16px]" />
              <span class="vertical-popup">
                <b>{{ Math.round(player.volume * 100) }}%</b>
                <input
                  class="accent-primary"
                  type="range"
                  :value="player.volume * 100"
                  @input="player.setVolume(Number(($event.target as HTMLInputElement).value) / 100)"
                />
              </span>
            </label>
            <!-- speed -->
            <label class="panel-tool vertical-tool" :title="t('playerPanel.speed')">
              <svg-icon name="common-speed" class-name="w-[16px] h-[16px]" />
              <span class="vertical-popup">
                <b>{{ player.playbackSpeedConfig.speed.toFixed(2) }}×</b>
                <input
                  type="range"
                  class="accent-primary"
                  min="0.75"
                  max="2"
                  step="0.25"
                  :value="player.playbackSpeedConfig.speed"
                  @input="setSpeed($event)"
                />
              </span>
            </label>
            <!-- rhythm visuals -->
            <button
              class="panel-tool"
              :title="t('ap.rhythmVisuals')"
              :class="player.rhythmVisualConfig.enabled && 'active'"
              @click="player.rhythmVisualConfig.enabled = !player.rhythmVisualConfig.enabled"
            >
              <svg-icon name="common-beat" class-name="w-[16px] h-[16px]" />
            </button>
            <!-- rhythm spectrum -->
            <button
              class="panel-tool"
              :title="t('playerPanel.spectrum')"
              :class="showSpectrum && 'active'"
              @click="showSpectrum = !showSpectrum"
            >
              <svg-icon name="common-rhythm" class-name="w-[16px] h-[16px]" />
            </button>
            <!-- font size -->
            <label
              class="panel-tool vertical-tool"
              :title="t('playerPanel.lyricFontSize')"
              @wheel="changeLyricSize"
            >
              <span class="w-[16px] h-[16px] flex items-center justify-center">
                <svg-icon name="menu-font" class-name="w-[10px] h-[10px]" />
              </span>
              <span class="vertical-popup">
                <b>{{ ui.lyricsFontSize.toFixed(1) }}rem</b>
                <input
                  class="accent-primary"
                  type="range"
                  min="1.4"
                  max="4"
                  step="0.1"
                  :value="ui.lyricsFontSize"
                  @input="ui.setLyricsFontSize(Number(($event.target as HTMLInputElement).value))"
                />
              </span>
            </label>
            <!-- font padding -->
            <label
              class="panel-tool vertical-tool"
              :title="t('playerPanel.lyricSpacing')"
              @wheel="changeLyricPadding"
            >
              <span class="w-[16px] h-[16px] flex items-center justify-center">
                <svg-icon name="arrow-arrow-up-down" class-name="w-[12px] h-[12px]" />
              </span>
              <span class="vertical-popup">
                <b>{{ ui.lyricsFontPadding }}px</b>
                <input
                  class="accent-primary"
                  type="range"
                  min="2"
                  max="80"
                  step="2"
                  :value="ui.lyricsFontPadding"
                  @input="
                    ui.setLyricsFontPadding(Number(($event.target as HTMLInputElement).value))
                  "
                />
              </span>
            </label>
            <!-- lyrics align -->
            <button
              class="panel-tool"
              :title="
                t('playerPanel.lyricAlignment', {
                  alignment: t(
                    `playerPanel.align${ui.lyricsAlignment[0].toUpperCase()}${ui.lyricsAlignment.slice(1)}`
                  )
                })
              "
              @click="
                ui.lyricsAlignment =
                  ui.lyricsAlignment === 'left'
                    ? 'center'
                    : ui.lyricsAlignment === 'center'
                      ? 'right'
                      : 'left'
              "
            >
              <span class="w-[16px] h-[16px] flex items-center justify-center">
                <svg-icon name="arrow-arrow-left-right" class-name="w-[12px] h-[12px]" />
              </span>
            </button>
            <!-- lyrics style -->
            <button
              class="panel-tool"
              :title="t('playerPanel.lyricEffect', { effect: lyricsStyleLabel })"
              :aria-label="t('playerPanel.lyricEffect', { effect: lyricsStyleLabel })"
              @click="ui.handleClickStyle()"
            >
              <span class="w-[16px] h-[16px] flex items-center justify-center">
                <svg-icon name="common-lyrics-effect" class-name="w-[16px] h-[16px]" />
              </span>
            </button>
            <!-- lyrics manager -->
            <button
              class="panel-tool"
              :title="t('playerPanel.lyricManage')"
              :aria-label="t('playerPanel.lyricManage')"
              @click="showLyricsManager = true"
            >
              <span class="w-[16px] h-[16px] flex items-center justify-center">
                <SvgIcon name="common-lyrics2" class-name="w-[16px] h-[16px]" />
              </span>
            </button>
            <!-- translation-->
            <button
              class="panel-tool"
              :class="ui.showLyricsTranslation && 'active'"
              :title="t('playerPanel.showTranslation')"
              :aria-label="t('playerPanel.showTranslation')"
              @click="ui.toggleTranslation()"
            >
              <span class="w-[16px] h-[16px] flex items-center justify-center">
                <SvgIcon name="common-translate" class-name="w-[16px] h-[16px]" />
              </span>
            </button>
          </div>
          <!-- progress -->
          <div class="w-[min(440px,100%)]">
            <input
              class="w-full cursor-pointer appearance-auto accent-primary disabled:cursor-default disabled:opacity-45"
              :class="progressStyle === 'thin' ? 'h-1' : 'h-2.5'"
              type="range"
              min="0"
              :max="player.durationMs || 0"
              :value="player.positionMs"
              :disabled="!player.durationMs"
              :aria-label="t('playerPanel.progress')"
              @input="seek"
            />
            <div class="flex justify-between text-xs tabular-nums text-white/50">
              <span>{{ player.positionFormatted }}</span>
              <span>{{ player.durationFormatted }}</span>
            </div>
          </div>
          <!-- play control -->
          <div class="flex items-center gap-6">
            <!-- play mode -->
            <button
              class="grid size-6 place-items-center rounded-full text-white/50 transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
              :title="playModeLabel"
              @click="cyclePlayMode"
            >
              <SvgIcon :name="playModeIcon" class-name="size-6" />
            </button>
            <button
              class="grid size-6 place-items-center rounded-full text-white/50 transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
              :disabled="!player.queue.length"
              :title="t('playerPanel.previous')"
              @click="playPrevious"
            >
              <SvgIcon name="play-prev" class-name="size-6" />
            </button>
            <button
              class="grid size-[3.2rem] place-items-center rounded-full bg-primary text-white shadow-[0_7px_20px_color-mix(in_srgb,var(--color-primary)_45%,transparent)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
              :disabled="!player.currentFile"
              :title="player.isPlaying ? t('playerPanel.pause') : t('playerPanel.play')"
              @click="togglePlayback"
            >
              <SvgIcon :name="player.isPlaying ? 'play-pause' : 'play-play'" class-name="size-8" />
            </button>
            <button
              class="grid size-6 place-items-center rounded-full text-white/50 transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
              :disabled="!player.queue.length"
              :title="t('playerPanel.next')"
              @click="playNext"
            >
              <SvgIcon name="play-next" class-name="size-6" />
            </button>
            <!-- queue -->
            <button
              class="grid size-6 place-items-center rounded-full text-white/50 transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
              :title="t('queue.title')"
              :class="showQueue && 'active'"
              @click="showQueue = !showQueue"
            >
              <svg-icon name="control-playlist" class-name="size-6" />
            </button>
          </div>
        </section>
        <!-- lyrics -->
        <section
          class="flex min-w-0 flex-col py-8 max-[760px]:min-h-[250px] max-[760px]:border-t max-[760px]:border-text/10 max-[760px]:px-6 max-[760px]:py-6"
          :class="collapsed ? 'px-8' : ''"
          :aria-label="t('playerPanel.lyrics')"
        >
          <PlayerLyrics
            class="size-full flex-1"
            :song="player.currentQueueSong"
            :current-time="player.positionMs"
            :source-order="ui.lyricSourceOrder"
            :align-mode="collapsed ? 'center' : ui.lyricsAlignment"
            :forced-source="ui.lyricSourceMode"
            :auto-search-network="ui.autoSearchNetworkLyrics"
            :reload-token="lyricReloadToken"
            :layout-token="collapsed ? 1 : 0"
            @seek="seekTo"
          />
        </section>
      </div>
      <!-- play queue-->
      <PlayQueueDrawer v-model="showQueue" />
      <LyricsManagerDialog v-model="showLyricsManager" @saved="lyricReloadToken += 1" />
      <!-- play spectrum-->
      <div
        v-if="showSpectrum"
        class="pointer-events-none absolute inset-x-0 bottom-0 z-0 px-4 opacity-80"
      >
        <PlayerSpectrum :spectrum="player.audioAnalysis.spectrum" :color="coverColors.primary" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.panel-ambient {
  background:
    radial-gradient(circle at 14% 18%, var(--cover-primary), transparent 34%),
    radial-gradient(circle at 86% 76%, var(--cover-secondary), transparent 38%),
    radial-gradient(circle at 72% 14%, rgb(70 204 174 / 28%), transparent 30%);
  filter: blur(24px);
  transition:
    opacity 500ms ease,
    transform 120ms ease;
}
.panel-tool {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-height: 1.65rem;
  padding: 0.18rem 0.35rem;
  border-radius: 0.45rem;
  color: rgb(255 255 255 / 0.72);
  background: rgb(255 255 255 / 0.07);
  transition:
    transform 150ms ease,
    background-color 150ms ease,
    color 150ms ease,
    filter 150ms ease;
}
.panel-tool:hover,
.panel-tool.active {
  color: white;
  background: color-mix(in srgb, var(--color-primary) 38%, transparent);
}
.panel-tool:hover {
  transform: translateY(-1px);
  filter: brightness(1.08);
}
.panel-tool:active {
  transform: scale(0.96);
}
.panel-tool select {
  background: transparent;
  outline: 0;
}
.lyric-input,
.lyric-editor {
  width: 100%;
  border: 1px solid var(--color-border);
  border-radius: 0.5rem;
  background: rgb(255 255 255 / 0.06);
  color: var(--color-text);
  outline: none;
}
.lyric-input {
  padding: 0.5rem 0.65rem;
  font-size: 0.8125rem;
}
.lyric-editor {
  display: block;
  min-height: 14rem;
  resize: vertical;
  padding: 0.75rem;
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.75rem;
  line-height: 1.6;
}
.lyric-editor--translation {
  min-height: 7rem;
}
.lyric-input:focus,
.lyric-editor:focus {
  border-color: var(--color-primary);
}
.vertical-tool {
  position: relative;
  cursor: pointer;
}
.vertical-popup {
  position: absolute;
  bottom: 2rem;
  left: 50%;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  width: 2.5rem;
  height: 10rem;
  padding: 0.5rem 0.2rem;
  border-radius: 0.5rem;
  background: rgb(9 12 17 / 0.9);
  backdrop-filter: blur(10px);
  transform: translateX(-50%);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}
.vertical-popup input {
  position: absolute;
  top: 5.5rem;
  left: 50%;
  width: 7rem;
  height: 0.35rem;
  margin: 0;
  transform: translateX(-50%) rotate(-90deg);
}
.vertical-tool:hover .vertical-popup,
.vertical-tool:focus-within .vertical-popup {
  opacity: 1;
  pointer-events: auto;
}
.panel-orb {
  filter: blur(42px) saturate(1.35);
  mix-blend-mode: screen;
  transition:
    opacity 140ms ease,
    transform 120ms ease;
}
.panel-orb-primary {
  background: radial-gradient(circle, var(--cover-primary) 0%, transparent 67%);
}
.panel-orb-secondary {
  background: radial-gradient(circle, var(--cover-secondary) 0%, transparent 67%);
}
.panel-orb--animated {
  animation: player-panel-orb-drift 7s ease-in-out infinite alternate;
}
.panel-orb--delayed {
  animation-delay: -3.4s;
}
.cover-frame {
  transform-origin: center;
  will-change: transform, filter;
}
.panel-side {
  transition:
    opacity 520ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
}
.panel-side--collapsed {
  position: absolute;
  inset: 4rem auto 0 0;
  z-index: 20;
  width: 46%;
  overflow: hidden;
  pointer-events: none;
  opacity: 0;
  transform: translateX(-110%);
}
.cover-card {
  transition: box-shadow 100ms ease-out;
}
.cover-card--breathing {
  animation: cover-card-breathe 2.8s ease-in-out infinite;
}
.panel-background-enter-active,
.panel-background-leave-active {
  transition: opacity 700ms cubic-bezier(0.22, 0.61, 0.36, 1);
}
.panel-background-enter-from,
.panel-background-leave-to {
  opacity: 0 !important;
}
.cover-aura {
  background:
    radial-gradient(circle at 25% 22%, var(--cover-primary-solid), transparent 51%),
    radial-gradient(circle at 76% 78%, var(--cover-secondary-solid), transparent 58%);
  filter: blur(24px) saturate(1.25);
  transition:
    opacity 120ms ease,
    transform 100ms ease;
}
.cover-aura--breathing {
  animation: cover-aura-breathe 3.2s ease-in-out infinite;
}
.panel-cover--animated {
  animation: player-panel-cover-drift 18s ease-in-out infinite alternate;
}
.panel-ambient--animated {
  animation: player-panel-ambient-drift 14s ease-in-out infinite alternate;
}
.panel-gradient {
  background:
    linear-gradient(112deg, rgb(5 8 13 / 48%), rgb(12 16 23 / 20%) 52%, rgb(4 7 12 / 56%)),
    linear-gradient(180deg, rgb(9 12 17 / 8%), rgb(7 9 14 / 28%));
}
.beat-ring {
  opacity: 0;
  box-shadow:
    0 0 80px rgb(255 255 255 / 18%),
    inset 0 0 60px rgb(255 255 255 / 10%);
}
.beat-ring--pulse {
  animation: player-panel-beat 820ms cubic-bezier(0.14, 0.74, 0.24, 1) both;
}
@keyframes player-panel-beat {
  from {
    opacity: var(--beat-strength);
    transform: translate(-50%, -50%) scale(0.58);
  }
  to {
    opacity: 0;
    transform: translate(-50%, -50%) scale(1.38);
  }
}
@keyframes player-panel-cover-drift {
  from {
    background-position: 46% 50%;
  }
  to {
    background-position: 54% 46%;
  }
}
@keyframes player-panel-ambient-drift {
  from {
    background-position:
      0 0,
      100% 100%,
      70% 0;
  }
  to {
    background-position:
      20% 12%,
      78% 82%,
      55% 16%;
  }
}
@keyframes player-panel-orb-drift {
  from {
    translate: -3% -2%;
  }
  to {
    translate: 5% 4%;
  }
}
@keyframes cover-aura-breathe {
  0%,
  100% {
    filter: blur(24px) saturate(1.2) brightness(0.9);
  }
  50% {
    filter: blur(28px) saturate(1.45) brightness(1.18);
  }
}
@keyframes cover-card-breathe {
  0%,
  100% {
    filter: drop-shadow(0 10px 16px rgb(var(--cover-shadow-rgb) / 18%));
  }
  50% {
    filter: drop-shadow(0 18px 26px rgb(var(--cover-shadow-rgb) / 42%));
  }
}
@media (prefers-reduced-motion: reduce) {
  .beat-ring,
  .beat-ring--pulse,
  .panel-cover--animated,
  .panel-ambient--animated,
  .panel-orb--animated,
  .cover-aura--breathing,
  .cover-card--breathing {
    animation: none;
  }
}
</style>
