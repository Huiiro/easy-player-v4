<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import { CoverAnalyzer } from '@/hooks/useImageColors'
import { PlayerBgType, resolvePlayerBgType } from '@/consts'
import { PlayMode } from '@/consts'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import PlayerLyrics from '@/components/lyrics/PlayerLyricsV2.vue'
import PlayQueueDrawer from '@/components/player/PlayQueueDrawer.vue'
import PlayerSpectrum from '@/components/player/PlayerSpectrum.vue'
import LyricsManagerDialog from '@/components/lyrics/LyricsManagerDialog.vue'
import AddSongsToPlaylistDialog from '@/components/songlist/AddSongsToPlaylistDialog.vue'
import LyricsColorDialog from '@/components/lyrics/LyricsColorDialog.vue'
import LiquidBackground from '@/components/background/LiquidBackground.vue'
import AmbientBubbleCanvas from '@/components/background/AmbientBubbleCanvas.vue'
import PlayerCover from '@/components/player/PlayerCover.vue'
import { formatArtists } from '@/utils/artists'

const showLyricsSamplingRegion = import.meta.env.DEV && false
const showLiquidDebug = import.meta.env.DEV && false
const COVER_ANALYSIS_VERSION = 5

const ui = useUIStore()
const player = usePlayerStore()
const { t } = useI18n()

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
  return cover ? `easy-player-media://cover?path=${encodeURIComponent(cover)}` : null
})
const displayedCoverUrl = ref<string | null>(null)
const trackTitle = computed(
  () =>
    player.trackInfo?.metadata?.title || player.currentQueueSong?.title || t('playerPanel.noTrack')
)
const trackArtist = computed(() => {
  const artist = player.trackInfo?.metadata?.artist || player.currentQueueSong?.artist
  return (
    formatArtists(artist, ui.artistSeparator, ui.normalizeArtistSeparator) ||
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
const rhythmAmount = ref(0)
const isPanelVisible = ref(!document.hidden && document.hasFocus())
let lastVisualUpdateAt = 0

function syncPanelVisibility(): void {
  isPanelVisible.value = !document.hidden && document.hasFocus()
}

const targetRhythmAmount = computed(() => {
  if (
    !player.isPlaying ||
    !isPanelVisible.value ||
    !player.rhythmVisualConfig.enabled ||
    player.rhythmVisualConfig.reducedMotion ||
    ui.reduceMotion
  )
    return 0
  const { rms, lowEnergy, onsetStrength } = player.audioAnalysis
  const energy = Math.max(0, Math.min(1, Math.max(rms, lowEnergy, onsetStrength)))
  return Math.min(1, energy * player.rhythmVisualConfig.intensity * 1.8)
})
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
onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  document.addEventListener('visibilitychange', syncPanelVisibility)
  window.addEventListener('focus', syncPanelVisibility)
  window.addEventListener('blur', syncPanelVisibility)
})
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  document.removeEventListener('visibilitychange', syncPanelVisibility)
  window.removeEventListener('focus', syncPanelVisibility)
  window.removeEventListener('blur', syncPanelVisibility)
})

/**
 * liquid
 */
const liquidUnavailable = ref(false)
const coverColorSource = ref<'idle' | 'loading' | 'cache' | 'sampled' | 'failed'>('idle')
const liquidDebug = ref({ width: 0, height: 0, time: 0, flowSpeed: 0, warpStrength: 0, beat: 0 })
const defaultLiquidColors = {
  primary: '77 136 220',
  secondary: '205 78 165',
  tertiary: '73 186 165'
}
const selectedPlayerBackground = computed(() => resolvePlayerBgType(ui.playerBgType))
const effectivePlayerBackground = computed(() =>
  resolvePlayerBgType(selectedPlayerBackground.value, {
    coverAvailable: Boolean(coverUrl.value && !coverFailed.value),
    liquidAvailable: !liquidUnavailable.value
  })
)
const useAlbumArtwork = computed(() => effectivePlayerBackground.value === PlayerBgType.ALBUM)
const useAmbientBackground = computed(
  () => effectivePlayerBackground.value === PlayerBgType.AMBIENT
)
const useLiquidBackground = computed(() => effectivePlayerBackground.value === PlayerBgType.LIQUID)
const ambientIntensity = computed(() =>
  selectedPlayerBackground.value === PlayerBgType.AMBIENT ? 1 : 0.68
)
const liquidCoverSource = computed(() =>
  coverColorSource.value === 'failed' ? null : coverUrl.value
)
const backgroundSource = computed(() => {
  if (useAlbumArtwork.value && displayedCoverUrl.value && !coverFailed.value)
    return displayedCoverUrl.value
  return null
})
watch(selectedPlayerBackground, (background) => {
  liquidUnavailable.value = false
  if (background === PlayerBgType.LIQUID)
    coverColorSource.value = coverUrl.value ? 'loading' : 'idle'
  else coverColorSource.value = 'idle'
})

/**
 * colors
 */
const initialPalette = CoverAnalyzer.getCachedPalette(
  player.currentQueueSong,
  COVER_ANALYSIS_VERSION,
  useLiquidBackground.value
)
const coverColors = ref(initialPalette ?? { ...defaultLiquidColors })
const paletteReady = ref(!coverUrl.value || Boolean(initialPalette))
const lyricsContrastDebug = ref({
  averageLuminance: 0,
  brightRatio: 0,
  nearWhite: 0,
  lowContrastRisk: 0,
  useDarkText: false
})
const useDarkLyrics = ref(false)
const lyricColorStyle = computed(() => {
  if (useDarkLyrics.value && !ui.lyricsColors.overrideAutoContrast) return undefined
  return {
    '--lrc-default': ui.lyricsColors.default,
    '--lrc-highlight': ui.lyricsColors.highlight,
    '--lrc-translate': ui.lyricsColors.translation
  }
})
const shouldAnimate = computed(
  () =>
    player.isPlaying &&
    isPanelVisible.value &&
    player.rhythmVisualConfig.enabled &&
    !player.rhythmVisualConfig.reducedMotion &&
    !ui.reduceMotion
)
const liquidEnergy = computed(() => {
  if (!player.rhythmVisualConfig.enabled) return 0
  const { rms, onsetStrength } = player.audioAnalysis
  return Math.min(1, Math.max(0, rms * 3.5, onsetStrength * 0.9, rhythmAmount.value * 0.8))
})
const liquidBass = computed(() =>
  player.rhythmVisualConfig.enabled
    ? Math.min(1, Math.max(0, player.audioAnalysis.lowEnergy) * 3.4)
    : 0
)
const liquidBeat = computed(() =>
  player.rhythmVisualConfig.enabled
    ? Math.min(
        1,
        Math.max(0, player.audioAnalysis.onsetStrength) * player.rhythmVisualConfig.intensity * 4.2
      )
    : 0
)
const analysisPollingRate = computed(() => {
  if (!ui.showPlayer || !isPanelVisible.value) return 0
  if (ui.showPlayerSpectrum) return 20
  return shouldAnimate.value ? 12 : 0
})
function getLyricsRegion(image: HTMLImageElement): [number, number, number, number] | null {
  const bounds = image.getBoundingClientRect()
  if (!bounds.width || !bounds.height || !image.naturalWidth || !image.naturalHeight) return null

  const panelLeft = window.innerWidth * 0.55
  const panelTop = window.innerHeight * 0.14
  const panelRight = window.innerWidth * 0.85
  const panelBottom = window.innerHeight * 0.86
  const left = Math.max(panelLeft, bounds.left)
  const top = Math.max(panelTop, bounds.top)
  const right = Math.min(panelRight, bounds.right)
  const bottom = Math.min(panelBottom, bounds.bottom)
  if (right <= left || bottom <= top) return null

  const scale = Math.max(bounds.width / image.naturalWidth, bounds.height / image.naturalHeight)
  const visibleWidth = bounds.width / scale
  const visibleHeight = bounds.height / scale
  const sourceLeft = (image.naturalWidth - visibleWidth) / 2
  const sourceTop = (image.naturalHeight - visibleHeight) / 2
  const toSourceX = (value: number): number =>
    sourceLeft + ((value - bounds.left) / bounds.width) * visibleWidth
  const toSourceY = (value: number): number =>
    sourceTop + ((value - bounds.top) / bounds.height) * visibleHeight
  return [
    toSourceX(left),
    toSourceY(top),
    toSourceX(right) - toSourceX(left),
    toSourceY(bottom) - toSourceY(top)
  ]
}
function extractCoverColors(event: Event): void {
  const image = event.currentTarget as HTMLImageElement
  const loadedSource = image.getAttribute('src')
  if (loadedSource && loadedSource !== coverUrl.value) return
  const result = CoverAnalyzer.analyze({
    image,
    song: player.currentQueueSong,
    isPanelBackground: image.classList.contains('panel-background-item'),
    useLiquidBackground: useLiquidBackground.value,
    coverAnalysisVersion: COVER_ANALYSIS_VERSION,
    getLyricsRegion,
    onCacheUpdate: (id, analysis) => {
      void window.api.database.command('updateSongCoverAnalysis', {
        id,
        analysis
      })
    }
  })
  if (useLiquidBackground.value && result.source === 'failed') {
    resetCoverPalette('failed')
    paletteReady.value = true
    return
  }
  coverColors.value = result.palette
  paletteReady.value = true
  useDarkLyrics.value = result.useDarkLyrics
  coverColorSource.value = result.source
  lyricsContrastDebug.value = result.result
}
function resetCoverPalette(source: 'idle' | 'loading' | 'failed', preserveColors = false): void {
  if (!preserveColors) coverColors.value = { ...defaultLiquidColors }
  useDarkLyrics.value = false
  coverColorSource.value = source
}
function handleCoverError(event: Event): void {
  if ((event.currentTarget as HTMLImageElement).getAttribute('src') !== coverUrl.value) return
  coverFailed.value = true
  displayedCoverUrl.value = null
  resetCoverPalette('failed')
  paletteReady.value = true
}
watch(
  coverUrl,
  (url, _, onCleanup) => {
    coverFailed.value = false
    const cached = CoverAnalyzer.getCachedPalette(
      player.currentQueueSong,
      COVER_ANALYSIS_VERSION,
      useLiquidBackground.value
    )
    const preserveColors = Boolean(url && paletteReady.value)
    resetCoverPalette(url ? 'loading' : 'idle', preserveColors)
    if (cached) {
      coverColors.value = cached
      coverColorSource.value = 'cache'
    }
    paletteReady.value = !url || preserveColors || Boolean(cached)
    if (!url) {
      displayedCoverUrl.value = null
      return
    }
    const image = new Image()
    let active = true
    onCleanup(() => {
      active = false
      image.onload = null
      image.onerror = null
    })
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      void image
        .decode()
        .catch(() => {})
        .then(() => {
          if (active) displayedCoverUrl.value = url
        })
    }
    image.onerror = () => {
      if (!active) return
      coverFailed.value = true
      displayedCoverUrl.value = null
      resetCoverPalette('failed')
    }
    image.src = url
  },
  { immediate: true }
)
watch(backgroundSource, (source) => {
  if (!source) {
    useDarkLyrics.value = false
    if (!coverUrl.value) resetCoverPalette('idle')
  }
})
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
function close(): void {
  player.setAudioAnalysisPollingRate(0)
  performance.clearMarks()
  performance.clearMeasures()
  ui.showPlayer = false
}
function handleKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.isComposing) return
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
            :debug="showLiquidDebug"
            @unavailable="liquidUnavailable = true"
            @debug="liquidDebug = $event"
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
      <!-- dev debug -->
      <div
        v-if="showLyricsSamplingRegion"
        class="pointer-events-none absolute bottom-[14%] left-[55%] right-[15%] top-[14%] border border-dashed border-amber-300/90 bg-amber-200/10"
      >
        <span
          class="absolute left-2 top-2 rounded bg-amber-300/90 px-1.5 py-0.5 text-[10px] font-medium leading-5 text-slate-950"
        >
          歌词取色区域<br />
          平均亮度 {{ lyricsContrastDebug?.averageLuminance.toFixed(3) }} / 阈值 0.74<br />
          明亮像素 {{ (lyricsContrastDebug?.brightRatio * 100).toFixed(1) }}% / 阈值 56%<br />
          近白 {{ (lyricsContrastDebug?.nearWhite * 100).toFixed(1) }}% / 阈值 42%<br />
          低对比风险 {{ (lyricsContrastDebug?.lowContrastRisk * 100).toFixed(1) }}% / 阈值 62%<br />
          判定：{{ lyricsContrastDebug?.useDarkText ? '深色歌词' : '浅色歌词' }}
        </span>
      </div>
    </div>
    <!-- dev debug -->
    <aside v-if="showLiquidDebug && useLiquidBackground" class="liquid-debug" aria-live="polite">
      <strong>Liquid background · DEV</strong>
      <span>颜色来源：{{ coverColorSource }}</span>
      <span>
        <i :style="{ background: `rgb(${coverColors.primary})` }" />主色
        {{ coverColors.primary }}
      </span>
      <span>
        <i :style="{ background: `rgb(${coverColors.secondary})` }" />副色
        {{ coverColors.secondary }}
      </span>
      <span>
        <i :style="{ background: `rgb(${coverColors.tertiary})` }" />牵制色
        {{ coverColors.tertiary }}
      </span>
      <span>首尾相邻色由 Shader 实时计算</span>
      <span>RMS {{ liquidEnergy.toFixed(3) }} · Bass {{ liquidBass.toFixed(3) }}</span>
      <span>Beat {{ liquidDebug.beat.toFixed(3) }}</span>
      <span>
        速度 {{ liquidDebug.flowSpeed.toFixed(3) }} · 扰动
        {{ liquidDebug.warpStrength.toFixed(3) }}
      </span>
      <span>
        帧缓冲 {{ liquidDebug.width }}×{{ liquidDebug.height }} · t
        {{ liquidDebug.time.toFixed(1) }}s
      </span>
    </aside>
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
            <div class="panel-secondary-text flex justify-between text-xs tabular-nums">
              <span>{{ player.positionFormatted }}</span>
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
              class="grid size-[3.2rem] place-items-center rounded-full bg-primary text-white shadow-[0_7px_20px_color-mix(in_srgb,var(--color-primary)_45%,transparent)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
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
            :dark-text="useDarkLyrics && !useLiquidBackground"
            @seek="seekTo"
          />
        </section>
      </div>
      <!-- play queue-->
      <PlayQueueDrawer v-model="showQueue" />
      <LyricsManagerDialog v-model="showLyricsManager" @saved="lyricReloadToken += 1" />
      <LyricsColorDialog v-model="showLyricsColorDialog" />
      <AddSongsToPlaylistDialog
        v-model="showPlaylistPicker"
        :song-ids="player.currentQueueSong ? [player.currentQueueSong.id] : []"
      />
      <!-- play spectrum-->
      <div
        v-if="ui.showPlayer && ui.showPlayerSpectrum"
        class="pointer-events-none absolute inset-x-0 bottom-0 z-0 px-4 opacity-80"
      >
        <PlayerSpectrum
          :spectrum="player.audioAnalysis.spectrum"
          :color="coverColors.primary"
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
.liquid-debug {
  position: absolute;
  top: 4.5rem;
  left: 1rem;
  z-index: 35;
  display: grid;
  gap: 0.25rem;
  min-width: 16rem;
  padding: 0.65rem 0.75rem;
  border: 1px solid rgb(255 255 255 / 18%);
  border-radius: 0.6rem;
  color: rgb(255 255 255 / 86%);
  background: rgb(5 8 16 / 72%);
  box-shadow: 0 10px 30px rgb(0 0 0 / 22%);
  backdrop-filter: blur(12px);
  font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
  font-size: 0.7rem;
  line-height: 1.4;
}
.liquid-debug strong {
  color: #fff;
  font-size: 0.72rem;
}
.liquid-debug span {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}
.liquid-debug i {
  width: 0.7rem;
  height: 0.7rem;
  border: 1px solid rgb(255 255 255 / 30%);
  border-radius: 999px;
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
