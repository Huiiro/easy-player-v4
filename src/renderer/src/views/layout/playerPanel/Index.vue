<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import BaseRange from '@/components/ui/BaseRange.vue'
import BaseMenu from '@/components/ui/BaseMenu.vue'
import BaseTooltip from '@/components/ui/BaseTooltip.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import { getVolumeLevel } from '@/utils/volume'
import { usePlayerBackdrop } from '@/components/player/usePlayerBackdrop'
import { useSeekProgress } from '@/components/player/useSeekProgress'
import { PlayMode } from '@/constants'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import PlayerLyrics from '@/components/lyrics/PlayerLyricsV2.vue'
import PlayQueueDrawer from '@/components/player/PlayQueueDrawer.vue'
import PlayerSpectrum from '@/components/player/PlayerSpectrum.vue'
import eventBus from '@/utils/eventBus'
import LyricsSearchDialog from '@/components/lyrics/LyricsSearchDialog.vue'
import AddSongsToPlaylistDialog from '@/components/songlist/AddSongsToPlaylistDialog.vue'
import LyricsColorDialog from '@/components/lyrics/LyricsColorDialog.vue'
import LiquidBackground from '@/components/background/player/LiquidBackground.vue'
import MeshFlowBackground from '@/components/background/player/MeshFlowBackground.vue'
import ParticleFlowBackground from '@/components/background/player/ParticleFlowBackground.vue'
import AmbientBubbleCanvas from '@/components/background/player/AmbientBubbleCanvas.vue'
import PlayerCover from '@/components/player/PlayerCover.vue'
import { usePlayerRhythm } from '@/components/player/usePlayerRhythm'
import { formatArtists, splitArtists } from '@/utils/artists'
import type { SongDetails } from '@/types/library'
import { useMessage } from '@/components/ui/useMessage'
import { writeSongLyricSettings } from '@/services/songLyricSettings'
import { useSongDialogs } from '@/components/songlist/useSongDialogs'
import SongDetailsDialog from '@/components/songlist/SongDetailsDialog.vue'
import LyricsEditorDialog from '@/components/lyrics/LyricsEditorDialog.vue'
import SongTagDialog from '@/components/tag/SongTagDialog.vue'
import type { LibrarySong } from '@/types/library'

const ui = useUIStore()
const player = usePlayerStore()
const volumeIcon = computed(() => `volume-volume-${getVolumeLevel(player.volume)}`)
const { displayPositionMs, displayPositionFormatted, previewSeek, commitSeek, cancelSeek } =
  useSeekProgress(player)
const { t } = useI18n()
const router = useRouter()
const { error: showError, success } = useMessage()
const {
  songDetailsOpen,
  songDetailsId,
  lyricsEditorOpen,
  lyricsEditorSongId,
  songTagDialogOpen,
  tagSongId,
  openSongDetails,
  openLyricsEditor,
  openSongTags,
  copySongName
} = useSongDialogs()
function actOnCurrentSong(action: (song: LibrarySong) => void | Promise<void>): void {
  const song = player.currentQueueSong
  if (song) void action(song)
}
const savingOffset = ref(false)
async function saveOffset(clear = false): Promise<void> {
  if (!player.currentQueueSong || savingOffset.value) return
  savingOffset.value = true
  try {
    await player.saveLyricsOffset(clear ? null : player.lyricsOffsetMs)
    success(t(clear ? 'playerPanel.lyricOffsetRemoved' : 'playerPanel.lyricOffsetSaved'))
  } catch (error) {
    showError(error instanceof Error ? error.message : t('settings.fileOperationFailed'))
  } finally {
    savingOffset.value = false
  }
}
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
const showLyricsSearch = ref(false)
const showPlaylistPicker = ref(false)
const playlistSongIds = ref<number[]>([])
const lyricPolicyPending = ref(false)
const currentArtists = computed(() =>
  splitArtists(player.currentQueueSong?.artist, ui.artistSeparator)
)
function openArtist(artist: string): void {
  const song = player.currentQueueSong
  if (!song || !artist) return
  void router.push({
    path: '/artist/detail',
    query: { name: artist, cover: song.cover || '' }
  })
  close()
}
function openAlbum(): void {
  const song = player.currentQueueSong
  if (!song?.album) return
  void router.push({
    path: '/album/detail',
    query: { name: song.album, artist: song.artist || '', cover: song.cover || '' }
  })
  close()
}
function openPlaylistPicker(): void {
  const song = player.currentQueueSong
  if (!song) return
  playlistSongIds.value = [song.id]
  showPlaylistPicker.value = true
}
async function setLyricPolicy(
  flag: 'disableNetwork' | 'instrumental',
  enabled: boolean
): Promise<void> {
  const song = player.currentQueueSong
  if (!song || lyricPolicyPending.value || !player.lyricsSettingsReady) return
  lyricPolicyPending.value = true
  try {
    const settings = await writeSongLyricSettings(song.id, { [flag]: enabled })
    song.disableNetworkLyrics = settings.disableNetwork
    song.instrumental = settings.instrumental
    if (currentSongDetails.value?.id === song.id) {
      currentSongDetails.value.disableNetworkLyrics = settings.disableNetwork
      currentSongDetails.value.instrumental = settings.instrumental
    }
  } catch (cause) {
    showError(cause instanceof Error ? cause.message : t('settings.fileOperationFailed'))
  } finally {
    lyricPolicyPending.value = false
  }
}
const moreOptions = computed(() => [
  {
    label: t('footer.audioControls'),
    icon: 'common-equalizer',
    onClick: () => eventBus.emit('openAudioControls')
  },
  {
    label: t('playerPanel.adjustLyricsDisplay'),
    icon: 'common-refresh',
    onClick: () => ui.adjustLyricsDisplay()
  },
  { type: 'divider' as const },
  {
    label: t('songList.addToPlaylist'),
    icon: 'common-plus',
    disabled: !player.currentQueueSong,
    onClick: openPlaylistPicker
  },
  ...currentArtists.value.map((artist) => ({
    label: `${t('footer.goArtist')} · ${artist}`,
    icon: 'common-user',
    onClick: () => openArtist(artist)
  })),
  {
    label: t('footer.goAlbum'),
    icon: 'common-album',
    disabled: !player.currentQueueSong?.album,
    onClick: openAlbum
  },
  ...[
    { label: t('songList.details'), icon: 'common-detail', action: openSongDetails },
    { label: t('lyricEditor.title'), icon: 'common-edit-lrc', action: openLyricsEditor },
    { label: t('songList.editTags'), icon: 'common-tag', action: openSongTags },
    { label: t('songList.copyName'), icon: 'common-text-case', action: copySongName }
  ].map(({ label, icon, action }) => ({
    label,
    icon,
    disabled: !player.currentQueueSong,
    onClick: () => actOnCurrentSong(action)
  })),
  { type: 'divider' as const },
  ...(['disableNetwork', 'instrumental'] as const).map((flag) => {
    const enabled = player.songLyricSettings[flag] === true
    return {
      label: t(
        flag === 'disableNetwork'
          ? enabled
            ? 'songList.removeDisableNetwork'
            : 'songList.addDisableNetwork'
          : enabled
            ? 'songList.removeInstrumental'
            : 'songList.addInstrumental'
      ),
      icon: `common-${flag === 'disableNetwork' ? 'no-internet' : 'music-notes'}-${enabled ? 'remove' : 'add'}`,
      disabled: !player.currentQueueSong || !player.lyricsSettingsReady || lyricPolicyPending.value,
      onClick: () => {
        void setLyricPolicy(flag, !enabled)
      }
    }
  })
])
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
const lyricAlignmentLabel = computed(() =>
  t(`playerPanel.align${ui.lyricsAlignment[0].toUpperCase()}${ui.lyricsAlignment.slice(1)}`)
)
const alignmentOptions = computed(() =>
  (['left', 'center', 'right'] as const).map((value) => ({
    value,
    label: t(`playerPanel.align${value[0].toUpperCase()}${value.slice(1)}`),
    onClick: () => {
      ui.lyricsAlignment = value
    }
  }))
)
const lyricStyleOptions = computed(() =>
  (['none', 'glow', 'follow'] as const).map((value) => ({
    value,
    label: t(`playerPanel.lyricEffect${value[0].toUpperCase()}${value.slice(1)}`),
    onClick: () => {
      ui.lyricsStyle = value
    }
  }))
)
const lyricSourceOptions = computed(() =>
  (['auto', 'embedded', 'database', 'local', 'network'] as const).map((value) => ({
    value,
    label: t(value === 'auto' ? 'playerPanel.lyricSourceAuto' : `lyrics.source.${value}`),
    onClick: () => {
      ui.lyricSourceMode = value
    }
  }))
)
const lyricSourceLabel = computed(
  () => lyricSourceOptions.value.find((item) => item.value === ui.lyricSourceMode)?.label || ''
)
const lyricsFontScale = computed(() => ui.lyricsFontSize / 2.4)
const lyricsFontSpacingScale = computed(() => ui.lyricsFontPadding / 30)
const lyricsOffsetLabel = computed(() => {
  const seconds = player.lyricsOffsetMs / 1000
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
  eventBus.on('songLyricSettingsChanged', handleLyricsUpdated)
  window.addEventListener('keydown', handleKeyDown)
})
onUnmounted(() => {
  eventBus.off('lyricsUpdated', handleLyricsUpdated)
  eventBus.off('songLyricSettingsChanged', handleLyricsUpdated)
  window.removeEventListener('keydown', handleKeyDown)
})

/**
 * liquid
 */
const {
  liquidUnavailable,
  meshUnavailable,
  particlesUnavailable,
  useAlbumArtwork,
  useAmbientBackground,
  useLiquidBackground,
  useMeshBackground,
  useParticleBackground,
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
  void player.seek(Math.max(0, positionMs - player.lyricsOffsetMs))
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
  player.setLyricsOffset(player.lyricsOffsetMs + (event.deltaY < 0 ? 100 : -100))
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
      <Transition name="panel-background">
        <MeshFlowBackground
          v-if="useMeshBackground && !meshUnavailable && paletteReady"
          :cover-src="coverFailed ? null : displayedCoverUrl"
          :primary="coverColors.primary"
          :secondary="coverColors.secondary"
          :tertiary="coverColors.tertiary"
          :active="ui.showPlayer && isPanelVisible"
          :reduced-motion="ui.reduceMotion || player.rhythmVisualConfig.reducedMotion"
          :energy="player.isPlaying ? liquidBass : 0"
          @unavailable="meshUnavailable = true"
        />
      </Transition>
      <Transition name="panel-background">
        <ParticleFlowBackground
          v-if="useParticleBackground && !particlesUnavailable"
          :active="shouldAnimate"
          :reduced-motion="ui.reduceMotion || player.rhythmVisualConfig.reducedMotion"
          :energy="liquidEnergy"
          :bass="liquidBass"
          :beat="liquidBeat"
          :beat-sequence="player.audioAnalysis.beatSequence"
          @unavailable="particlesUnavailable = true"
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
            :effect="ui.playerCoverEffect"
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
                :class-name="currentPreference === -1 ? 'size-4 text-danger' : 'size-4'"
              />
            </button>
            <!-- speed -->
            <BaseTooltip
              interactive
              variant="control"
              :aria-label="t('playerPanel.speed')"
              @wheel="changeSpeed"
            >
              <template #trigger="{ triggerProps }">
                <button
                  type="button"
                  v-bind="triggerProps"
                  class="panel-tool"
                  :class="player.playbackSpeedConfig.speed !== 1 && 'active'"
                  :aria-label="t('playerPanel.speed')"
                >
                  <svg-icon name="common-speed" class-name="w-[16px] h-[16px]" />
                </button>
              </template>
              <b>{{ player.playbackSpeedConfig.speed.toFixed(1) }}×</b>
              <input
                :aria-label="t('playerPanel.speed')"
                type="range"
                class="accent-primary"
                min="0.5"
                max="2"
                step="0.1"
                :value="player.playbackSpeedConfig.speed"
                @input="setSpeed($event)"
              />
            </BaseTooltip>
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
            <!-- lyrics timing -->
            <BaseTooltip
              interactive
              variant="control"
              :aria-label="t('playerPanel.lyricTiming')"
              :control-width="96"
              :control-height="192"
              @wheel="changeLyricsOffset"
            >
              <template #trigger="{ triggerProps }">
                <button
                  type="button"
                  v-bind="triggerProps"
                  class="panel-tool"
                  :class="player.lyricsOffsetMs !== 0 && 'active'"
                  :aria-label="t('playerPanel.lyricTiming')"
                >
                  <svg-icon name="common-time" class-name="w-[16px] h-[16px]" />
                </button>
              </template>
              <b>{{ lyricsOffsetLabel }}</b>
              <input
                :aria-label="t('playerPanel.lyricTiming')"
                class="accent-primary"
                type="range"
                min="-5000"
                max="5000"
                step="100"
                :value="player.lyricsOffsetMs"
                @input="player.setLyricsOffset(Number(($event.target as HTMLInputElement).value))"
              />
              <span class="lyric-timing-actions">
                <button
                  type="button"
                  class="lyric-timing-reset"
                  :disabled="savingOffset || !player.lyricsSettingsReady"
                  :title="t('playerPanel.lyricOffsetSave')"
                  :aria-label="t('playerPanel.lyricOffsetSave')"
                  @click.prevent="saveOffset()"
                >
                  <SvgIcon name="common-check" class-name="size-3" />
                </button>
                <button
                  v-if="player.songLyricSettings.offsetMs !== null"
                  type="button"
                  class="lyric-timing-reset"
                  :disabled="savingOffset"
                  :title="t('playerPanel.lyricOffsetRemove')"
                  @click.prevent="saveOffset(true)"
                >
                  <SvgIcon name="common-close" class-name="size-3" />
                </button>
                <button
                  type="button"
                  class="lyric-timing-reset"
                  :title="t('playerPanel.lyricTimingReset')"
                  @click.prevent="player.setLyricsOffset(0)"
                >
                  <SvgIcon name="common-refresh" class-name="size-3" />
                </button>
              </span>
            </BaseTooltip>
            <!-- font size -->
            <BaseTooltip
              interactive
              variant="control"
              :aria-label="t('playerPanel.lyricFontSize')"
              @wheel="changeLyricSize"
            >
              <template #trigger="{ triggerProps }">
                <button
                  type="button"
                  v-bind="triggerProps"
                  class="panel-tool"
                  :aria-label="t('playerPanel.lyricFontSize')"
                >
                  <span class="w-[16px] h-[16px] flex items-center justify-center">
                    <svg-icon name="menu-font" class-name="w-[10px] h-[10px]" />
                  </span>
                </button>
              </template>
              <b>{{ lyricsFontScale.toFixed(1) }}×</b>
              <input
                :aria-label="t('playerPanel.lyricFontSize')"
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
            </BaseTooltip>
            <!-- font padding -->
            <BaseTooltip
              interactive
              variant="control"
              :aria-label="t('playerPanel.lyricSpacing')"
              @wheel="changeLyricPadding"
            >
              <template #trigger="{ triggerProps }">
                <button
                  type="button"
                  v-bind="triggerProps"
                  class="panel-tool"
                  :aria-label="t('playerPanel.lyricSpacing')"
                >
                  <span class="w-[16px] h-[16px] flex items-center justify-center">
                    <svg-icon name="arrow-arrow-up-down" class-name="w-[12px] h-[12px]" />
                  </span>
                </button>
              </template>
              <b>{{ lyricsFontSpacingScale.toFixed(1) }}×</b>
              <input
                :aria-label="t('playerPanel.lyricSpacing')"
                class="accent-primary"
                type="range"
                min="3"
                max="78"
                step="3"
                :value="ui.lyricsFontPadding"
                @input="ui.setLyricsFontPadding(Number(($event.target as HTMLInputElement).value))"
              />
            </BaseTooltip>
            <!-- lyrics alignment -->
            <BaseMenu
              appearance="glass"
              :model-value="ui.lyricsAlignment"
              :items="alignmentOptions"
              side="top"
              align="start"
              size="sm"
              width="w-36"
              teleport
            >
              <template #trigger>
                <button
                  type="button"
                  class="panel-tool"
                  :title="t('playerPanel.lyricAlignment', { alignment: lyricAlignmentLabel })"
                  :aria-label="t('playerPanel.lyricAlignment', { alignment: lyricAlignmentLabel })"
                >
                  <span class="w-[16px] h-[16px] flex items-center justify-center">
                    <svg-icon name="arrow-arrow-left-right" class-name="w-[12px] h-[12px]" />
                  </span>
                </button>
              </template>
            </BaseMenu>
            <!-- lyrics style -->
            <BaseMenu
              appearance="glass"
              :model-value="ui.lyricsStyle"
              :items="lyricStyleOptions"
              side="top"
              align="start"
              size="sm"
              width="w-36"
              teleport
            >
              <template #trigger>
                <button
                  type="button"
                  class="panel-tool"
                  :title="t('playerPanel.lyricEffect', { effect: lyricsStyleLabel })"
                  :aria-label="t('playerPanel.lyricEffect', { effect: lyricsStyleLabel })"
                >
                  <SvgIcon name="common-lyrics-effect" class-name="size-4" />
                </button>
              </template>
            </BaseMenu>
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
            <!-- playback lyric source is independent from searching -->
            <BaseMenu
              appearance="glass"
              :model-value="ui.lyricSourceMode"
              :items="lyricSourceOptions"
              side="top"
              align="start"
              size="sm"
              width="w-48"
              teleport
            >
              <template #trigger>
                <button
                  type="button"
                  class="panel-tool"
                  :class="ui.lyricSourceMode !== 'auto' && 'active'"
                  :title="t('playerPanel.lyricSourceSelection', { source: lyricSourceLabel })"
                  :aria-label="t('playerPanel.lyricSourceSelection', { source: lyricSourceLabel })"
                >
                  <SvgIcon name="common-lyrics2" class-name="size-4" />
                </button>
              </template>
            </BaseMenu>
            <!-- search lyrics -->
            <button
              class="panel-tool"
              :title="t('playerPanel.lyricSearchTitle')"
              :aria-label="t('playerPanel.lyricSearchTitle')"
              @click="showLyricsSearch = true"
            >
              <span class="w-[16px] h-[16px] flex items-center justify-center">
                <SvgIcon name="common-search" class-name="w-[16px] h-[16px]" />
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
            <BaseTooltip
              interactive
              variant="control"
              :aria-label="t('footer.volume')"
              @wheel="changeVolume"
            >
              <template #trigger="{ triggerProps }">
                <button
                  type="button"
                  v-bind="triggerProps"
                  class="panel-secondary-text grid size-6 place-items-center rounded-full transition hover:scale-105"
                  :aria-label="t('footer.volume')"
                >
                  <SvgIcon :name="volumeIcon" class-name="size-6" />
                </button>
              </template>
              <small>{{ Math.round(player.volume * 100) }}%</small>
              <input
                :aria-label="t('footer.volume')"
                class="accent-primary"
                type="range"
                :value="player.volume * 100"
                @input="player.setVolume(Number(($event.target as HTMLInputElement).value) / 100)"
              />
            </BaseTooltip>
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
              class="grid size-[3.2rem] place-items-center rounded-full ep-button--primary shadow-[0_0_20px_color-mix(in_srgb,var(--color-primary)_45%,transparent)] transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
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
            <!-- more song actions -->
            <BaseMenu
              :items="moreOptions"
              max-height="calc(100vh - 32px)"
              appearance="glass"
              side="top"
              align="end"
              size="sm"
              width="w-64"
              teleport
            >
              <template #trigger>
                <button
                  type="button"
                  class="panel-secondary-text grid size-6 place-items-center rounded-full transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
                  :disabled="!player.currentQueueSong"
                  :title="t('songList.more')"
                  :aria-label="t('songList.more')"
                >
                  <SvgIcon name="menu-more-horizontal" class-name="size-6" />
                </button>
              </template>
            </BaseMenu>
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
            :current-time="player.positionMs + player.lyricsOffsetMs"
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
      <LyricsSearchDialog v-model="showLyricsSearch" />
      <LyricsColorDialog v-model="showLyricsColorDialog" />
      <SongDetailsDialog v-model="songDetailsOpen" :song-id="songDetailsId" />
      <LyricsEditorDialog v-model="lyricsEditorOpen" :song-id="lyricsEditorSongId" />
      <SongTagDialog v-model="songTagDialogOpen" :song-id="tagSongId" />
      <AddSongsToPlaylistDialog v-model="showPlaylistPicker" :song-ids="playlistSongIds" />
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
.ep-playback-progress {
  --ep-progress-track: rgb(255 255 255 / 20%);
  --ep-progress-fill: var(--color-primary);
  --ep-range-thumb-bg: var(--color-primary);
  --ep-range-unplayed-color: var(--ep-progress-track);
  --ep-range-fill-background: linear-gradient(var(--ep-progress-fill), var(--ep-progress-fill));
}
.liquid-background-soften {
  background: rgba(8, 11, 20, 0.5);
  backdrop-filter: brightness(0.9) saturate(1.62) contrast(1.14);
}
.panel-background-item {
  filter: blur(64px) saturate(1.68) contrast(1.28) brightness(0.52);
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
.lyric-timing-actions {
  flex-shrink: 0;
  display: flex;
  gap: 0.3rem;
}
.lyric-timing-actions .lyric-timing-reset {
  position: static;
}
.lyric-timing-reset {
  display: grid;
  place-items: center;
  width: 1.45rem;
  height: 1.45rem;
  border-radius: 999px;
  color: var(--ep-tooltip-text, var(--color-text-l));
  background: color-mix(in srgb, var(--color-text) 9%, transparent);
  transition:
    color var(--motion-duration-fast) var(--motion-ease-standard),
    background-color var(--motion-duration-fast) var(--motion-ease-standard),
    transform var(--motion-duration-fast) var(--motion-ease-standard);
}
.lyric-timing-reset:hover {
  color: var(--color-text);
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
