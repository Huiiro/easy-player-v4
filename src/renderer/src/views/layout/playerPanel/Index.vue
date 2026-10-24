<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import BaseRange from '@/components/ui/BaseRange.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import { usePlayerBackdrop } from '@/components/player/usePlayerBackdrop'
import { useSeekProgress } from '@/components/player/useSeekProgress'
import { PlayMode } from '@/consts'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import PlayerLyrics from '@/components/lyrics/PlayerLyricsV2.vue'
import PlayQueueDrawer from '@/components/player/PlayQueueDrawer.vue'
import PlayerSpectrum from '@/components/player/PlayerSpectrum.vue'
import eventBus from '@/utils/eventBus'
import LyricsManagerDialog from '@/components/lyrics/LyricsManagerDialog.vue'
import AddSongsToPlaylistDialog from '@/components/songlist/AddSongsToPlaylistDialog.vue'
import LyricsColorDialog from '@/components/lyrics/LyricsColorDialog.vue'
import LiquidBackground from '@/components/background/LiquidBackground.vue'
import AmbientBubbleCanvas from '@/components/background/AmbientBubbleCanvas.vue'
import PlayerCover from '@/components/player/PlayerCover.vue'
import { usePlayerRhythm } from '@/components/player/usePlayerRhythm'
import { formatArtists } from '@/utils/artists'
import type { SongDetails } from '@/types/library'
import { useMessage } from '@/components/ui/useMessage'

const ui = useUIStore()
const player = usePlayerStore()
const { displayPositionMs, displayPositionFormatted, previewSeek, commitSeek, cancelSeek } =
  useSeekProgress(player)
const { t } = useI18n()
const { error: showError } = useMessage()
const preferencePending = ref(false)
const currentPreference = computed(() =>
  player.currentQueueSong ? player.getSongPreference(player.currentQueueSong.id) : 0
)
const preferenceLabel = computed(() =>
  t(
    currentPreference.value === 1
      ? 'playerPanel.preferenceLiked'
      : currentPreference.value === -1
        ? 'playerPanel.preferenceDisliked'
        : 'playerPanel.preferenceNeutral'
  )
)
async function cyclePreference(): Promise<void> {
  const song = player.currentQueueSong
  if (!song || preferencePending.value) return
  const next = currentPreference.value === 0 ? 1 : currentPreference.value === 1 ? -1 : 0
  preferencePending.value = true
  try {
    if (!(await player.setPreference(song.id, next))) showError(t('recommendation.failed'))
  } catch {
    showError(t('recommendation.failed'))
  } finally {
    preferencePending.value = false
  }
}
const currentSongDetails = shallowRef<SongDetails | null>(null)
watch(
  () => player.currentQueueSong?.id,
  async (id) => {
    currentSongDetails.value = null
    if (id == null) return
    try {
      const response = await window.api.database.command('getSong', { id })
      if (response.success && player.currentQueueSong?.id === id)
        currentSongDetails.value = response.data as SongDetails | null
    } catch (error) {
      console.warn('[PlayerPanel] Failed to load song details:', error)
    }
  },
  { immediate: true }
)

const coverFailed = ref(false)
const showQueue = ref(false)
const showLyricsManager = ref(false)
const showPlaylistPicker = ref(false)
const showLyricsColorDialog = ref(false)
const lyricReloadToken = ref(0)
const progressStyle = ref<'thin' | 'thick'>('thin')
const collapsed = ref(false)
let collapseTriggeredByPointer = false

const coverUrl = computed(() => {
  const cover = player.currentQueueSong?.cover
  // Share one bounded decode between the cover, palette sampler and background.
  return cover
    ? `easy-player-media://cover-thumb?path=${encodeURIComponent(cover)}&size=1024`
    : null
})
const displayedCoverUrl = ref<string | null>(null)
const trackTitle = computed(
  () =>
    player.trackInfo?.metadata?.title || player.currentQueueSong?.title || t('playerPanel.noTrack')
)
const trackArtist = computed(() => {
  const artist = player.trackInfo?.metadata?.artist || player.currentQueueSong?.artist
  return (
    formatArtists(artist, ui.artistSeparator, ui.normalizeMetadataSeparator) ||
    t('playerPanel.defaultArtist')
  )
})
const playModeIcon = computed(
  () => ['control-order', 'control-loop', 'control-single', 'control-shuffle'][player.playMode]
)
const playModeLabel = computed(() =>
  t(['queue.sequential', 'queue.list', 'queue.single', 'queue.random'][player.playMode])
)
const lyricsStyleLabel = computed(() =>
  t(`playerPanel.lyricEffect${ui.lyricsStyle[0].toUpperCase()}${ui.lyricsStyle.slice(1)}`)
)
const lyricsFontScale = computed(() => ui.lyricsFontSize / 2.4)
const lyricsFontSpacingScale = computed(() => ui.lyricsFontPadding / 30)
const lyricsOffsetLabel = computed(() => {
  const seconds = ui.lyricsOffsetMs / 1000
  return `${seconds > 0 ? '+' : ''}${seconds.toFixed(1)}s`
})

/**
 * rhythm
 */
const { rhythmAmount, isPanelVisible } = usePlayerRhythm(player, ui)
function handleLyricsUpdated(songId: number): void {
  if (player.currentQueueSong?.id === songId) lyricReloadToken.value += 1
}
onMounted(() => {
  eventBus.on('lyricsUpdated', handleLyricsUpdated)
  window.addEventListener('keydown', handleKeyDown)
})
onUnmounted(() => {
  eventBus.off('lyricsUpdated', handleLyricsUpdated)
  window.removeEventListener('keydown', handleKeyDown)
})

/**
 * liquid
 */
const {
  liquidUnavailable,
  useAlbumArtwork,
  useAmbientBackground,
  useLiquidBackground,
  ambientIntensity,
  liquidCoverSource,
  backgroundSource,
  coverColors,
  spectrumColor,
  paletteReady,
  useDarkLyrics,
  backgroundImage,
  lyricColorStyle,
  shouldAnimate,
  liquidEnergy,
  liquidBass,
  liquidBeat,
  analysisPollingRate,
  extractCoverColors,
  handleCoverError
} = usePlayerBackdrop(
  player,
  ui,
  coverUrl,
  coverFailed,
  displayedCoverUrl,
  rhythmAmount,
  isPanelVisible
)
function setBackgroundImage(element: unknown): void {
  backgroundImage.value = element instanceof HTMLImageElement ? element : null
}
watch(
  analysisPollingRate,
  (rate) => player.setAudioAnalysisPollingRate(rate, ui.showPlayerSpectrum),
  { immediate: true }
)
onUnmounted(() => player.setAudioAnalysisPollingRate(0))

/**
 * controls
 */
const audioDetails = computed(() => {
  const info = player.trackInfo
  const song = currentSongDetails.value
  if (!info && !song) return []
  const channelCount = info?.channels || song?.channels
  const sampleRate = info?.sampleRate || song?.sampleRate
  const bitDepth = info?.bitDepth || song?.bitDepth
  const bitrate = info?.bitrateKbps || song?.bitrate
  const channels =
    channelCount === 1
      ? t('playerPanel.mono')
      : channelCount === 2
        ? t('playerPanel.stereo')
        : channelCount
          ? t('playerPanel.channels', { count: channelCount })
          : t('playerPanel.unavailable')
  return [
    [
      t('playerPanel.format'),
      info?.format?.toUpperCase() ||
        info?.codecName ||
        song?.format?.toUpperCase() ||
        t('playerPanel.unavailable')
    ],
    [
      t('playerPanel.sampleRate'),
      sampleRate
        ? `${sampleRate / 1000} ${t('playerPanel.kilohertz')}`
        : t('playerPanel.unavailable')
    ],
    [
      t('playerPanel.bitDepth'),
      bitDepth ? `${bitDepth} ${t('playerPanel.bit')}` : t('playerPanel.unavailable')
    ],
    [t('playerPanel.channel'), channels],
    [
      t('playerPanel.bitrate'),
      bitrate ? `${bitrate} ${t('playerPanel.kilobitsPerSecond')}` : t('playerPanel.unavailable')
    ]
  ]
})
function close(): void {
  player.setAudioAnalysisPollingRate(0)
  performance.clearMarks()
  performance.clearMeasures()
  ui.showPlayer = false
}
function handleKeyDown(event: KeyboardEvent): void {
  if (!ui.showPlayer || event.key !== 'Escape' || event.isComposing) return
  event.preventDefault()
  close()
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
function seekTo(positionMs: number): void {
  void player.seek(positionMs)
}
function cyclePlayMode(): void {
  player.setPlayMode(((player.playMode + 1) % 4) as PlayMode)
}
function setSpeed(event: Event): void {
  setPlaybackSpeed(Number((event.target as HTMLInputElement).value))
}
function setPlaybackSpeed(speed: number): void {
  player.playbackSpeedConfig.speed = Math.round(Math.max(0.5, Math.min(2, speed)) * 10) / 10
  player.playbackSpeedConfig.enabled = player.playbackSpeedConfig.speed !== 1
  void player.setPlaybackSpeed()
}
function changeSpeed(event: WheelEvent): void {
  event.preventDefault()
  setPlaybackSpeed(player.playbackSpeedConfig.speed + (event.deltaY < 0 ? 0.1 : -0.1))
}
function changeVolume(event: WheelEvent): void {
  event.preventDefault()
  void player.setVolume(Math.max(0, Math.min(1, player.volume + (event.deltaY < 0 ? 0.05 : -0.05))))
}
function changeLyricSize(event: WheelEvent): void {
  event.preventDefault()
  ui.setLyricsFontSize(
    Math.max(1.44, Math.min(4.8, ui.lyricsFontSize + (event.deltaY < 0 ? 0.24 : -0.24)))
  )
}
function changeLyricPadding(event: WheelEvent): void {
  event.preventDefault()
  ui.setLyricsFontPadding(
    Math.max(3, Math.min(78, ui.lyricsFontPadding + (event.deltaY < 0 ? 3 : -3)))
  )
}
function changeLyricsOffset(event: WheelEvent): void {
  event.preventDefault()
  ui.setLyricsOffset(ui.lyricsOffsetMs + (event.deltaY < 0 ? 100 : -100))
}
</script>

<template>
  <div class="fixed inset-0 z-40 isolate overflow-hidden bg-[#101416] text-text-l select-none">
    <div class="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      <Transition name="panel-background">
        <img
          v-if="backgroundSource"
          :ref="setBackgroundImage"
          :key="backgroundSource"
          :src="backgroundSource"
          :style="{ transform: `scale(${1.1 + rhythmAmount * 0.1})` }"
          class="panel-background-item absolute -inset-10 size-[calc(100%_+_5rem)] max-w-none object-cover transition-transform duration-[var(--motion-duration-fast)]"
          :class="useAlbumArtwork ? 'opacity-100' : 'opacity-0'"
          alt=""
          crossorigin="anonymous"
          @load="extractCoverColors"
          @error="handleCoverError"
        />
      </Transition>
      <img
        v-if="useLiquidBackground && coverUrl"
        :key="coverUrl"
        :src="coverUrl"
        class="absolute size-px opacity-0"
        alt=""
        crossorigin="anonymous"
        @load="extractCoverColors"
        @error="handleCoverError"
      />
      <Transition name="panel-background">
        <div
          v-if="useLiquidBackground && !liquidUnavailable && paletteReady"
          class="absolute inset-0"
        >
          <LiquidBackground
            :key="liquidCoverSource ? 'cover-liquid-background' : 'default-liquid-background'"
            :primary="coverColors.primary"
            :secondary="coverColors.secondary"
            :tertiary="coverColors.tertiary"
            :cover-src="liquidCoverSource"
            :energy="liquidEnergy"
            :bass="liquidBass"
            :beat="liquidBeat"
            :active="player.isPlaying && isPanelVisible"
            :reduced-motion="player.rhythmVisualConfig.reducedMotion"
            @unavailable="liquidUnavailable = true"
          />
          <div class="absolute inset-0 liquid-background-soften" />
        </div>
      </Transition>
      <Transition name="panel-background">
        <AmbientBubbleCanvas
          v-if="useAmbientBackground && paletteReady"
          :primary="coverColors.primary"
          :secondary="coverColors.secondary"
          :tertiary="coverColors.tertiary"
          :active="shouldAnimate"
          :bubbles-enabled="
            player.rhythmVisualConfig.enabled &&
            !player.rhythmVisualConfig.reducedMotion &&
            !ui.reduceMotion
          "
          :reduced-motion="ui.reduceMotion || player.rhythmVisualConfig.reducedMotion"
          :energy="rhythmAmount"
          :beat-sequence="player.audioAnalysis.beatSequence"
          :intensity="ambientIntensity"
        />
      </Transition>
    </div>
    <!-- content -->
    <section
      class="relative z-10 size-full overflow-hidden bg-transparent"
      :class="useLiquidBackground && 'player-panel-content--liquid'"
      :aria-label="t('playerPanel.label')"
    >
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
            class-name="size-5 panel-primary-text"
          />
        </button>
        <button
          type="button"
          class="pointer-events-auto grid size-9 place-items-center rounded-full bg-text/[0.08] text-text transition hover:scale-105 [-webkit-app-region:no-drag]"
          :title="t('playerPanel.close')"
          :aria-label="t('playerPanel.close')"
          @click="close"
        >
          <SvgIcon name="common-close" class-name="size-5 panel-primary-text" />
        </button>
      </header>

      <div
        class="player-panel-layout relative grid size-full overflow-hidden pt-16"
        :class="collapsed && 'player-panel-layout--collapsed'"
      >
        <!-- metadata & control -->
        <section
          class="panel-side flex min-w-0 flex-col items-center justify-center gap-5 px-[clamp(1.5rem,4vw,4rem)] py-8 max-[760px]:border-r-0 max-[760px]:px-6 max-[760px]:py-6 max-[700px]:gap-4"
          :class="collapsed && 'panel-side--collapsed'"
        >
          <!-- cover -->
          <PlayerCover
            :cover-style="ui.playerCoverStyle"
            :cover-url="coverFailed ? null : displayedCoverUrl"
            :title="trackTitle"
            :primary="coverColors.primary"
            :secondary="coverColors.secondary"
            :rhythm-amount="rhythmAmount"
            :visual-enabled="player.rhythmVisualConfig.enabled && paletteReady"
            :active="shouldAnimate"
            :playing="player.isPlaying && isPanelVisible"
            :reduce-motion="ui.reduceMotion || player.rhythmVisualConfig.reducedMotion"
            :spin="ui.isCoverSpin"
            @load="extractCoverColors"
            @error="handleCoverError"
          />
          <!-- title && artist -->
          <div class="min-w-0 text-center cursor-pointer">
            <h2
              class="panel-primary-text max-w-[min(440px,72vw)] truncate text-2xl font-bold"
              :title="trackTitle"
            >
              {{ trackTitle }}
            </h2>
            <p class="panel-secondary-text mt-1 truncate">{{ trackArtist }}</p>
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
              <dt class="panel-secondary-text truncate text-[0.65rem]">{{ label }}</dt>
              <dd class="panel-primary-text mt-1 truncate text-xs font-semibold">{{ value }}</dd>
            </div>
          </dl>
          <!-- args control -->
          <div class="flex w-full flex-nowrap items-center justify-center gap-1 text-xs">
            <!-- song preference: neutral → liked → disliked → neutral -->
            <button
              type="button"
              class="panel-tool shrink-0 disabled:cursor-not-allowed disabled:opacity-35"
              :class="currentPreference !== 0 && 'active'"
              :disabled="!player.currentQueueSong || preferencePending"
              :title="preferenceLabel"
              :aria-label="preferenceLabel"
              @click="cyclePreference"
            >
              <SvgIcon
                :name="
                  currentPreference === 1
                    ? 'play-like-fill'
                    : currentPreference === -1
                      ? 'play-dislike'
                      : 'play-like'
                "
                :class-name="currentPreference === -1 ? 'size-4 scale-125 text-red-400' : 'size-4'"
              />
            </button>
            <!-- speed -->
            <label
              class="panel-tool vertical-tool"
              :class="player.playbackSpeedConfig.speed !== 1 && 'active'"
              :title="t('playerPanel.speed')"
              @wheel="changeSpeed"
            >
              <svg-icon name="common-speed" class-name="w-[16px] h-[16px]" />
              <span class="vertical-popup">
                <b>{{ player.playbackSpeedConfig.speed.toFixed(1) }}×</b>
                <input
                  type="range"
                  class="accent-primary"
                  min="0.5"
                  max="2"
                  step="0.1"
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
              :class="ui.showPlayerSpectrum && 'active'"
              @click="ui.showPlayerSpectrum = !ui.showPlayerSpectrum"
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
                <b>{{ lyricsFontScale.toFixed(1) }}×</b>
                <input
                  class="accent-primary"
                  type="range"
                  min="0.6"
                  max="2"
                  step="0.1"
                  :value="lyricsFontScale"
                  @input="
                    ui.setLyricsFontSize(Number(($event.target as HTMLInputElement).value) * 2.4)
                  "
                />
              </span>
            </label>
            <!-- lyrics timing -->
            <label
              class="panel-tool vertical-tool"
              :class="ui.lyricsOffsetMs !== 0 && 'active'"
              :title="t('playerPanel.lyricTiming')"
              @wheel="changeLyricsOffset"
            >
              <svg-icon name="common-time" class-name="w-[16px] h-[16px]" />
              <span class="vertical-popup lyric-timing-popup">
                <b>{{ lyricsOffsetLabel }}</b>
                <input
                  class="accent-primary"
                  type="range"
                  min="-5000"
                  max="5000"
                  step="100"
                  :value="ui.lyricsOffsetMs"
                  @input="ui.setLyricsOffset(Number(($event.target as HTMLInputElement).value))"
                />
                <button
                  type="button"
                  class="lyric-timing-reset"
                  :title="t('playerPanel.lyricTimingReset')"
                  @click.prevent="ui.resetLyricsOffset()"
                >
                  <SvgIcon name="common-refresh" class-name="size-3" />
                </button>
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
                <b>{{ lyricsFontSpacingScale.toFixed(1) }}×</b>
                <input
                  class="accent-primary"
                  type="range"
                  min="3"
                  max="78"
                  step="3"
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
            <!-- lyrics colors -->
            <button
              class="panel-tool"
              :title="t('playerPanel.lyricColorsTitle')"
              :aria-label="t('playerPanel.lyricColorsTitle')"
              @click="showLyricsColorDialog = true"
            >
              <span
                class="size-4 rounded-full border border-white/45"
                :style="{
                  background: `linear-gradient(135deg, ${ui.lyricsColors.highlight} 0 34%, ${ui.lyricsColors.default} 34% 67%, ${ui.lyricsColors.translation} 67%)`
                }"
              />
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
            <button
              class="panel-tool"
              :class="ui.showLyricsRomanization && 'active'"
              :title="t('playerPanel.showRomanization')"
              :aria-label="t('playerPanel.showRomanization')"
              @click="ui.toggleRomanization()"
            >
              <SvgIcon name="common-romaji" class-name="w-[16px] h-[16px]" />
            </button>
          </div>
          <!-- progress -->
          <div class="w-[min(440px,100%)]">
            <BaseRange
              class="ep-range ep-playback-progress w-full cursor-pointer disabled:cursor-default disabled:opacity-45"
              :class="progressStyle === 'thin' ? 'h-1' : 'h-2.5'"
              :min="0"
              :max="player.durationMs || 0"
              :value="displayPositionMs"
              :disabled="!player.durationMs"
              :aria-label="t('playerPanel.progress')"
              @input="previewSeek"
              @change="commitSeek"
              @pointercancel="cancelSeek"
              @blur="cancelSeek"
            />
            <div class="panel-secondary-text flex justify-between text-xs tabular-nums">
              <span>{{ displayPositionFormatted }}</span>
              <span>{{ player.durationFormatted }}</span>
            </div>
          </div>
          <!-- play control -->
          <div class="flex items-center gap-6">
            <!-- volume -->
            <label
              class="panel-secondary-text vertical-tool grid size-6 place-items-center rounded-full transition hover:scale-105"
              :title="t('footer.volume')"
              @wheel="changeVolume"
            >
              <svg-icon name="volume-volume-high" class-name="size-6" />
              <span class="vertical-popup">
                <small>{{ Math.round(player.volume * 100) }}%</small>
                <input
                  class="accent-primary"
                  type="range"
                  :value="player.volume * 100"
                  @input="player.setVolume(Number(($event.target as HTMLInputElement).value) / 100)"
                />
              </span>
            </label>
            <!-- play mode -->
            <button
              class="panel-secondary-text grid size-6 place-items-center rounded-full transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
              :title="playModeLabel"
              @click="cyclePlayMode"
            >
              <SvgIcon :name="playModeIcon" class-name="size-6" />
            </button>
            <button
              class="panel-secondary-text grid size-6 place-items-center rounded-full transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
              :disabled="!player.queue.length"
              :title="t('playerPanel.previous')"
              @click="playPrevious"
            >
              <SvgIcon name="play-prev" class-name="size-6" />
            </button>
            <button
              class="grid size-[3.2rem] place-items-center rounded-full bg-primary text-white shadow-[0_0_20px_color-mix(in_srgb,var(--color-primary)_45%,transparent)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
              :disabled="!player.currentFile"
              :title="player.isPlaying ? t('playerPanel.pause') : t('playerPanel.play')"
              @click="togglePlayback"
            >
              <SvgIcon :name="player.isPlaying ? 'play-pause' : 'play-play'" class-name="size-8" />
            </button>
            <button
              class="panel-secondary-text grid size-6 place-items-center rounded-full transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
              :disabled="!player.queue.length"
              :title="t('playerPanel.next')"
              @click="playNext"
            >
              <SvgIcon name="play-next" class-name="size-6" />
            </button>
            <!-- queue -->
            <button
              class="panel-secondary-text grid size-6 place-items-center rounded-full transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
              :title="t('queue.title')"
              :class="showQueue && 'active'"
              @click="showQueue = !showQueue"
            >
              <svg-icon name="control-playlist" class-name="size-6" />
            </button>
            <!-- add current song to playlist -->
            <button
              class="panel-secondary-text grid size-6 place-items-center rounded-full transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
              :disabled="!player.currentQueueSong"
              :title="t('songList.addToPlaylist')"
              :aria-label="t('songList.addToPlaylist')"
              @click="showPlaylistPicker = true"
            >
              <SvgIcon name="common-plus" class-name="size-6" />
            </button>
          </div>
        </section>
        <!-- lyrics -->
        <section
          class="panel-lyrics flex min-w-0 flex-col py-8 max-[760px]:min-h-[250px] max-[760px]:border-t max-[760px]:border-text/10 max-[760px]:py-6"
          :class="[
            collapsed && 'panel-lyrics--collapsed',
            useLiquidBackground && !liquidUnavailable && 'panel-lyrics--liquid'
          ]"
          :aria-label="t('playerPanel.lyrics')"
        >
          <PlayerLyrics
            class="size-full flex-1"
            :style="lyricColorStyle"
            :song="player.currentQueueSong"
            :current-time="player.positionMs + ui.lyricsOffsetMs"
            :is-playing="player.isPlaying"
            :source-order="ui.lyricSourceOrder"
            :align-mode="collapsed ? 'center' : ui.lyricsAlignment"
            :forced-source="ui.lyricSourceMode"
            :auto-search-network="ui.autoSearchNetworkLyrics"
            :reload-token="lyricReloadToken"
            :layout-token="collapsed ? 1 : 0"
            :dark-text="useDarkLyrics && !ui.lyricsColors.overrideAutoContrast"
            @seek="seekTo"
          />
        </section>
      </div>
      <!-- play queue-->
      <PlayQueueDrawer v-model="showQueue" />
      <LyricsManagerDialog v-model="showLyricsManager" />
      <LyricsColorDialog v-model="showLyricsColorDialog" />
      <AddSongsToPlaylistDialog
        v-model="showPlaylistPicker"
        :song-ids="player.currentQueueSong ? [player.currentQueueSong.id] : []"
      />
      <!-- play spectrum-->
      <div
        v-if="ui.showPlayerSpectrum"
        class="pointer-events-none absolute inset-x-0 bottom-0 z-0 px-4 opacity-90"
      >
        <PlayerSpectrum
          :spectrum="player.audioAnalysis.spectrum"
          :color="spectrumColor"
          :active="player.isPlaying && isPanelVisible"
        />
      </div>
    </section>
  </div>
</template>

<style scoped>
.liquid-background-soften {
  background: rgb(8 11 20 / 48%);
  backdrop-filter: blur(6px) brightness(0.9) saturate(1.62) contrast(1.14);
}
.panel-background-item {
  filter: blur(52px) saturate(1.68) contrast(1.28) brightness(0.52);
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
    transform var(--motion-duration-fast) var(--motion-ease-standard),
    background-color var(--motion-duration-fast) var(--motion-ease-standard),
    color var(--motion-duration-fast) var(--motion-ease-standard),
    filter var(--motion-duration-fast) var(--motion-ease-standard);
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
  transition: opacity var(--motion-duration-fast) var(--motion-ease-standard);
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
.lyric-timing-popup {
  height: 12rem;
}
.lyric-timing-reset {
  position: absolute;
  bottom: 0.5rem;
  display: grid;
  place-items: center;
  width: 1.45rem;
  height: 1.45rem;
  border-radius: 999px;
  color: rgb(255 255 255 / 0.72);
  background: rgb(255 255 255 / 0.09);
  transition:
    color var(--motion-duration-fast) var(--motion-ease-standard),
    background-color var(--motion-duration-fast) var(--motion-ease-standard),
    transform var(--motion-duration-fast) var(--motion-ease-standard);
}
.lyric-timing-reset:hover {
  color: white;
  background: color-mix(in srgb, var(--color-primary) 38%, transparent);
  transform: rotate(-35deg);
}
.player-panel-layout {
  grid-template-columns: minmax(0, 0.85fr) minmax(0, 1.15fr);
  grid-template-rows: minmax(0, 1fr);
  transition: grid-template-columns 520ms cubic-bezier(0.22, 1, 0.36, 1);
}
.player-panel-layout--collapsed {
  grid-template-columns: minmax(0, 0fr) minmax(0, 1fr);
}
.panel-side {
  position: relative;
  transition:
    opacity 520ms cubic-bezier(0.22, 1, 0.36, 1),
    transform 520ms cubic-bezier(0.22, 1, 0.36, 1);
}
.panel-side--collapsed {
  pointer-events: none;
  opacity: 0;
  transform: translateX(-45vw);
}
.panel-lyrics {
  min-height: 0;
  overflow: hidden;
  padding-right: 0;
  padding-left: 0;
  transition:
    padding 520ms cubic-bezier(0.22, 1, 0.36, 1),
    opacity 320ms ease;
}
.panel-lyrics--collapsed {
  padding-right: 2rem;
  padding-left: 2rem;
}
.panel-background-enter-active,
.panel-background-leave-active {
  transition: opacity 700ms cubic-bezier(0.22, 0.61, 0.36, 1);
}
.panel-background-enter-from,
.panel-background-leave-to {
  opacity: 0 !important;
}
</style>
