<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import BaseRange from '@/components/ui/BaseRange.vue'
import BaseMenu from '@/components/ui/BaseMenu.vue'
import BaseTooltip from '@/components/ui/BaseTooltip.vue'
import { useUIStore } from '@/stores/ui/uiStore'
import { usePlayerStore } from '@/stores/player/playerStore'
import { getVolumeLevel } from '@/utils/volume'
import { usePlayerBackdrop } from '@/components/player/usePlayerBackdrop'
import SeekProgress from '@/components/player/SeekProgress.vue'
import { useFooterAutoHide } from '@/components/player/useFooterAutoHide'
import { PlayMode, PlayerBgType } from '@/constants'
import SvgIcon from '@/components/svg/SvgIcon.vue'
import PlayerLyrics from '@/components/lyrics/PlayerLyricsV2.vue'
import PlayQueueDrawer from '@/components/player/PlayQueueDrawer.vue'
import PlayerSpectrum from '@/components/player/PlayerSpectrum.vue'
import eventBus from '@/utils/eventBus'
import LyricsSearchDialog from '@/components/lyrics/LyricsSearchDialog.vue'
import AddSongsToPlaylistDialog from '@/components/songlist/AddSongsToPlaylistDialog.vue'
import AlbumArtworkBackground from '@/components/player/AlbumArtworkBackground.vue'
import LiquidBackground from '@/components/background/player/LiquidBackground.vue'
import MeshFlowBackground from '@/components/background/player/MeshFlowBackground.vue'
import ParticleFlowBackground from '@/components/background/player/ParticleFlowBackground.vue'
import AmbientBubbleCanvas from '@/components/background/player/AmbientBubbleCanvas.vue'
import PlayerCover from '@/components/player/PlayerCover.vue'
import PlayerAppearanceDrawer from '@/components/player/PlayerAppearanceDrawer.vue'
import PlaybackButton from '@/components/player/PlaybackButton.vue'
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
const StageBackground = defineAsyncComponent(() =>
  import('@/components/background/player/StageBackground.vue').then((module) => module.default)
)
const player = usePlayerStore()
const speedPreview = ref<number | null>(null)
const displayedSpeed = computed(() => speedPreview.value ?? player.playbackSpeedConfig.speed)
let speedWheelTimer: number | undefined
const volumeIcon = computed(() => `volume-volume-${getVolumeLevel(player.volume)}`)
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
  ...overflowOptions.value,
  ...(overflowOptions.value.length ? [{ type: 'divider' as const }] : []),
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
    {
      label: t('playerPanel.lyricSearchTitle'),
      icon: 'common-search',
      action: () => {
        showLyricsSearch.value = true
      }
    },
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
const lyricReloadToken = ref(0)
const progressStyle = ref<'thin' | 'thick'>('thin')
const collapsed = ref(false)
let collapseTriggeredByPointer = false

const coverUrl = computed(() => {
  const cover = player.currentQueueSong?.cover
  // Share a bounded decode between the cover, palette sampler and texture-based backgrounds.
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
const lyricsOffsetLabel = computed(() => {
  const seconds = player.lyricsOffsetMs / 1000
  return `${seconds > 0 ? '+' : ''}${seconds.toFixed(1)}s`
})

const toolsRef = ref<HTMLElement | null>(null)
const moreButtonRef = ref<HTMLButtonElement | null>(null)
const toolCapacity = ref(0)
const overflowTool = ref<string | null>(null)
const toolTips = new Map<string, { show: () => void }>()
function setToolTooltip(key: string, instance: unknown): void {
  if (instance && typeof instance === 'object' && 'show' in instance) {
    toolTips.set(key, instance as { show: () => void })
  } else toolTips.delete(key)
}
const toolOptions = computed(() => [
  {
    key: 'preference',
    label: preferenceLabel.value,
    icon: 'play-like',
    disabled: !player.currentQueueSong || preferencePending.value
  },
  { key: 'speed', label: t('playerPanel.speed'), icon: 'common-speed' },
  { key: 'timing', label: t('playerPanel.lyricTiming'), icon: 'common-time' },
  { key: 'play-mode', label: playModeLabel.value, icon: playModeIcon.value },
  { key: 'queue', label: t('queue.title'), icon: 'control-playlist' }
])
const overflowOptions = computed(() =>
  ui.playerLayout === 'bottom'
    ? toolOptions.value.slice(toolCapacity.value).map((tool) => ({
        label: tool.label,
        icon: tool.icon,
        disabled: tool.disabled,
        onClick: () => void activateOverflowTool(tool.key)
      }))
    : []
)
function isToolVisible(key: string): boolean {
  return (
    ui.playerLayout !== 'bottom' ||
    overflowTool.value === key ||
    toolOptions.value.findIndex((tool) => tool.key === key) < toolCapacity.value
  )
}
function finishOverflowTool(key: string): void {
  if (overflowTool.value !== key) return
  const anchor = toolsRef.value?.querySelector(`[data-panel-tool="${key}"]`)
  if (anchor?.contains(document.activeElement)) moreButtonRef.value?.focus({ preventScroll: true })
  overflowTool.value = null
}
async function activateOverflowTool(key: string): Promise<void> {
  const popup = key === 'speed' || key === 'timing'
  if (popup) {
    updateOverflowAnchor()
    overflowTool.value = key
  }
  await nextTick()
  // Let the More menu finish restoring focus before opening the original control.
  requestAnimationFrame(() => {
    const root = toolsRef.value?.querySelector<HTMLElement>(`[data-panel-tool="${key}"]`)
    const button = root instanceof HTMLButtonElement ? root : root?.querySelector('button')
    if (!button || button.disabled) return
    if (popup) button.focus({ preventScroll: true })
    button.click()
    toolTips.get(key)?.show()
  })
}
let toolsObserver: ResizeObserver | undefined
function updateOverflowAnchor(): void {
  const toolbar = toolsRef.value
  const button = moreButtonRef.value
  if (!toolbar || !button) return
  const origin = toolbar.getBoundingClientRect()
  const anchor = button.getBoundingClientRect()
  toolbar.style.setProperty('--panel-overflow-left', `${anchor.left - origin.left}px`)
  toolbar.style.setProperty('--panel-overflow-top', `${anchor.top - origin.top}px`)
}
function measureTools(): void {
  const element = toolsRef.value
  if (!element || ui.playerLayout !== 'bottom') return
  const style = getComputedStyle(element)
  const available =
    element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
  const gap = parseFloat(style.columnGap) || 0
  // Reserve one slot for audio controls before fitting the tools that can overflow.
  const slots = Math.floor((available + gap) / (28 + gap))
  toolCapacity.value = Math.max(0, Math.min(toolOptions.value.length, slots - 1))
  if (overflowTool.value) updateOverflowAnchor()
}
watch(
  [toolsRef, () => ui.playerLayout],
  () => {
    toolsObserver?.disconnect()
    overflowTool.value = null
    if (!toolsRef.value || ui.playerLayout !== 'bottom') return
    toolsObserver ??= new ResizeObserver(measureTools)
    toolsObserver.observe(toolsRef.value)
    measureTools()
  },
  { flush: 'post' }
)
onUnmounted(() => toolsObserver?.disconnect())

const controlsRef = ref<HTMLElement | null>(null)
const controlPopups = ref(new Set<string>())
const controlsDragging = ref(false)
const controlsKeyboardFocus = ref(false)
const controlsBusy = computed(
  () =>
    controlsDragging.value ||
    controlsKeyboardFocus.value ||
    controlPopups.value.size > 0 ||
    overflowTool.value !== null ||
    showQueue.value ||
    showLyricsSearch.value ||
    ui.showPlayerAppearance ||
    showPlaylistPicker.value ||
    songDetailsOpen.value ||
    lyricsEditorOpen.value ||
    songTagDialogOpen.value
)
const {
  footerHidden: controlsHidden,
  revealFooter: revealControls,
  scheduleFooterHide: scheduleControlsHide
} = useFooterAutoHide(
  controlsRef,
  computed(() => ui.playerLayout === 'bottom' && ui.showPlayer),
  controlsBusy,
  computed(() => ui.reduceMotion)
)
const lyricTime = (): number => player.positionMs + player.lyricsOffsetMs
function setControlPopup(key: string, open: boolean): void {
  const next = new Set(controlPopups.value)
  if (open) next.add(key)
  else {
    next.delete(key)
    finishOverflowTool(key)
  }
  controlPopups.value = next
}
function onControlsFocus(event: FocusEvent): void {
  controlsKeyboardFocus.value =
    event.target instanceof Element && event.target.matches(':focus-visible')
  revealControls()
}
function onControlsBlur(): void {
  void nextTick(() => {
    controlsKeyboardFocus.value =
      !!controlsRef.value?.contains(document.activeElement) &&
      !!document.activeElement?.matches(':focus-visible')
    scheduleControlsHide()
  })
}
function startControlGesture(): void {
  controlsKeyboardFocus.value = false
  controlsDragging.value = true
  revealControls()
}
function releaseControlGesture(): void {
  controlsDragging.value = false
}

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
  window.addEventListener('pointerup', releaseControlGesture)
  window.addEventListener('pointercancel', releaseControlGesture)
  window.addEventListener('blur', releaseControlGesture)
})
onUnmounted(() => {
  eventBus.off('lyricsUpdated', handleLyricsUpdated)
  eventBus.off('songLyricSettingsChanged', handleLyricsUpdated)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('pointerup', releaseControlGesture)
  window.removeEventListener('pointercancel', releaseControlGesture)
  window.removeEventListener('blur', releaseControlGesture)
})

/**
 * liquid
 */
const {
  liquidUnavailable,
  meshUnavailable,
  particlesUnavailable,
  effectivePlayerBackground,
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
  lyricColorStyle,
  shouldAnimate,
  liquidEnergy,
  liquidBass,
  liquidBeat,
  stageLightingActive,
  analysisNeedsSpectrum,
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
interface PanelBackground {
  key: string
  kind: PlayerBgType
  source?: string
}

const desiredBackground = computed<PanelBackground | null>(() => {
  const kind = effectivePlayerBackground.value
  if (kind === PlayerBgType.ALBUM) {
    const source = backgroundSource.value
    return source ? { key: source, kind, source } : null
  }
  if (!paletteReady.value && kind !== PlayerBgType.CHEER && kind !== PlayerBgType.PARTICLES)
    return null
  return { key: kind, kind }
})
const currentBackground = shallowRef<PanelBackground | null>(null)
const incomingBackground = shallowRef<PanelBackground | null>(null)
const revealingBackground = ref(false)
const backgroundLayers = computed(() =>
  [currentBackground.value, incomingBackground.value].filter(
    (layer): layer is PanelBackground => layer !== null
  )
)

function queueBackground(): void {
  if (revealingBackground.value) return
  const next = desiredBackground.value
  incomingBackground.value = next?.key === currentBackground.value?.key ? null : next
}

function completeBackgroundReveal(): void {
  if (!incomingBackground.value) return
  currentBackground.value = incomingBackground.value
  incomingBackground.value = null
  revealingBackground.value = false
  queueBackground()
}

function backgroundReady(layer: PanelBackground): void {
  if (incomingBackground.value?.key !== layer.key || revealingBackground.value) return
  if (!currentBackground.value || ui.reduceMotion) completeBackgroundReveal()
  else revealingBackground.value = true
}

function albumBackgroundReady(layer: PanelBackground, image: HTMLImageElement): void {
  extractCoverColors(image)
  backgroundReady(layer)
}

function handleBackgroundUnavailable(layer: PanelBackground): void {
  if (incomingBackground.value?.key === layer.key) {
    incomingBackground.value = null
    revealingBackground.value = false
  }
  if (desiredBackground.value?.key !== layer.key) {
    queueBackground()
    return
  }
  if (layer.kind === PlayerBgType.LIQUID) liquidUnavailable.value = true
  if (layer.kind === PlayerBgType.MESH) meshUnavailable.value = true
  if (layer.kind === PlayerBgType.PARTICLES) particlesUnavailable.value = true
}

watch(desiredBackground, queueBackground, { immediate: true })
watch(
  () => ui.reduceMotion,
  (reduced) => {
    if (reduced && revealingBackground.value) completeBackgroundReveal()
  }
)

watch(
  [analysisPollingRate, analysisNeedsSpectrum],
  ([rate, includeSpectrum]) => player.setAudioAnalysisPollingRate(rate, includeSpectrum),
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
  ui.showPlayerAppearance = false
  player.setAudioAnalysisPollingRate(0)
  performance.clearMarks()
  performance.clearMeasures()
  ui.showPlayer = false
}
function handleKeyDown(event: KeyboardEvent): void {
  if (ui.showPlayer && ui.playerLayout === 'bottom') {
    revealControls()
    scheduleControlsHide()
  }
  if (
    !ui.showPlayer ||
    ui.showPlayerAppearance ||
    event.defaultPrevented ||
    event.key !== 'Escape' ||
    event.isComposing
  )
    return
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
function previewSpeed(event: Event): void {
  window.clearTimeout(speedWheelTimer)
  speedWheelTimer = undefined
  const speed = Number((event.target as HTMLInputElement).value)
  speedPreview.value = speed === player.playbackSpeedConfig.speed ? null : speed
}
function commitSpeed(event: Event): void {
  setPlaybackSpeed(Number((event.target as HTMLInputElement).value))
}
function setPlaybackSpeed(speed: number): void {
  window.clearTimeout(speedWheelTimer)
  speedWheelTimer = undefined
  speedPreview.value = null
  const enabled = speed !== 1
  if (speed === player.playbackSpeedConfig.speed && enabled === player.playbackSpeedConfig.enabled)
    return
  player.playbackSpeedConfig = { speed, enabled }
  void player.setPlaybackSpeed()
}
function changeSpeed(event: WheelEvent): void {
  event.preventDefault()
  if (event.deltaY === 0) return
  const next = displayedSpeed.value + (event.deltaY < 0 ? 0.1 : -0.1)
  const speed = Math.round(Math.max(0.5, Math.min(2, next)) * 10) / 10
  speedPreview.value = speed
  window.clearTimeout(speedWheelTimer)
  speedWheelTimer = window.setTimeout(() => setPlaybackSpeed(speed), 120)
}
onUnmounted(() => {
  if (speedWheelTimer !== undefined) setPlaybackSpeed(displayedSpeed.value)
})
function changeVolume(event: WheelEvent): void {
  event.preventDefault()
  void player.setVolume(Math.max(0, Math.min(1, player.volume + (event.deltaY < 0 ? 0.05 : -0.05))))
}
function changeLyricsOffset(event: WheelEvent): void {
  event.preventDefault()
  player.setLyricsOffset(player.lyricsOffsetMs + (event.deltaY < 0 ? 100 : -100))
}
</script>

<template>
  <div class="fixed inset-0 z-40 isolate overflow-hidden bg-[#101416] text-text-l select-none">
    <div class="pointer-events-none absolute inset-0 z-0 overflow-hidden" aria-hidden="true">
      <div
        v-for="layer in backgroundLayers"
        :key="layer.key"
        class="panel-background-layer absolute inset-0"
        :class="{
          'panel-background-layer--incoming': incomingBackground?.key === layer.key,
          'panel-background-layer--revealing':
            incomingBackground?.key === layer.key && revealingBackground
        }"
        @animationend.self="completeBackgroundReveal"
      >
        <AlbumArtworkBackground
          v-if="layer.kind === PlayerBgType.ALBUM && layer.source"
          :src="layer.source"
          :style="{ transform: `scale(${1.1 + rhythmAmount * 0.1})` }"
          class="absolute -inset-10 size-[calc(100%_+_5rem)] transition-transform duration-[var(--motion-duration-fast)]"
          @load="albumBackgroundReady(layer, $event)"
          @error="handleCoverError"
        />
        <template v-else-if="layer.kind === PlayerBgType.LIQUID">
          <LiquidBackground
            class="liquid-background-canvas"
            :primary="coverColors.primary"
            :secondary="coverColors.secondary"
            :tertiary="coverColors.tertiary"
            :cover-src="liquidCoverSource"
            :energy="liquidEnergy"
            :bass="liquidBass"
            :beat="liquidBeat"
            :active="useLiquidBackground && player.isPlaying && isPanelVisible"
            :reduced-motion="player.rhythmVisualConfig.reducedMotion"
            @ready="backgroundReady(layer)"
            @unavailable="handleBackgroundUnavailable(layer)"
          />
          <div class="absolute inset-0 liquid-background-soften" />
        </template>
        <AmbientBubbleCanvas
          v-else-if="layer.kind === PlayerBgType.AMBIENT"
          :primary="coverColors.primary"
          :secondary="coverColors.secondary"
          :tertiary="coverColors.tertiary"
          :active="useAmbientBackground && shouldAnimate"
          :bubbles-enabled="
            player.rhythmVisualConfig.enabled &&
            !player.rhythmVisualConfig.reducedMotion &&
            !ui.reduceMotion
          "
          :reduced-motion="ui.reduceMotion || player.rhythmVisualConfig.reducedMotion"
          :energy="rhythmAmount"
          :beat-sequence="player.audioAnalysis.beatSequence"
          :intensity="ambientIntensity"
          @ready="backgroundReady(layer)"
        />
        <MeshFlowBackground
          v-else-if="layer.kind === PlayerBgType.MESH"
          :cover-src="coverFailed ? null : displayedCoverUrl"
          :primary="coverColors.primary"
          :secondary="coverColors.secondary"
          :tertiary="coverColors.tertiary"
          :active="useMeshBackground && ui.showPlayer && isPanelVisible"
          :reduced-motion="ui.reduceMotion || player.rhythmVisualConfig.reducedMotion"
          :energy="player.isPlaying ? liquidBass : 0"
          @ready="backgroundReady(layer)"
          @unavailable="handleBackgroundUnavailable(layer)"
        />
        <ParticleFlowBackground
          v-else-if="layer.kind === PlayerBgType.PARTICLES"
          :active="useParticleBackground && shouldAnimate"
          :reduced-motion="ui.reduceMotion || player.rhythmVisualConfig.reducedMotion"
          :energy="liquidEnergy"
          :bass="liquidBass"
          :beat="liquidBeat"
          :beat-sequence="player.audioAnalysis.beatSequence"
          @ready="backgroundReady(layer)"
          @unavailable="handleBackgroundUnavailable(layer)"
        />
        <StageBackground
          v-else
          :cover-src="!coverFailed && displayedCoverUrl === coverUrl ? displayedCoverUrl : null"
          :active="stageLightingActive"
          :analysis="player.audioAnalysis"
          :track-id="player.currentQueueSong?.id"
          :cheer-colors="ui.activePlayerCheerColors"
          :cheer-lights="ui.playerCheerLights"
          :intensity="player.rhythmVisualConfig.intensity"
          @ready="backgroundReady(layer)"
        />
      </div>
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
            class-name="size-6 panel-primary-text"
          />
        </button>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="ep-focusable pointer-events-auto grid size-9 place-items-center rounded-full bg-text/[0.08] transition hover:bg-text/15 [-webkit-app-region:no-drag]"
            :title="t('settings.playerBackground')"
            :aria-label="t('settings.playerBackground')"
            aria-haspopup="dialog"
            :aria-expanded="ui.showPlayerAppearance"
            @click="ui.showPlayerAppearance = true"
          >
            <SvgIcon name="common-settings" class-name="size-4 panel-primary-text" />
          </button>
          <button
            type="button"
            class="pointer-events-auto grid size-9 place-items-center rounded-full bg-text/[0.08] text-text transition hover:scale-105 [-webkit-app-region:no-drag]"
            :title="t('playerPanel.close')"
            :aria-label="t('playerPanel.close')"
            @click="close"
          >
            <SvgIcon name="common-close" class-name="size-4 panel-primary-text" />
          </button>
        </div>
      </header>

      <div
        class="player-panel-layout relative grid size-full overflow-hidden pt-16"
        :class="{
          'player-panel-layout--collapsed': collapsed,
          'player-panel-layout--bottom': ui.playerLayout === 'bottom'
        }"
      >
        <!-- metadata & control -->
        <section
          class="panel-side flex min-w-0 flex-col items-center justify-center gap-5 px-[clamp(1.5rem,4vw,4rem)] py-8 max-[760px]:border-r-0 max-[760px]:px-6 max-[760px]:py-6 max-[700px]:gap-4"
          :class="collapsed && 'panel-side--collapsed'"
        >
          <div class="panel-artwork">
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
              v-if="ui.showPlayerAudioDetails && audioDetails.length"
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
          </div>
          <div
            ref="controlsRef"
            class="panel-controls"
            :class="{
              'panel-controls--idle': controlsHidden,
              'panel-controls--reduce-motion': ui.reduceMotion
            }"
            @pointerenter="revealControls"
            @pointerleave="scheduleControlsHide"
            @pointerdown="startControlGesture"
            @focusin="onControlsFocus"
            @focusout="onControlsBlur"
          >
            <div v-if="controlsHidden" class="panel-idle-progress" aria-hidden="true">
              <SeekProgress v-slot="{ position }">
                <span
                  :style="{
                    width: `${player.durationMs > 0 ? Math.max(0, Math.min(1, position / player.durationMs)) * 100 : 0}%`
                  }"
                />
              </SeekProgress>
            </div>
            <!-- args control -->
            <div
              ref="toolsRef"
              :inert="controlsHidden"
              class="panel-tools flex w-full flex-nowrap items-center justify-center gap-1 text-xs"
            >
              <!-- song preference: neutral → liked → disliked → neutral -->
              <button
                v-show="isToolVisible('preference')"
                data-panel-tool="preference"
                :data-overflow-anchor="overflowTool === 'preference' || undefined"
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
                v-show="isToolVisible('speed')"
                :ref="(instance) => setToolTooltip('speed', instance)"
                data-panel-tool="speed"
                :data-overflow-anchor="overflowTool === 'speed' || undefined"
                interactive
                variant="control"
                :aria-label="t('playerPanel.speed')"
                @show="setControlPopup('speed', true)"
                @hide="setControlPopup('speed', false)"
                @wheel="changeSpeed"
              >
                <template #trigger="{ triggerProps }">
                  <button
                    type="button"
                    v-bind="triggerProps"
                    class="panel-tool"
                    :class="player.playbackSpeedConfig.speed !== 1 && 'active'"
                    :title="t('playerPanel.speed')"
                    :aria-label="t('playerPanel.speed')"
                  >
                    <svg-icon name="common-speed" class-name="w-[16px] h-[16px]" />
                  </button>
                </template>
                <b>{{ displayedSpeed.toFixed(1) }}×</b>
                <input
                  :aria-label="t('playerPanel.speed')"
                  type="range"
                  class="accent-primary"
                  min="0.5"
                  max="2"
                  step="0.1"
                  :value="displayedSpeed"
                  @input="previewSpeed"
                  @change="commitSpeed"
                />
              </BaseTooltip>
              <!-- lyrics timing -->
              <BaseTooltip
                v-show="isToolVisible('timing')"
                :ref="(instance) => setToolTooltip('timing', instance)"
                data-panel-tool="timing"
                :data-overflow-anchor="overflowTool === 'timing' || undefined"
                interactive
                variant="control"
                :aria-label="t('playerPanel.lyricTiming')"
                :control-width="96"
                :control-height="192"
                @show="setControlPopup('timing', true)"
                @hide="setControlPopup('timing', false)"
                @wheel="changeLyricsOffset"
              >
                <template #trigger="{ triggerProps }">
                  <button
                    type="button"
                    v-bind="triggerProps"
                    class="panel-tool"
                    :class="player.lyricsOffsetMs !== 0 && 'active'"
                    :title="t('playerPanel.lyricTiming')"
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
              <button
                type="button"
                class="panel-tool panel-tool--audio"
                :title="t('footer.audioControls')"
                :aria-label="t('footer.audioControls')"
                aria-haspopup="dialog"
                @click="eventBus.emit('openAudioControls')"
              >
                <SvgIcon name="common-equalizer" class-name="size-4" />
              </button>
              <button
                v-show="isToolVisible('play-mode')"
                data-panel-tool="play-mode"
                type="button"
                class="panel-tool"
                :class="playModeIcon === 'control-order' && 'panel-tool--order'"
                :title="playModeLabel"
                :aria-label="playModeLabel"
                @click="cyclePlayMode"
              >
                <SvgIcon :name="playModeIcon" class-name="size-4" />
              </button>
              <button
                v-show="isToolVisible('queue')"
                data-panel-tool="queue"
                type="button"
                class="panel-tool"
                :title="t('queue.title')"
                :aria-label="t('queue.title')"
                :aria-expanded="showQueue"
                aria-haspopup="dialog"
                :class="showQueue && 'active'"
                @click="showQueue = !showQueue"
              >
                <SvgIcon name="control-playlist" class-name="size-4" />
              </button>
            </div>
            <!-- progress -->
            <SeekProgress v-slot="{ position, formatted, preview, commit, cancel }">
              <div class="panel-progress w-[min(440px,100%)]">
                <BaseRange
                  class="ep-range ep-playback-progress w-full cursor-pointer disabled:cursor-default disabled:opacity-45"
                  :class="progressStyle === 'thin' ? 'h-1' : 'h-2.5'"
                  :min="0"
                  :max="player.durationMs || 0"
                  :value="position"
                  :disabled="!player.durationMs"
                  :aria-label="t('playerPanel.progress')"
                  :inert="controlsHidden"
                  @input="preview"
                  @change="commit"
                  @pointercancel="cancel"
                  @blur="cancel"
                />
                <div
                  class="panel-time panel-secondary-text flex justify-between text-xs tabular-nums"
                >
                  <span>{{ formatted }}</span>
                  <span class="panel-time-separator" aria-hidden="true">/</span>
                  <span>{{ player.durationFormatted }}</span>
                </div>
              </div>
            </SeekProgress>
            <!-- play control -->
            <div class="panel-transport flex items-center gap-4" :inert="controlsHidden">
              <!-- volume -->
              <BaseTooltip
                interactive
                variant="control"
                :aria-label="t('footer.volume')"
                @show="setControlPopup('volume', true)"
                @hide="setControlPopup('volume', false)"
                @wheel="changeVolume"
              >
                <template #trigger="{ triggerProps }">
                  <button
                    type="button"
                    v-bind="triggerProps"
                    class="panel-control-button panel-control-button--volume grid size-6 place-items-center rounded-full transition hover:scale-105"
                    :title="t('footer.volume')"
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
              <button
                class="panel-control-button grid size-6 place-items-center rounded-full transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
                :disabled="!player.queue.length"
                :title="t('playerPanel.previous')"
                @click="playPrevious"
              >
                <SvgIcon name="play-prev" class-name="size-6" />
              </button>
              <PlaybackButton
                size="large"
                :playing="player.isPlaying"
                :disabled="!player.currentFile"
                :label="player.isPlaying ? t('playerPanel.pause') : t('playerPanel.play')"
                @click="togglePlayback"
              />
              <button
                class="panel-control-button grid size-6 place-items-center rounded-full transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
                :disabled="!player.queue.length"
                :title="t('playerPanel.next')"
                @click="playNext"
              >
                <SvgIcon name="play-next" class-name="size-6" />
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
                @show="setControlPopup('more', true)"
                @hide="setControlPopup('more', false)"
              >
                <template #trigger>
                  <button
                    ref="moreButtonRef"
                    type="button"
                    class="panel-control-button grid size-6 place-items-center rounded-full transition hover:scale-105 disabled:cursor-not-allowed disabled:opacity-35"
                    :disabled="ui.playerLayout !== 'bottom' && !player.currentQueueSong"
                    :title="t('songList.more')"
                    :aria-label="t('songList.more')"
                  >
                    <SvgIcon name="menu-more-horizontal" class-name="size-6" />
                  </button>
                </template>
              </BaseMenu>
            </div>
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
            :current-time="lyricTime"
            :is-playing="player.isPlaying"
            :source-order="ui.lyricSourceOrder"
            :align-mode="collapsed ? 'center' : ui.lyricsAlignment"
            :forced-source="ui.lyricSourceMode"
            :auto-search-network="ui.autoSearchNetworkLyrics"
            :reload-token="lyricReloadToken"
            :layout-token="(ui.playerLayout === 'bottom' ? 2 : 0) + (collapsed ? 1 : 0)"
            :dark-text="useDarkLyrics && !ui.lyricsColors.overrideAutoContrast"
            @seek="seekTo"
          />
        </section>
      </div>
      <!-- play queue-->
      <PlayQueueDrawer v-model="showQueue" />
      <LyricsSearchDialog v-model="showLyricsSearch" />
      <PlayerAppearanceDrawer
        v-model="ui.showPlayerAppearance"
        :bpm="stageLightingActive ? player.audioAnalysis.bpm : 0"
      />
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
}
.liquid-background-canvas {
  filter: brightness(0.8) saturate(1.2) brightness(0.9) saturate(1.62) contrast(1.14);
}
.panel-tool {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-height: 1.65rem;
  padding: 0.18rem 0.35rem;
  border-radius: 0.45rem;
  background: rgb(255 255 255 / 0.07);
  transition:
    transform var(--motion-duration-fast) var(--motion-ease-standard),
    background-color var(--motion-duration-fast) var(--motion-ease-standard),
    color var(--motion-duration-fast) var(--motion-ease-standard),
    filter var(--motion-duration-fast) var(--motion-ease-standard);
}
.panel-control-button,
.panel-tool {
  color: rgb(255 255 255 / 72%);
}
:is(.panel-control-button, .panel-tool):enabled:is(:hover, :focus-visible),
.panel-tool.active {
  color: var(--panel-control-highlight, white);
}
.panel-tool:is(:hover, :focus-visible, .active) {
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
.panel-artwork,
.panel-controls {
  display: contents;
}
.panel-time-separator {
  display: none;
}
.player-panel-layout--bottom {
  --panel-control-highlight: var(--color-primary);
  grid-template-rows: minmax(0, 1fr) auto;
}
.player-panel-layout--bottom .panel-side {
  display: contents;
}
.player-panel-layout--bottom .panel-artwork {
  display: flex;
  grid-column: 1;
  grid-row: 1;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: clamp(0.6rem, 1.8vh, 1.25rem);
  padding: 1rem clamp(1.5rem, 4vw, 4rem);
  /* Let the aura fade beyond the cover column instead of clipping at its edge. */
  overflow: visible;
}
.player-panel-layout--bottom .panel-artwork :deep(.cover-frame) {
  width: calc(min(100%, 440px, max(96px, calc(100dvh - 24rem))) * 0.9);
  flex-shrink: 0;
}
.player-panel-layout--bottom .panel-artwork > div:not(.cover-frame) {
  max-width: 100%;
}
.player-panel-layout--bottom .panel-artwork dl {
  grid-template-columns: repeat(5, minmax(0, 1fr));
}
.player-panel-layout--bottom .panel-lyrics {
  grid-column: 2;
  grid-row: 1;
  min-height: 0;
  border: 0;
}
.player-panel-layout--bottom .panel-controls {
  position: relative;
  z-index: 1;
  display: grid;
  grid-column: 1 / -1;
  grid-row: 2;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem 1rem;
  padding: 0.75rem 0;
}
.player-panel-layout--bottom .panel-transport,
.player-panel-layout--bottom .panel-tools {
  transition:
    opacity 320ms ease,
    visibility 320ms ease;
}
.player-panel-layout--bottom .panel-controls--idle .panel-transport,
.player-panel-layout--bottom .panel-controls--idle .panel-tools,
.player-panel-layout--bottom .panel-controls--idle .ep-playback-progress {
  opacity: 0;
  visibility: hidden;
  pointer-events: none;
}
.panel-idle-progress {
  position: absolute;
  inset: -3px 0 auto;
  height: 3px;
  pointer-events: none;
}
.panel-idle-progress span {
  display: block;
  height: 100%;
  background: var(--color-primary);
}
.player-panel-layout--bottom .panel-controls--reduce-motion .panel-transport,
.player-panel-layout--bottom .panel-controls--reduce-motion .panel-tools {
  transition: none;
}
@media (prefers-reduced-motion: reduce) {
  .player-panel-layout--bottom .panel-transport,
  .player-panel-layout--bottom .panel-tools {
    transition: none;
  }
}
.player-panel-layout--bottom .panel-progress {
  display: contents;
}
.player-panel-layout--bottom .ep-playback-progress {
  --ep-range-track-height: 3px;
  position: absolute;
  top: -3px;
  left: 0;
  margin: 0;
  width: 100%;
  height: 3px;
}
.player-panel-layout--bottom .panel-time {
  grid-column: 1;
  grid-row: 1;
  justify-content: flex-start;
  gap: 0.5rem;
  padding-left: clamp(1rem, 3vw, 3rem);
  white-space: nowrap;
  font-size: 0.875rem;
  line-height: 1.5;
}
.player-panel-layout--bottom .panel-time-separator {
  display: inline;
  opacity: 0.5;
}
.player-panel-layout--bottom .panel-transport {
  grid-column: 2;
  grid-row: 1;
  justify-self: center;
  gap: 0.875rem;
}
.player-panel-layout--bottom .panel-transport :deep(.playback-button) {
  width: 2.75rem;
  height: 2.75rem;
}
.player-panel-layout--bottom .panel-transport :deep(.playback-button-icon) {
  width: 20px;
  height: 20px;
}
.player-panel-layout--bottom .panel-tools {
  position: relative;
  grid-column: 3;
  grid-row: 1;
  min-width: 0;
  flex-wrap: nowrap;
  justify-content: flex-end;
  gap: 2px;
  padding-right: clamp(1rem, 3vw, 3rem);
}
.player-panel-layout--bottom .panel-tools > * {
  flex: 0 0 28px;
}
.player-panel-layout--bottom .panel-tools [data-overflow-anchor] {
  position: absolute;
  left: var(--panel-overflow-left, 0px);
  top: var(--panel-overflow-top, 0px);
  opacity: 0;
  pointer-events: none;
}
.panel-control-button {
  width: 28px;
  height: 28px;
  padding: 0;
}
.panel-control-button :deep(svg) {
  width: 20px;
  height: 20px;
}
.panel-control-button--volume :deep(svg) {
  width: 26px;
  height: 26px;
  translate: 1px 0;
}
.player-panel-layout--bottom .panel-tool {
  width: 28px;
  height: 28px;
  justify-content: center;
  padding: 0.25rem;
  background: transparent;
}
.player-panel-layout--bottom .panel-tool :deep(svg) {
  width: 20px;
  height: 20px;
}
.panel-tool :deep(svg) {
  scale: var(--panel-tool-icon-scale, 1);
  translate: var(--panel-tool-icon-offset, 0 0);
}
/* The source SVGs have different amounts of whitespace around their paths. */
.panel-tools [data-panel-tool='speed'] {
  --panel-tool-icon-scale: 1.25;
  --panel-tool-icon-offset: -0.7px 0;
}
.panel-tool--audio {
  --panel-tool-icon-scale: 0.85;
  --panel-tool-icon-offset: 0 0.15px;
}
.panel-tools [data-panel-tool='timing'] {
  --panel-tool-icon-scale: 0.9;
}
.panel-tool--order {
  --panel-tool-icon-scale: 1.2;
  --panel-tool-icon-offset: 0 1.1px;
}
.panel-tools [data-panel-tool='queue'] {
  --panel-tool-icon-scale: 1.08;
  --panel-tool-icon-offset: -0.2px -1px;
}
.player-panel-layout--bottom .panel-tool:is(:hover, :focus-visible, .active) {
  background: transparent;
  filter: none;
}
.player-panel-layout--bottom .panel-side--collapsed {
  pointer-events: auto;
}
.player-panel-layout--bottom .panel-side--collapsed .panel-artwork {
  visibility: hidden;
  pointer-events: none;
}
@media (max-width: 1200px) {
  .player-panel-layout--bottom .panel-controls {
    gap: 0.5rem;
    padding-bottom: 0.75rem;
  }
  .player-panel-layout--bottom .panel-artwork :deep(.cover-frame) {
    width: calc(min(100%, 380px, max(96px, calc(100dvh - 24rem))) * 0.9);
  }
}
@media (max-width: 700px) {
  .player-panel-layout--bottom .panel-transport {
    grid-column: 1 / -1;
  }
  .player-panel-layout--bottom .panel-time {
    grid-column: 1;
    grid-row: 2;
  }
  .player-panel-layout--bottom .panel-tools {
    grid-column: 2 / -1;
    grid-row: 2;
  }
}
@media (max-width: 760px) {
  .player-panel-layout--bottom .panel-artwork {
    padding-inline: 1rem;
  }
  .player-panel-layout--bottom .panel-artwork h2 {
    font-size: 1.125rem;
  }
  .player-panel-layout--bottom .panel-transport {
    gap: clamp(0.625rem, 2vw, 0.875rem);
  }
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
.panel-background-layer {
  background: #101416;
}
.panel-background-layer--incoming {
  opacity: 0;
}
.panel-background-layer--revealing {
  animation: panel-background-reveal 700ms cubic-bezier(0.22, 0.61, 0.36, 1) forwards;
}
@keyframes panel-background-reveal {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .panel-background-layer--revealing {
    animation-duration: 1ms;
  }
}
</style>
