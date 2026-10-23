import { computed, nextTick, ref, watch } from 'vue'
import { flushPlayerDataStorage } from '@/stores/persistence'
import { defineStore } from 'pinia'
import { shallowRef } from 'vue'
import type {
  AudioChainStatus,
  ChannelMatrixConfig,
  CrossfeedConfig,
  ChorusConfig,
  CompressorConfig,
  DelayConfig,
  DeviceInfo,
  DspNodeConfig,
  EqBand,
  ImpulseResponseConfig,
  NoiseGateConfig,
  PhaserConfig,
  PlaybackState,
  ResamplerConfig,
  StereoFieldConfig,
  TrackInfo,
  TransitionConfig
} from '@/types/audio'
import { audioBridge } from '@/services/audioBridge'
import { selectSmartNext } from './smartShuffle'
import { useLogStore } from '@/stores/log/logStore'
import { useUIStore } from '@/stores/ui/uiStore'
import { useStatisticsStore } from '@/stores/statistics/statisticsStore'
import { useMessage } from '@/components/ui/useMessage'
import { t } from '@/i18n'
import { PlayMode } from '@/consts'
import type { LibrarySong } from '@/types/library'
import eventBus from '@/utils/eventBus'

export const usePlayerStore = defineStore('player', () => {
  const { warning, success, info } = useMessage()
  const ui = useUIStore()
  const statistics = useStatisticsStore()
  // ── State ──
  const playbackModeChanging = ref(false)
  const state = ref<PlaybackState>('idle')
  const positionMs = ref(0)
  const durationMs = ref(0)
  const volume = ref(1.0)
  const glitchCount = ref(0)
  const trackInfo = ref<TrackInfo | null>(null)
  const currentFile = ref<string | null>(null)
  const currentBackend = ref<string>('directsound')
  const devices = ref<DeviceInfo[]>([])
  const currentDeviceId = ref('default')
  const audioChain = ref<AudioChainStatus | null>(null)
  // Analysis snapshots arrive frequently and contain a spectrum array. Keep
  // the snapshot shallow so every IPC result does not create a deep proxy tree
  // that V8 retains in its expanded old-space heap after the visual closes.
  const audioAnalysis = shallowRef({
    outputTimeMs: 0,
    analysisTimeMs: 0,
    analysisLatencyMs: 0,
    rms: 0,
    lowEnergy: 0,
    onsetStrength: 0,
    droppedFrames: 0,
    clipGuardLimitedFrames: 0,
    clipGuardReductionDb: 0,
    beatSequence: 0,
    bpm: 0,
    momentaryLufs: -70,
    shortTermLufs: -70,
    integratedLufs: -70,
    spectrum: Array.from({ length: 64 }, () => 0)
  })
  const rhythmVisualConfig = ref({ enabled: true, intensity: 0.65, reducedMotion: false })
  const preampEnabled = ref(false)
  const preampDb = ref(0)
  const replayGainConfig = ref<{
    mode: 'off' | 'track' | 'album'
    preventClipping: boolean
    active: boolean
    appliedGainDb: number
  }>({ mode: 'off', preventClipping: true, active: false, appliedGainDb: 0 })
  const playbackSpeedConfig = ref({ enabled: false, speed: 1 })
  const eqBands = ref<EqBand[]>(createDefaultEqBands())
  const resamplerConfig = ref<ResamplerConfig>({
    forceOutputRate: false,
    targetSampleRate: 48000,
    quality: 'best'
  })
  const dopEnabled = ref(false)
  const transitionConfig = ref<TransitionConfig>({
    gaplessEnabled: true,
    crossfadeEnabled: false,
    crossfadeMs: 5000,
    crossfadeAuto: false,
    crossfadeVocalCue: true,
    pauseFadeEnabled: true,
    pauseFadeMs: 180
  })
  const dspNodes = ref<DspNodeConfig[]>([
    { id: 'channel_matrix', enabled: false },
    { id: 'replay_gain', enabled: false },
    { id: 'preamp', enabled: false },
    { id: 'eq', enabled: false },
    { id: 'compressor', enabled: false },
    { id: 'delay', enabled: false },
    { id: 'reverb', enabled: false },
    { id: 'chorus', enabled: false },
    { id: 'noise_gate', enabled: false },
    { id: 'phaser', enabled: false },
    { id: 'stereo_field', enabled: false },
    { id: 'crossfeed', enabled: false },
    { id: 'impulse_response', enabled: false },
    { id: 'limiter', enabled: false }
  ])
  const compressorConfig = ref<CompressorConfig>({
    thresholdDb: -18,
    ratio: 4,
    attackMs: 10,
    releaseMs: 100,
    makeupDb: 0
  })
  const delayConfig = ref<DelayConfig>({ delayMs: 250, feedback: 0.25, mix: 0.2 })
  const reverbConfig = ref({ roomSize: 0.5, decay: 0.4, mix: 0.15 })
  const limiterConfig = ref({ enabled: false, ceilingDb: -1, releaseMs: 80 })
  const chorusConfig = ref<ChorusConfig>({ rateHz: 0.8, depthMs: 8, mix: 0.35 })
  const noiseGateConfig = ref<NoiseGateConfig>({
    thresholdDb: -50,
    attackMs: 5,
    holdMs: 50,
    releaseMs: 150,
    rangeDb: -80
  })
  const phaserConfig = ref<PhaserConfig>({
    rateHz: 0.4,
    depth: 0.6,
    centerHz: 800,
    feedback: 0.2,
    mix: 0.5
  })
  const channelMatrixConfig = ref<ChannelMatrixConfig>({
    enabled: false,
    balance: 0,
    swapStereo: false,
    monoDownmix: false,
    outputGains: [1, 1, 1, 1, 1, 1, 1, 1]
  })
  const stereoFieldConfig = ref<StereoFieldConfig>({
    enabled: false,
    midDb: 0,
    sideDb: 0,
    width: 1
  })
  const crossfeedConfig = ref<CrossfeedConfig>({
    enabled: false,
    strength: 0.5,
    cutoffHz: 700,
    delayMs: 0.25
  })
  const impulseResponseConfig = ref<ImpulseResponseConfig>({
    enabled: false,
    path: '',
    autoGain: true,
    gainDb: 0,
    autoPreampDb: 0
  })
  const queue = ref<LibrarySong[]>([])
  const queuePlaylistId = ref<number | null>(null)
  const currentQueueIndex = ref(-1)
  const playMode = ref<PlayMode>(PlayMode.List)
  const smartShuffleEnabled = ref(false)
  const shufflePlayedSongIds = new Set<number>()
  let normalShuffleOrder: number[] | null = null
  let normalShuffleStartsRound = false
  const shuffleHistory: number[] = []
  let shuffleHistoryIndex = -1
  const shuffleNavigationRevision = ref(0)
  const recommendationScores = new Map<
    number,
    { weight: number; plays: number; preference: number }
  >()
  let recommendationRevision = 0
  let shuffleReservation: {
    songId: number
    sourceSongId: number | undefined
    startsRound: boolean
  } | null = null
  const unavailableSongIds = new Set<number>()
  let queueRevision = 0
  let queuePlaybackInProgress = false
  let playbackEpoch = 0
  const stopAfterCurrent = ref(false)
  let preparedNextIndex = -1
  let preparedNextPath = ''
  let preparedNextSongId: number | undefined
  const resolvedQueuePaths = new Map<number, string>()
  let nextTrackRequest: {
    sourceFile: string | null
    path: string
    ready: Promise<boolean>
  } | null = null
  let nextTrackRevision = 0
  let playbackSessionTimer: ReturnType<typeof setTimeout> | undefined
  let deferredRestore: { filePath: string; positionMs: number } | null = null
  let historySession:
    | {
        songId: number
        eventStartedAt: number
        totalMs: number
        playingSince: number | null
        startOrigin: 'automatic' | 'manual' | 'search' | 'return' | 'recommendation'
        statisticsGeneration: string
      }
    | undefined

  function beginHistory(
    song: LibrarySong,
    startOrigin: 'automatic' | 'manual' | 'search' | 'return' | 'recommendation' = 'automatic'
  ): void {
    if (ui.extremePlayback || !statistics.enabled) return
    if (historySession?.songId === song.id) {
      resumeHistory()
      return
    }
    flushHistory(true, 'selected')
    const now = Date.now()
    historySession = {
      songId: song.id,
      eventStartedAt: now,
      totalMs: 0,
      playingSince: now,
      startOrigin,
      statisticsGeneration: statistics.generation
    }
    void window.api.database.command('savePlayHistory', {
      songId: song.id,
      startedAt: now,
      startOrigin,
      statisticsGeneration: statistics.generation
    })
  }
  function resumeHistory(): void {
    if (ui.extremePlayback || !statistics.enabled) return
    if (historySession && historySession.playingSince === null)
      historySession.playingSince = Date.now()
  }
  function pauseHistory(): void {
    if (!historySession?.playingSince) return
    const elapsed = Date.now() - historySession.playingSince
    historySession.totalMs += elapsed
    historySession.playingSince = null
  }
  function flushHistory(
    finalize = false,
    reason: 'ended' | 'next' | 'previous' | 'selected' | 'stopped' | 'closed' = 'stopped'
  ): void {
    if (!historySession) return
    if (!statistics.enabled || historySession.statisticsGeneration !== statistics.generation) {
      historySession = undefined
      return
    }
    pauseHistory()
    if (finalize) {
      const session = historySession
      void window.api.database
        .command('recordPlayEvent', {
          songId: session.songId,
          startedAt: session.eventStartedAt,
          playedMs: session.totalMs,
          durationMs: durationMs.value,
          endReason: reason,
          startOrigin: session.startOrigin,
          statisticsGeneration: session.statisticsGeneration
        })
        .then(() => loadRecommendationScores())
      historySession = undefined
    }
  }

  async function loadRecommendationScores(): Promise<void> {
    if (ui.extremePlayback || !statistics.enabled) return
    const generation = statistics.generation
    const revision = ++recommendationRevision
    const response = await window.api.database.command('getRecommendationScores')
    if (
      revision !== recommendationRevision ||
      ui.extremePlayback ||
      !statistics.enabled ||
      generation !== statistics.generation
    )
      return
    if (!response.success) return
    recommendationScores.clear()
    for (const score of response.data as Array<{
      songId: number
      weight: number
      engagedPlays: number
      recentEngagedPlays: number
      preference: number
    }>)
      recommendationScores.set(score.songId, {
        weight: score.weight,
        plays: score.recentEngagedPlays,
        preference: score.preference
      })
    shuffleNavigationRevision.value++
    if (playMode.value === PlayMode.Random && smartShuffleEnabled.value && !ui.extremePlayback) {
      void syncNextTrack()
    }
  }

  async function setPreference(songId: number, preference: -1 | 0 | 1): Promise<boolean> {
    const result = await window.api.database.command('setSongPreference', { songId, preference })
    if (result.success) {
      for (const song of queue.value) if (song.id === songId) song.preference = preference
      shuffleNavigationRevision.value++
      if (preference === 0) info(t('recommendation.feedbackCleared'))
      else
        success(
          t(preference === 1 ? 'recommendation.likeSaved' : 'recommendation.lessRecommendedSaved')
        )
      eventBus.emit('songPreferenceChanged', { songId, preference })
      await loadRecommendationScores()
    }
    return result.success
  }

  function getSongPreference(songId: number): number {
    // The revision also refreshes the current-song feedback controls.
    void shuffleNavigationRevision.value
    return (
      recommendationScores.get(songId)?.preference ??
      queue.value.find((song) => song.id === songId)?.preference ??
      0
    )
  }

  async function resetSongRecommendation(songId: number): Promise<boolean> {
    const result = await window.api.database.command('resetSongRecommendation', { songId })
    if (!result.success) return false
    for (const song of queue.value) if (song.id === songId) song.preference = 0
    recommendationScores.delete(songId)
    shuffleNavigationRevision.value++
    eventBus.emit('songPreferenceChanged', { songId, preference: 0 })
    success(t('recommendation.scoreReset'))
    await loadRecommendationScores()
    return true
  }

  async function loadSmartShuffleConfig(): Promise<void> {
    try {
      const response = await window.api.database.command('getSetting', {
        key: 'player.smart-shuffle-enabled'
      })
      if (response.success) smartShuffleEnabled.value = response.data === true
    } catch {
      // A missing preference must not interrupt player startup.
    }
  }

  async function setSmartShuffleEnabled(enabled: boolean): Promise<void> {
    const response = await window.api.database.command('setSetting', {
      key: 'player.smart-shuffle-enabled',
      value: enabled
    })
    if (!response.success) return
    smartShuffleEnabled.value = enabled
    normalShuffleOrder = null
    normalShuffleStartsRound = false
    shuffleReservation = null
    shuffleNavigationRevision.value++
    if (playMode.value === PlayMode.Random) void syncNextTrack()
  }

  function finishHistoryOnUnload(): void {
    if (!historySession) return
    if (!statistics.enabled || historySession.statisticsGeneration !== statistics.generation) {
      historySession = undefined
      return
    }
    pauseHistory()
    const session = historySession
    window.api.database.recordPlayEventSync({
      songId: session.songId,
      startedAt: session.eventStartedAt,
      playedMs: session.totalMs,
      durationMs: durationMs.value,
      endReason: 'closed',
      startOrigin: session.startOrigin,
      statisticsGeneration: session.statisticsGeneration
    })
    historySession = undefined
  }

  // ── Computed ──
  const isPlaying = computed(() => state.value === 'playing')
  const isPaused = computed(() => state.value === 'paused')
  const progress = computed(() => (durationMs.value > 0 ? positionMs.value / durationMs.value : 0))
  const positionFormatted = computed(() => formatTime(positionMs.value))
  const durationFormatted = computed(() => formatTime(durationMs.value))
  const currentQueueSong = computed(() => queue.value[currentQueueIndex.value] ?? null)
  watch(
    () => statistics.generation,
    () => {
      historySession = undefined
      recommendationScores.clear()
      normalShuffleOrder = null
      normalShuffleStartsRound = false
      shuffleReservation = null
      shuffleNavigationRevision.value++
      if (statistics.enabled && !ui.extremePlayback) {
        if (isPlaying.value && currentQueueSong.value) beginHistory(currentQueueSong.value)
        void loadRecommendationScores()
      }
      void syncNextTrack()
    },
    { flush: 'sync' }
  )
  const queueTransitionEntries = computed(() =>
    queue.value.map((song) => [song.id, song.audio, song.songStatus, song.sourceId])
  )

  // ── Actions ──
  async function openFile(filePath: string): Promise<boolean> {
    playbackEpoch++
    deferredRestore = null
    nextTrackRevision++
    preparedNextIndex = -1
    preparedNextPath = ''
    preparedNextSongId = undefined
    nextTrackRequest = null
    currentFile.value = filePath
    const ok = await audioBridge.open(filePath)
    if (ok) {
      const status = await audioBridge.getStatus()
      if (status) {
        trackInfo.value = status.trackInfo
        durationMs.value = status.durationMs
      }
      // ReplayGain is resolved from the newly opened track's metadata by the
      // native decoder, so the startup snapshot is no longer authoritative.
      await loadReplayGain()
      await refreshAudioChain()
      await savePlaybackSession()
    }
    return ok
  }

  async function play(
    startOrigin: 'automatic' | 'manual' | 'search' | 'return' | 'recommendation' = 'automatic'
  ): Promise<boolean> {
    if (deferredRestore) {
      const restore = deferredRestore
      deferredRestore = null
      if (!(await openFile(restore.filePath))) return false
      if (restore.positionMs > 0 && !(await seek(restore.positionMs))) return false
    }
    const result = await audioBridge.play()
    if (result && currentQueueSong.value) beginHistory(currentQueueSong.value, startOrigin)
    if (result && preparedNextIndex < 0) void syncNextTrack()
    return result
  }

  function setPlayMode(mode: PlayMode): void {
    playMode.value = mode
    shuffleReservation = null
    shufflePlayedSongIds.clear()
    normalShuffleOrder = null
    normalShuffleStartsRound = false
    shuffleHistory.length = 0
    shuffleHistoryIndex = -1
    if (mode === PlayMode.Random && currentQueueSong.value) {
      shufflePlayedSongIds.add(currentQueueSong.value.id)
      shuffleHistory.push(currentQueueSong.value.id)
      shuffleHistoryIndex = 0
    }
    shuffleNavigationRevision.value++
    schedulePlaybackSessionSave()
    void syncNextTrack()
  }

  function addToQueue(songs: LibrarySong[], insertAfterCurrent = false): void {
    const existingIds = new Set(queue.value.map((song) => song.id))
    const additions = songs.filter((song) => {
      if (existingIds.has(song.id)) return false
      existingIds.add(song.id)
      return true
    })
    if (!additions.length) return
    if (insertAfterCurrent && currentQueueIndex.value >= 0) {
      queue.value.splice(currentQueueIndex.value + 1, 0, ...additions)
      schedulePlaybackSessionSave()
      return
    }
    queue.value.push(...additions)
    schedulePlaybackSessionSave()
  }

  function setQueue(songs: LibrarySong[], playlistId: number | null = null): void {
    queueRevision++
    const ids = new Set<number>()
    queue.value = songs.filter((song) => {
      if (ids.has(song.id)) return false
      ids.add(song.id)
      return true
    })
    queuePlaylistId.value = playlistId
    currentQueueIndex.value = -1
    unavailableSongIds.clear()
    resolvedQueuePaths.clear()
    shufflePlayedSongIds.clear()
    normalShuffleOrder = null
    normalShuffleStartsRound = false
    shuffleHistory.length = 0
    shuffleHistoryIndex = -1
    shuffleReservation = null
    shuffleNavigationRevision.value++
    savePlaybackSessionSync()
    void loadRecommendationScores()
  }

  function displaySongName(song: LibrarySong): string {
    return (
      song.title?.trim() ||
      song.fileName?.trim() ||
      song.audio.split(/[\\/]/).pop()?.trim() ||
      t('queue.unknownTrack')
    )
  }

  async function tryPlayQueueItem(
    index: number,
    startOrigin: 'automatic' | 'manual' | 'search' | 'return' | 'recommendation',
    consumeShuffle = true,
    revision = queueRevision
  ): Promise<boolean> {
    const song = queue.value[index]
    if (!song) return false
    const startsRound = shuffleReservation?.songId === song.id && shuffleReservation.startsRound
    const songName = displaySongName(song)
    if (song.songStatus === 0) {
      warning(t('queue.trackSkipped', { title: songName }))
      return false
    }
    currentQueueIndex.value = index
    savePlaybackSessionSync()
    let remoteFile: { success: boolean; data?: string; error?: string } | null = null
    try {
      remoteFile = song.sourceId ? await window.api.remoteSource.cacheSong(song.id) : null
    } catch (error) {
      remoteFile = { success: false, error: String(error) }
    }
    if (revision !== queueRevision || !queue.value.some((item) => item.id === song.id)) return false
    if (song.sourceId && (!remoteFile?.success || !remoteFile.data)) {
      console.warn('[player] Unable to cache remote song:', remoteFile?.error)
      warning(t('queue.trackSkipped', { title: songName }))
      useLogStore().addEntry({
        level: 'warn',
        message: `Skipping unavailable remote track “${songName}”: ${remoteFile?.error || 'cache failed'}`,
        timestamp: Date.now()
      })
      return false
    }
    const path = remoteFile?.data || song.audio
    resolvedQueuePaths.set(song.id, path)
    const opened = await openFile(path)
    if (revision !== queueRevision || !queue.value.some((item) => item.id === song.id)) return false
    currentQueueIndex.value = queue.value.findIndex((item) => item.id === song.id)
    const started = opened && (await play(startOrigin))
    if (revision !== queueRevision || !queue.value.some((item) => item.id === song.id)) return false
    currentQueueIndex.value = queue.value.findIndex((item) => item.id === song.id)
    if (started) {
      if (playMode.value === PlayMode.Random && consumeShuffle)
        recordShufflePlayed(currentQueueIndex.value, startsRound)
      beginHistory(song, startOrigin)
      return true
    }
    warning(t('queue.trackSkipped', { title: songName }))
    useLogStore().addEntry({
      level: 'warn',
      message: `Skipping unplayable track “${songName}”`,
      timestamp: Date.now()
    })
    return false
  }

  /**
   * Starts the requested queue item, then keeps advancing through distinct candidates
   * when a local file is missing or a remote source cannot provide its cached stream.
   */
  async function playQueueItem(
    index: number,
    historyIndex = -1,
    reason: 'next' | 'previous' | 'selected' = 'selected',
    startOrigin: 'automatic' | 'manual' | 'search' | 'return' | 'recommendation' = reason ===
    'previous'
      ? 'return'
      : 'manual'
  ): Promise<boolean> {
    if (index < 0 || index >= queue.value.length) return false
    if (queuePlaybackInProgress) return false
    if (reason === 'selected') unavailableSongIds.delete(queue.value[index].id)
    queuePlaybackInProgress = true
    const revision = queueRevision
    const requestedId = queue.value[index].id
    try {
      await stop(reason, true)
      if (revision !== queueRevision) return false
      const attempted = new Set<number>()
      let candidate = index
      while (
        candidate >= 0 &&
        queue.value[candidate] &&
        !attempted.has(queue.value[candidate].id)
      ) {
        const candidateId = queue.value[candidate].id
        attempted.add(candidateId)
        if (
          await tryPlayQueueItem(
            candidate,
            candidateId === requestedId ? startOrigin : 'automatic',
            candidateId !== requestedId || (historyIndex < 0 && reason !== 'previous'),
            revision
          )
        ) {
          if (playMode.value === PlayMode.Random) {
            const songId = candidateId
            if (historyIndex >= 0 && shuffleHistory[historyIndex] === songId) {
              shuffleHistoryIndex = historyIndex
            } else {
              shuffleHistory.splice(shuffleHistoryIndex + 1)
              shuffleHistory.push(songId)
              shuffleHistoryIndex = shuffleHistory.length - 1
            }
            shuffleNavigationRevision.value++
            savePlaybackSessionSync()
          }
          return true
        }
        if (revision !== queueRevision) return false
        unavailableSongIds.add(candidateId)
        shuffleReservation = null
        candidate = nextIndex(
          new Set(queue.value.flatMap((song, index) => (attempted.has(song.id) ? [index] : [])))
        )
      }
      currentFile.value = null
      trackInfo.value = null
      positionMs.value = 0
      durationMs.value = 0
      state.value = 'stopped'
      savePlaybackSessionSync()
      return false
    } finally {
      queuePlaybackInProgress = false
      void syncNextTrack()
    }
  }

  async function playCollection(
    songs: LibrarySong[],
    songId: number | null,
    playlistId: number | null = null,
    startOrigin: 'manual' | 'search' | 'recommendation' = 'manual'
  ): Promise<boolean> {
    if (queuePlaybackInProgress) return false
    setQueue(songs, playlistId)
    const revision = queueRevision
    if (playMode.value === PlayMode.Random && !usesNormalShuffle()) await loadRecommendationScores()
    if (revision !== queueRevision) return false
    const playable = queue.value
      .map((song, index) => ({ song, index }))
      .filter(({ song }) => song.songStatus !== 0)
    const index =
      songId === null
        ? playMode.value === PlayMode.Random
          ? usesNormalShuffle()
            ? nextNormalShuffleIndex(new Set())
            : selectSmartNext(queue.value, -1, new Set(), recommendationScores)
          : (playable[0]?.index ?? -1)
        : queue.value.findIndex((song) => song.id === songId)
    return index >= 0 ? playQueueItem(index, -1, 'selected', startOrigin) : false
  }

  function moveQueueItem(from: number, to: number): void {
    if (from === to || from < 0 || to < 0 || from >= queue.value.length || to >= queue.value.length)
      return
    const [song] = queue.value.splice(from, 1)
    queue.value.splice(to, 0, song)
    if (currentQueueIndex.value === from) currentQueueIndex.value = to
    else if (from < currentQueueIndex.value && to >= currentQueueIndex.value)
      currentQueueIndex.value--
    else if (from > currentQueueIndex.value && to <= currentQueueIndex.value)
      currentQueueIndex.value++
    schedulePlaybackSessionSave()
  }

  async function removeQueueItem(index: number): Promise<void> {
    if (index < 0 || index >= queue.value.length) return
    const isCurrent = index === currentQueueIndex.value
    const [removed] = queue.value.splice(index, 1)
    if (removed) {
      shufflePlayedSongIds.delete(removed.id)
      for (let i = shuffleHistory.length - 1; i >= 0; i--) {
        if (shuffleHistory[i] !== removed.id) continue
        shuffleHistory.splice(i, 1)
        if (i <= shuffleHistoryIndex) shuffleHistoryIndex--
      }
      shuffleNavigationRevision.value++
    }
    if (index < currentQueueIndex.value) currentQueueIndex.value--
    if (!isCurrent) {
      schedulePlaybackSessionSave()
      return
    }
    if (!queue.value.length) {
      currentQueueIndex.value = -1
      await stop()
      queuePlaylistId.value = null
      currentFile.value = null
      trackInfo.value = null
      positionMs.value = 0
      durationMs.value = 0
      deferredRestore = null
      savePlaybackSessionSync()
      return
    }
    currentQueueIndex.value =
      playMode.value === PlayMode.Random ? -1 : Math.min(index, queue.value.length - 1)
    schedulePlaybackSessionSave()
    await playQueueItem(playMode.value === PlayMode.Random ? nextIndex() : currentQueueIndex.value)
  }

  function clearQueue(): void {
    queueRevision++
    unavailableSongIds.clear()
    resolvedQueuePaths.clear()
    queue.value = []
    queuePlaylistId.value = null
    currentQueueIndex.value = -1
    shufflePlayedSongIds.clear()
    normalShuffleOrder = null
    normalShuffleStartsRound = false
    shuffleHistory.length = 0
    shuffleHistoryIndex = -1
    shuffleReservation = null
    shuffleNavigationRevision.value++
    schedulePlaybackSessionSave()
    void syncNextTrack()
  }

  // Previews and gapless preparation share a reservation. Only playback
  // commits a new round; asking for the next item never consumes played IDs.
  function recordShufflePlayed(
    index: number,
    startsRound = shuffleReservation?.songId === queue.value[index]?.id &&
      shuffleReservation.startsRound
  ): void {
    if (usesNormalShuffle()) {
      if (normalShuffleStartsRound) {
        shufflePlayedSongIds.clear()
        normalShuffleStartsRound = false
      }
      normalShuffleOrder = normalShuffleOrder?.filter((id) => id !== queue.value[index].id) ?? null
      shufflePlayedSongIds.add(queue.value[index].id)
      shuffleReservation = null
      return
    }
    if (startsRound) {
      shufflePlayedSongIds.clear()
    }
    shufflePlayedSongIds.add(queue.value[index].id)
    shuffleReservation = null
  }

  function usesNormalShuffle(): boolean {
    return !smartShuffleEnabled.value || !statistics.enabled || ui.extremePlayback
  }

  function shuffledIds(ids: number[]): number[] {
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[ids[i], ids[j]] = [ids[j], ids[i]]
    }
    return ids
  }

  function nextNormalShuffleIndex(excluded: Set<number>): number {
    const playable = queue.value.filter(
      (song) => song.songStatus !== 0 && !unavailableSongIds.has(song.id)
    )
    const validIds = new Set(playable.map((song) => song.id))
    normalShuffleOrder =
      normalShuffleOrder?.filter(
        (id) => validIds.has(id) && (normalShuffleStartsRound || !shufflePlayedSongIds.has(id))
      ) ?? null
    const remaining = playable.filter((song) => !shufflePlayedSongIds.has(song.id))
    if (normalShuffleOrder === null) {
      normalShuffleOrder = shuffledIds(remaining.map((song) => song.id))
    } else {
      // Queue additions join the current round once; moving items does not
      // change the permutation because it stores song IDs rather than indices.
      const ordered = new Set(normalShuffleOrder)
      for (const song of normalShuffleStartsRound ? playable : remaining) {
        if (!ordered.has(song.id)) {
          const position = Math.floor(Math.random() * (normalShuffleOrder.length + 1))
          normalShuffleOrder.splice(position, 0, song.id)
          ordered.add(song.id)
        }
      }
    }
    if (!normalShuffleOrder.length && playable.length) {
      normalShuffleOrder = shuffledIds(playable.map((song) => song.id))
      normalShuffleStartsRound = true
      // Prevent the boundary from immediately repeating the previous song.
      if (normalShuffleOrder.length > 1 && normalShuffleOrder[0] === currentQueueSong.value?.id) {
        const swap = 1 + Math.floor(Math.random() * (normalShuffleOrder.length - 1))
        ;[normalShuffleOrder[0], normalShuffleOrder[swap]] = [
          normalShuffleOrder[swap],
          normalShuffleOrder[0]
        ]
      }
    }
    const reservedId =
      shuffleReservation?.sourceSongId === currentQueueSong.value?.id
        ? shuffleReservation?.songId
        : undefined
    const ordered =
      reservedId !== undefined && normalShuffleOrder.includes(reservedId)
        ? [reservedId, ...normalShuffleOrder.filter((id) => id !== reservedId)]
        : normalShuffleOrder
    const nextId = ordered.find((id) => {
      const index = queue.value.findIndex((song) => song.id === id)
      return !excluded.has(index)
    })
    shuffleReservation =
      nextId === undefined
        ? null
        : {
            songId: nextId,
            sourceSongId: currentQueueSong.value?.id,
            startsRound: normalShuffleStartsRound
          }
    return nextId === undefined ? -1 : queue.value.findIndex((song) => song.id === nextId)
  }

  function nextIndex(excluded = new Set<number>()): number {
    const length = queue.value.length
    if (!length || (currentQueueIndex.value < 0 && playMode.value !== PlayMode.Random)) return -1
    if (playMode.value === PlayMode.Single) return currentQueueIndex.value
    if (playMode.value === PlayMode.Random) {
      if (usesNormalShuffle()) return nextNormalShuffleIndex(excluded)
      const currentId = currentQueueSong.value?.id
      const available = queue.value
        .map((song, index) => ({ song, index }))
        .filter(
          ({ song, index }) =>
            song.songStatus !== 0 && !unavailableSongIds.has(song.id) && !excluded.has(index)
        )
      const alternatives = available.filter(({ song }) => song.id !== currentId)
      if (!alternatives.length)
        return available.find(({ song }) => song.id === currentId)?.index ?? -1
      let candidates = alternatives.filter(({ song }) => !shufflePlayedSongIds.has(song.id))
      const newRound = !candidates.length
      if (newRound) candidates = alternatives
      // Separate recent tracks across round boundaries when enough tracks exist.
      const recentCount = Math.min(5, Math.floor((alternatives.length + 1) / 2))
      const recentIds = new Set(
        shuffleHistory.slice(
          Math.max(0, shuffleHistoryIndex - recentCount + 1),
          shuffleHistoryIndex + 1
        )
      )
      const fresh = candidates.filter(({ song }) => !recentIds.has(song.id))
      if (fresh.length) candidates = fresh
      if (shuffleReservation?.sourceSongId === currentId) {
        const reserved = candidates.find(({ song }) => song.id === shuffleReservation?.songId)
        if (reserved) return reserved.index
      }
      let selectedIndex: number
      if (smartShuffleEnabled.value && statistics.enabled && !ui.extremePlayback) {
        const candidateIds = new Set(candidates.map(({ song }) => song.id))
        const excludedIds = new Set(
          queue.value.filter((song) => !candidateIds.has(song.id)).map((song) => song.id)
        )
        selectedIndex = selectSmartNext(
          queue.value,
          currentQueueIndex.value,
          excludedIds,
          recommendationScores
        )
      } else {
        selectedIndex = candidates[Math.floor(Math.random() * candidates.length)].index
      }
      shuffleReservation =
        selectedIndex < 0
          ? null
          : {
              songId: queue.value[selectedIndex].id,
              sourceSongId: currentId,
              startsRound: newRound
            }
      return selectedIndex
    }
    const next = currentQueueIndex.value + 1
    if (next < length) return next
    return playMode.value === PlayMode.List ? 0 : -1
  }

  function previousIndex(): number {
    if (!queue.value.length || currentQueueIndex.value < 0) return -1
    if (playMode.value === PlayMode.Random) {
      const previousId = shuffleHistory[shuffleHistoryIndex - 1]
      return previousId === undefined
        ? currentQueueIndex.value
        : queue.value.findIndex((song) => song.id === previousId)
    }
    if (currentQueueIndex.value > 0) return currentQueueIndex.value - 1
    return playMode.value === PlayMode.List ? queue.value.length - 1 : 0
  }

  function previewNextIndex(): number {
    if (playMode.value === PlayMode.Random && shuffleHistoryIndex < shuffleHistory.length - 1) {
      return queue.value.findIndex((song) => song.id === shuffleHistory[shuffleHistoryIndex + 1])
    }
    return nextIndex()
  }

  async function syncNextTrack(): Promise<void> {
    if (queuePlaybackInProgress) return
    const revision = ++nextTrackRevision
    const index =
      !ui.extremePlayback && !stopAfterCurrent.value && transitionConfig.value.gaplessEnabled
        ? previewNextIndex()
        : -1
    const song = queue.value[index]
    let path = song && song.songStatus !== 0 ? song.audio : ''
    if (path && song.sourceId) {
      try {
        const cached = await window.api.remoteSource.cacheSong(song.id)
        path = cached.success && cached.data ? cached.data : ''
      } catch {
        path = ''
      }
    }
    if (revision !== nextTrackRevision) return
    if (song && path) resolvedQueuePaths.set(song.id, path)
    // A decoder may consume the target before its transition event reaches us.
    // Re-sending the same target during that window queues the incoming track twice.
    if (
      !nextTrackRequest ||
      nextTrackRequest.sourceFile !== currentFile.value ||
      nextTrackRequest.path !== path
    ) {
      nextTrackRequest = {
        sourceFile: currentFile.value,
        path,
        ready: audioBridge.setNextTrack(path, currentFile.value ?? undefined).catch(() => false)
      }
    }
    const ready = await nextTrackRequest.ready
    if (revision !== nextTrackRevision) return
    preparedNextIndex = ready ? index : -1
    preparedNextPath = ready ? path : ''
    preparedNextSongId = ready ? song?.id : undefined
    if (ready) schedulePlaybackSessionSave()
  }

  async function playNext(previewIndex?: number, automatic = false): Promise<boolean> {
    if (playMode.value === PlayMode.Random && shuffleHistoryIndex < shuffleHistory.length - 1) {
      const historyIndex = shuffleHistoryIndex + 1
      const index = queue.value.findIndex((song) => song.id === shuffleHistory[historyIndex])
      if (index >= 0)
        return playQueueItem(index, historyIndex, 'next', automatic ? 'automatic' : 'manual')
    }
    const index =
      playMode.value === PlayMode.Random &&
      previewIndex !== undefined &&
      previewIndex >= 0 &&
      previewIndex < queue.value.length &&
      previewIndex !== currentQueueIndex.value &&
      previewIndex === previewNextIndex()
        ? previewIndex
        : nextIndex()
    return index >= 0 ? playQueueItem(index, -1, 'next', automatic ? 'automatic' : 'manual') : false
  }

  async function playPrevious(): Promise<boolean> {
    const index = previousIndex()
    if (index < 0) return false
    return playQueueItem(
      index,
      playMode.value === PlayMode.Random ? Math.max(0, shuffleHistoryIndex - 1) : -1,
      'previous'
    )
  }

  async function pause(): Promise<boolean> {
    const result = await audioBridge.pause()
    if (result) pauseHistory()
    return result
  }

  async function stop(
    reason: 'next' | 'previous' | 'selected' | 'stopped' = 'stopped',
    preserveQueueRequest = false
  ): Promise<boolean> {
    if (!preserveQueueRequest) queueRevision++
    playbackEpoch++
    nextTrackRevision++
    preparedNextIndex = -1
    preparedNextPath = ''
    preparedNextSongId = undefined
    nextTrackRequest = null
    const result = await audioBridge.stop()
    if (result) flushHistory(true, reason)
    return result
  }
  function setStopAfterCurrent(enabled: boolean): void {
    stopAfterCurrent.value = enabled
    void syncNextTrack()
  }

  async function seek(ms: number): Promise<boolean> {
    const targetMs = Math.max(0, durationMs.value > 0 ? Math.min(ms, durationMs.value) : ms)
    positionMs.value = targetMs
    return audioBridge.seek(targetMs)
  }

  interface PlaybackSession {
    durationMs: number
    trackInfo: TrackInfo | null
    queue: PersistedQueueSong[]
    queuePlaylistId?: number | null
    currentQueueIndex: number
    playMode: PlayMode
    shuffleHistory?: number[]
    shuffleHistoryIndex?: number
    shufflePlayedSongIds?: number[]
    normalShuffleOrder?: number[] | null
    normalShuffleStartsRound?: boolean
    shuffleReservation?: {
      songId: number
      sourceSongId: number | undefined
      startsRound: boolean
    } | null
    resolvedQueuePaths?: Array<[number, string]>
    stopAfterCurrent?: boolean
  }

  interface PlaybackCheckpoint {
    currentFile: string | null
    positionMs: number
    wasPlaying: boolean
  }

  type PersistedQueueSong = Pick<
    LibrarySong,
    | 'id'
    | 'title'
    | 'artist'
    | 'album'
    | 'duration'
    | 'cover'
    | 'coverAnalysisPath'
    | 'coverPrimary'
    | 'coverSecondary'
    | 'coverLyricsDark'
    | 'coverAnalysisVersion'
    | 'audio'
    | 'isNewest'
    | 'fileName'
    | 'createdAt'
    | 'songStatus'
    | 'sourceId'
  >

  function serializeQueueSong(song: LibrarySong): PersistedQueueSong {
    return {
      id: song.id,
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      cover: song.cover,
      coverAnalysisPath: song.coverAnalysisPath,
      coverPrimary: song.coverPrimary,
      coverSecondary: song.coverSecondary,
      coverLyricsDark: song.coverLyricsDark,
      coverAnalysisVersion: song.coverAnalysisVersion,
      audio: song.audio,
      isNewest: song.isNewest,
      fileName: song.fileName,
      createdAt: song.createdAt,
      songStatus: song.songStatus,
      sourceId: song.sourceId
    }
  }

  function schedulePlaybackSessionSave(): void {
    if (playbackSessionTimer) return
    playbackSessionTimer = setTimeout(() => {
      playbackSessionTimer = undefined
      void savePlaybackSession()
    }, 750)
  }

  async function savePlaybackSession(): Promise<void> {
    savePlaybackSessionSync()
  }

  function savePlaybackSessionSync(): void {
    const session: PlaybackSession = {
      durationMs: durationMs.value,
      trackInfo: toPlainData(trackInfo.value),
      queue: queue.value.map(serializeQueueSong),
      queuePlaylistId: queuePlaylistId.value,
      currentQueueIndex: currentQueueIndex.value,
      playMode: playMode.value,
      shuffleHistory: shuffleHistory,
      shuffleHistoryIndex,
      stopAfterCurrent: stopAfterCurrent.value,
      shufflePlayedSongIds: [...shufflePlayedSongIds],
      normalShuffleOrder,
      normalShuffleStartsRound,
      shuffleReservation,
      resolvedQueuePaths: [...resolvedQueuePaths]
    }
    try {
      const result = window.api.database.saveSync('player.playback-session', session)
      if (!result.success) {
        console.warn('[Player] Failed to persist playback session:', result.error)
      }
    } catch (error) {
      console.warn('[Player] Failed to serialize playback session:', error)
    }
  }

  async function restorePlaybackSession(autoPlay = false): Promise<void> {
    try {
      const response = window.api.database.getSync('player.playback-session')
      if (!response.success || !response.data || typeof response.data !== 'object') return
      const session = response.data as Partial<PlaybackSession & PlaybackCheckpoint>
      const checkpointResponse = window.api.database.getSync('player.playback-checkpoint')
      const checkpoint =
        checkpointResponse.success &&
        checkpointResponse.data &&
        typeof checkpointResponse.data === 'object'
          ? (checkpointResponse.data as Partial<PlaybackCheckpoint>)
          : session
      shufflePlayedSongIds.clear()
      shuffleHistory.length = 0
      shuffleHistoryIndex = -1
      normalShuffleOrder = null
      normalShuffleStartsRound = false
      shuffleReservation = null
      unavailableSongIds.clear()
      resolvedQueuePaths.clear()
      const savedCurrentId = session.queue?.[session.currentQueueIndex ?? -1]?.id
      if (Array.isArray(session.queue)) {
        const ids = new Set<number>()
        queue.value = (session.queue as LibrarySong[]).filter((song) => {
          if (!song || !Number.isInteger(song.id) || ids.has(song.id)) return false
          ids.add(song.id)
          return true
        })
      }
      if (Array.isArray(session.resolvedQueuePaths)) {
        const queueIds = new Set(queue.value.map((song) => song.id))
        for (const entry of session.resolvedQueuePaths) {
          if (Array.isArray(entry) && queueIds.has(entry[0]) && typeof entry[1] === 'string')
            resolvedQueuePaths.set(entry[0], entry[1])
        }
      }
      stopAfterCurrent.value = session.stopAfterCurrent === true
      queuePlaylistId.value =
        typeof session.queuePlaylistId === 'number' && Number.isInteger(session.queuePlaylistId)
          ? session.queuePlaylistId
          : null
      if (session.trackInfo && typeof session.trackInfo === 'object') {
        trackInfo.value = session.trackInfo as TrackInfo
      }
      if (typeof session.durationMs === 'number' && session.durationMs >= 0) {
        durationMs.value = session.durationMs
      }
      currentQueueIndex.value = queue.value.findIndex((song) => song.id === savedCurrentId)
      const checkpointIndex = queue.value.findIndex(
        (song) =>
          song.audio === checkpoint.currentFile ||
          (resolvedQueuePaths.get(song.id) === checkpoint.currentFile && !!checkpoint.currentFile)
      )
      if (checkpointIndex >= 0) currentQueueIndex.value = checkpointIndex
      if (typeof session.playMode === 'number' && session.playMode >= 0 && session.playMode <= 4) {
        // Sessions saved by the earlier five-mode version used 4 for smart shuffle.
        if (Number(session.playMode) === 4) await setSmartShuffleEnabled(true)
        playMode.value =
          Number(session.playMode) === 4 ? PlayMode.Random : (session.playMode as PlayMode)
      }
      if (playMode.value === PlayMode.Random) {
        const queueIds = new Set(queue.value.map((song) => song.id))
        if (Array.isArray(session.shuffleHistory)) {
          const savedCursor = Number.isInteger(session.shuffleHistoryIndex)
            ? Math.max(
                -1,
                Math.min(session.shuffleHistoryIndex!, session.shuffleHistory.length - 1)
              )
            : session.shuffleHistory.length - 1
          shuffleHistoryIndex =
            session.shuffleHistory.slice(0, savedCursor + 1).filter((id) => queueIds.has(id))
              .length - 1
          shuffleHistory.push(
            ...session.shuffleHistory.filter(
              (id): id is number => typeof id === 'number' && queueIds.has(id)
            )
          )
        }
        const currentId = currentQueueSong.value?.id
        if (currentId !== undefined && shuffleHistory[shuffleHistoryIndex] !== currentId) {
          shuffleHistory.splice(shuffleHistoryIndex + 1)
          shuffleHistory.push(currentId)
          shuffleHistoryIndex = shuffleHistory.length - 1
        }
        if (Array.isArray(session.shufflePlayedSongIds)) {
          for (const id of session.shufflePlayedSongIds) {
            if (typeof id === 'number' && queueIds.has(id)) shufflePlayedSongIds.add(id)
          }
        }
        if (!Array.isArray(session.shufflePlayedSongIds)) {
          for (const id of shuffleHistory) shufflePlayedSongIds.add(id)
        }
        const advanced = currentId !== undefined && currentId !== savedCurrentId
        const consumedRoundStart =
          advanced &&
          (usesNormalShuffle()
            ? session.normalShuffleStartsRound === true
            : session.shuffleReservation?.songId === currentId &&
              session.shuffleReservation.startsRound)
        if (consumedRoundStart) shufflePlayedSongIds.clear()
        if (currentId !== undefined) shufflePlayedSongIds.add(currentId)
        normalShuffleOrder = Array.isArray(session.normalShuffleOrder)
          ? [
              ...new Set(
                session.normalShuffleOrder.filter(
                  (id) => typeof id === 'number' && queueIds.has(id)
                )
              )
            ]
          : null
        normalShuffleStartsRound = session.normalShuffleStartsRound === true && !consumedRoundStart
        const reserved = session.shuffleReservation
        if (reserved && queueIds.has(reserved.songId) && reserved.sourceSongId === currentId) {
          shuffleReservation = { ...reserved, startsRound: reserved.startsRound === true }
        }
        shuffleNavigationRevision.value++
      }
      if (typeof checkpoint.currentFile !== 'string' || !checkpoint.currentFile) return
      currentFile.value = checkpoint.currentFile
      const restoredPosition =
        typeof checkpoint.positionMs === 'number' && checkpoint.positionMs > 0
          ? checkpoint.positionMs
          : 0
      // A replacement renderer attaches to the live decoder without reopening
      // or seeking it. Queue/UI ownership changes; audio ownership stays native.
      const live = await audioBridge.getStatus()
      if (live?.trackInfo?.filePath === checkpoint.currentFile && live.state !== 'idle') {
        const liveIndex = queue.value.findIndex(
          (song) =>
            song.audio === live.trackInfo?.filePath ||
            resolvedQueuePaths.get(song.id) === live.trackInfo?.filePath
        )
        if (liveIndex >= 0) currentQueueIndex.value = liveIndex
        state.value = live.state
        trackInfo.value = live.trackInfo
        positionMs.value = live.positionMs
        durationMs.value = live.durationMs
        deferredRestore = null
        if (!ui.extremePlayback && live.state === 'playing' && currentQueueSong.value)
          beginHistory(currentQueueSong.value)
        return
      }
      // Do not probe a restored path during startup. On macOS that can trigger
      // a TCC prompt for Downloads/Documents without an explicit user action.
      deferredRestore = { filePath: checkpoint.currentFile, positionMs: restoredPosition }
      // The decoder intentionally stays unopened until a user action, but the
      // restored UI must still reflect the saved resume point. `play()` will
      // perform the actual seek after opening the file.
      positionMs.value = restoredPosition
      if (autoPlay && checkpoint.wasPlaying === true) await play()
    } catch {
      // A missing file or malformed prior session should start with an idle player.
    }
  }

  async function setVolume(vol: number): Promise<void> {
    volume.value = Math.max(0, Math.min(1, vol))
    await audioBridge.setVolume(volume.value)
  }

  async function setPreamp(db: number, enabled: boolean): Promise<void> {
    preampDb.value = Math.max(-24, Math.min(24, db))
    preampEnabled.value = enabled
    await audioBridge.setPreamp(preampDb.value, preampEnabled.value)
  }
  async function resetAudioProcessingSettings(): Promise<{ success: boolean; error?: string }> {
    const result = await audioBridge.resetAudioProcessingSettings()
    if (!result.success) return result
    preampDb.value = 0
    preampEnabled.value = false
    await initializePersistentState()
    await refreshAudioChain()
    void syncNextTrack()
    return result
  }
  async function loadReplayGain(): Promise<void> {
    const c = await audioBridge.getReplayGain()
    if (c) replayGainConfig.value = c
  }
  async function setReplayGain(): Promise<boolean> {
    const ok = await audioBridge.setReplayGain({
      mode: replayGainConfig.value.mode,
      preventClipping: replayGainConfig.value.preventClipping
    })
    if (ok) {
      await loadReplayGain()
      await refreshAudioChain()
    }
    return ok
  }
  async function loadPlaybackSpeed(): Promise<void> {
    const c = await audioBridge.getPlaybackSpeed()
    if (c) playbackSpeedConfig.value = c
  }
  async function setPlaybackSpeed(): Promise<boolean> {
    const ok = await audioBridge.setPlaybackSpeed({ ...playbackSpeedConfig.value })
    if (ok) await refreshAudioChain()
    return ok
  }

  async function loadEqBands(): Promise<void> {
    const bands = await audioBridge.getEqBands()
    if (bands.length === 20) eqBands.value = bands
  }

  async function commitEqBands(): Promise<void> {
    const logStore = useLogStore()
    const activeBands = eqBands.value.filter(
      (band) => band.enabled && Math.abs(band.gainDb) >= 0.0001
    ).length
    logStore.addEntry({
      level: 'debug',
      message: `Renderer EQ submit: ${activeBands} active band(s)`,
      timestamp: Date.now()
    })
    try {
      // Pinia exposes a reactive Proxy. Electron IPC uses structured clone,
      // which rejects Proxies, so send a fresh plain-object snapshot.
      const bands = eqBands.value.map((band) => ({
        enabled: band.enabled,
        frequencyHz: band.frequencyHz,
        gainDb: band.gainDb,
        q: band.q
      }))
      const ok = await audioBridge.setEqBands(bands)
      logStore.addEntry({
        level: ok ? 'debug' : 'error',
        message: `Renderer EQ submit ${ok ? 'accepted by IPC' : 'rejected by IPC'}`,
        timestamp: Date.now()
      })
    } catch (error) {
      logStore.addEntry({
        level: 'error',
        message: `Renderer EQ submit exception: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now()
      })
    }
  }

  async function loadResamplerConfig(): Promise<void> {
    const config = await audioBridge.getResamplerConfig()
    if (config) resamplerConfig.value = config
  }
  async function loadDopEnabled(): Promise<void> {
    dopEnabled.value = await audioBridge.getDopEnabled()
  }
  async function loadTransitionConfig(): Promise<void> {
    const config = await audioBridge.getTransitionConfig()
    if (config) transitionConfig.value = { ...transitionConfig.value, ...config }
  }
  async function setTransitionConfig(): Promise<boolean> {
    const next = {
      ...transitionConfig.value,
      crossfadeMs: Math.max(0, Math.min(30000, transitionConfig.value.crossfadeMs)),
      pauseFadeMs: Math.max(0, Math.min(1000, transitionConfig.value.pauseFadeMs))
    }
    const ok = await audioBridge.setTransitionConfig(next)
    if (ok) {
      transitionConfig.value = next
      await refreshAudioChain()
      void syncNextTrack()
    }
    return ok
  }
  async function setDopEnabled(enabled: boolean): Promise<boolean> {
    const ok = await audioBridge.setDopEnabled(enabled)
    if (ok) dopEnabled.value = enabled
    return ok
  }

  async function setResamplerConfig(config: ResamplerConfig): Promise<boolean> {
    const next = {
      forceOutputRate: config.forceOutputRate,
      targetSampleRate: config.targetSampleRate,
      quality: config.quality
    } satisfies ResamplerConfig
    const ok = await audioBridge.setResamplerConfig(next)
    if (ok) {
      resamplerConfig.value = next
      await refreshAudioChain()
    }
    return ok
  }

  async function loadDspNodes(): Promise<void> {
    const nodes = await audioBridge.getDspNodes()
    if (nodes.length === 14) dspNodes.value = nodes
  }
  async function loadCompressorConfig(): Promise<void> {
    const config = await audioBridge.getCompressorConfig()
    if (config) compressorConfig.value = config
  }
  async function setCompressorConfig(): Promise<boolean> {
    const ok = await audioBridge.setCompressorConfig({ ...compressorConfig.value })
    if (ok) await refreshAudioChain()
    return ok
  }
  async function loadDelayConfig(): Promise<void> {
    const config = await audioBridge.getDelayConfig()
    if (config) delayConfig.value = config
  }
  async function setDelayConfig(): Promise<boolean> {
    return audioBridge.setDelayConfig({ ...delayConfig.value })
  }
  async function loadReverbConfig(): Promise<void> {
    const c = await audioBridge.getReverbConfig()
    if (c) reverbConfig.value = c
  }
  async function setReverbConfig(): Promise<boolean> {
    return audioBridge.setReverbConfig({ ...reverbConfig.value })
  }
  async function loadChorusConfig(): Promise<void> {
    const c = await audioBridge.getChorusConfig()
    if (c) chorusConfig.value = c
  }
  async function setChorusConfig(): Promise<boolean> {
    return audioBridge.setChorusConfig({ ...chorusConfig.value })
  }
  async function loadNoiseGateConfig(): Promise<void> {
    const c = await audioBridge.getNoiseGateConfig()
    if (c) noiseGateConfig.value = c
  }
  async function setNoiseGateConfig(): Promise<boolean> {
    return audioBridge.setNoiseGateConfig({ ...noiseGateConfig.value })
  }
  async function loadPhaserConfig(): Promise<void> {
    const c = await audioBridge.getPhaserConfig()
    if (c) phaserConfig.value = c
  }
  async function setPhaserConfig(): Promise<boolean> {
    return audioBridge.setPhaserConfig({ ...phaserConfig.value })
  }
  async function loadChannelMatrixConfig(): Promise<void> {
    const c = await audioBridge.getChannelMatrixConfig()
    if (c) channelMatrixConfig.value = c
  }
  async function loadStereoFieldConfig(): Promise<void> {
    const config = await audioBridge.getStereoFieldConfig()
    if (config) stereoFieldConfig.value = config
  }
  async function setStereoFieldConfig(): Promise<boolean> {
    const ok = await audioBridge.setStereoFieldConfig({ ...stereoFieldConfig.value })
    if (ok) await refreshAudioChain()
    return ok
  }
  async function loadCrossfeedConfig(): Promise<void> {
    const config = await audioBridge.getCrossfeedConfig()
    if (config) crossfeedConfig.value = config
  }
  async function setCrossfeedConfig(): Promise<boolean> {
    const ok = await audioBridge.setCrossfeedConfig({ ...crossfeedConfig.value })
    if (ok) await refreshAudioChain()
    return ok
  }
  async function loadImpulseResponseConfig(): Promise<void> {
    const config = await audioBridge.getImpulseResponseConfig()
    if (config) impulseResponseConfig.value = config
  }
  async function setImpulseResponseConfig(): Promise<{ success: boolean; error?: string }> {
    const result = await audioBridge.setImpulseResponseConfig({ ...impulseResponseConfig.value })
    if (result.success) {
      await loadImpulseResponseConfig()
      await refreshAudioChain()
    }
    return result
  }
  async function setChannelMatrixConfig(): Promise<boolean> {
    const config = {
      enabled: channelMatrixConfig.value.enabled,
      balance: channelMatrixConfig.value.balance,
      swapStereo: channelMatrixConfig.value.swapStereo,
      monoDownmix: channelMatrixConfig.value.monoDownmix,
      // Pinia makes nested arrays reactive Proxies. IPC structured clone
      // requires a plain array, otherwise the entire matrix update is lost.
      outputGains: [...channelMatrixConfig.value.outputGains]
    }
    try {
      const ok = await audioBridge.setChannelMatrixConfig(config)
      if (ok) await refreshAudioChain()
      return ok
    } catch (error) {
      useLogStore().addEntry({
        level: 'error',
        message: `Channel Matrix submit exception: ${error instanceof Error ? error.message : String(error)}`,
        timestamp: Date.now()
      })
      return false
    }
  }
  async function loadLimiter(): Promise<void> {
    const c = await audioBridge.getLimiter()
    if (c) limiterConfig.value = c
  }
  async function setLimiter(): Promise<boolean> {
    const ok = await audioBridge.setLimiter({ ...limiterConfig.value })
    if (ok) await refreshAudioChain()
    return ok
  }

  async function commitDspNodes(): Promise<boolean> {
    const nodes = dspNodes.value.map((node) => ({ id: node.id, enabled: node.enabled }))
    const ok = await audioBridge.setDspNodes(nodes)
    if (ok) await refreshAudioChain()
    return ok
  }

  function moveDspNode(index: number, direction: -1 | 1): void {
    const destination = index + direction
    if (destination < 0 || destination >= dspNodes.value.length) return
    const [node] = dspNodes.value.splice(index, 1)
    dspNodes.value.splice(destination, 0, node)
    void commitDspNodes()
  }

  async function setBackend(backend: string): Promise<boolean> {
    if (currentBackend.value === backend) return true
    const ok = await audioBridge.setBackend(backend)
    if (!ok) {
      useLogStore().addEntry({
        level: 'error',
        message: `Failed to switch audio backend to ${backend}`,
        timestamp: Date.now()
      })
      return false
    }
    currentBackend.value = backend
    {
      // Device identifiers belong to the previous backend and cannot be
      // reused by ASIO, WASAPI, or DirectSound.
      currentDeviceId.value = 'default'
      // Refresh device list after backend change
      await refreshDevices()
    }
    return true
  }

  async function setDevice(deviceId: string): Promise<boolean> {
    if (currentDeviceId.value === deviceId) return true
    const ok = await audioBridge.setDevice(deviceId)
    if (!ok) {
      useLogStore().addEntry({
        level: 'error',
        message: `Failed to select audio device ${deviceId}`,
        timestamp: Date.now()
      })
      return false
    }
    currentDeviceId.value = deviceId
    return true
  }

  async function selectOutputDevice(device: DeviceInfo): Promise<boolean> {
    if (currentBackend.value === device.backend && currentDeviceId.value === device.id) return true

    const ok = await audioBridge.selectOutputDevice(device.backend, device.id)
    if (!ok) {
      useLogStore().addEntry({
        level: 'error',
        message: `Failed to select ${device.backend} device ${device.name}`,
        timestamp: Date.now()
      })
      return false
    }

    currentBackend.value = device.backend
    currentDeviceId.value = device.id
    return true
  }

  async function loadOutputDeviceSettings(): Promise<void> {
    const output = await audioBridge.getOutputDeviceSettings()
    if (!output) return
    currentBackend.value = output.backend
    currentDeviceId.value = output.deviceId
  }

  async function logEngineInfo(): Promise<void> {
    const info = await audioBridge.getEngineInfo()
    if (!info) return
    useLogStore().addEntry({
      level: 'info',
      message: `Easy Player Audio Engine v${info.version} | ${info.outputDevice.backend} / ${info.outputDevice.deviceId}`,
      timestamp: Date.now()
    })
  }

  async function refreshDevices(): Promise<void> {
    devices.value = await audioBridge.enumerateDevices()
  }

  async function refreshAudioChain(): Promise<void> {
    audioChain.value = await audioBridge.getAudioChain()
  }
  async function refreshAudioAnalysis(includeSpectrum = false): Promise<void> {
    if (ui.extremePlayback) return
    const snapshot = await audioBridge.getAudioAnalysis(includeSpectrum)
    if (!snapshot || ui.extremePlayback) return
    audioAnalysis.value = {
      ...snapshot,
      clipGuardLimitedFrames: snapshot.clipGuardLimitedFrames ?? 0,
      clipGuardReductionDb: snapshot.clipGuardReductionDb ?? 0,
      spectrum: snapshot.spectrum ?? audioAnalysis.value.spectrum
    }
  }
  function setLoudnessAnalysisEnabled(enabled: boolean): void {
    void audioBridge.setLoudnessAnalysisEnabled(enabled && !ui.extremePlayback)
  }

  /**
   * Pinia restores the renderer snapshot synchronously. The audio engine owns
   * the actual DSP state, so refresh it once during startup to prevent a stale
   * renderer value (for example volume) from disagreeing with playback.
   */
  async function initializePersistentState(): Promise<void> {
    const status = await audioBridge.getStatus()
    if (status) {
      state.value = status.state
      positionMs.value = status.positionMs
      durationMs.value = status.durationMs
      volume.value = Math.max(0, Math.min(1, status.volume))
      glitchCount.value = status.glitchCount
      trackInfo.value = status.trackInfo
      startAudioAnalysisPolling()
    }

    if (ui.extremePlayback) return
    await Promise.allSettled([
      loadOutputDeviceSettings(),
      loadPlaybackSpeed(),
      loadReplayGain(),
      loadEqBands(),
      loadResamplerConfig(),
      loadDopEnabled(),
      loadTransitionConfig(),
      loadDspNodes(),
      loadCompressorConfig(),
      loadDelayConfig(),
      loadReverbConfig(),
      loadChorusConfig(),
      loadNoiseGateConfig(),
      loadPhaserConfig(),
      loadChannelMatrixConfig(),
      loadStereoFieldConfig(),
      loadCrossfeedConfig(),
      loadImpulseResponseConfig(),
      loadLimiter()
    ])
  }

  async function loadRhythmVisualConfig(): Promise<void> {
    try {
      const response = await window.api.database.command('getSetting', {
        key: 'player.rhythm-visual-config'
      })
      let parsed: Partial<typeof rhythmVisualConfig.value> | undefined
      let migratedLegacyConfig = false
      if (response.success && response.data && typeof response.data === 'object') {
        parsed = response.data as Partial<typeof rhythmVisualConfig.value>
      } else {
        const legacy = localStorage.getItem('easy-player.rhythm-visual-config')
        if (legacy) {
          parsed = JSON.parse(legacy) as Partial<typeof rhythmVisualConfig.value>
          migratedLegacyConfig = true
        }
      }
      if (!parsed) return
      rhythmVisualConfig.value = {
        enabled: parsed.enabled !== false,
        intensity: Math.max(
          0,
          Math.min(1, typeof parsed.intensity === 'number' ? parsed.intensity : 0.65)
        ),
        reducedMotion: parsed.reducedMotion === true
      }
      if (migratedLegacyConfig) {
        await saveRhythmVisualConfig()
        localStorage.removeItem('easy-player.rhythm-visual-config')
      }
    } catch {
      // Corrupt renderer preferences must never stop playback controls loading.
    }
  }

  async function saveRhythmVisualConfig(): Promise<void> {
    const config = rhythmVisualConfig.value
    try {
      await window.api.database.command('setSetting', {
        key: 'player.rhythm-visual-config',
        value: {
          enabled: config.enabled,
          intensity: config.intensity,
          reducedMotion: config.reducedMotion
        }
      })
    } catch (error) {
      console.warn('[player] Failed to persist rhythm visual config:', error)
    }
  }

  watch(
    rhythmVisualConfig,
    () => {
      void saveRhythmVisualConfig()
    },
    { deep: true }
  )

  // ── Event subscriptions ──
  let unsubs: (() => void)[] = []
  let analysisTimer: ReturnType<typeof setTimeout> | undefined
  const audioControlAnalysisPollingRate = 2
  let audioControlAnalysisActive = false
  let playerPanelAnalysisPollingRate = 0
  let playerPanelAnalysisIncludesSpectrum = false
  let audioAnalysisPollingRate = 0
  let audioAnalysisIncludesSpectrum = false
  let analysisRefreshInFlight = false
  let autoAdvanceInProgress = false
  let lastTrackEndedAt = 0
  let documentVisible = typeof document === 'undefined' ? true : !document.hidden

  function startAudioAnalysisPolling(): void {
    if (
      ui.extremePlayback ||
      analysisTimer ||
      analysisRefreshInFlight ||
      state.value !== 'playing' ||
      !documentVisible ||
      audioAnalysisPollingRate <= 0
    )
      return
    analysisRefreshInFlight = true
    void refreshAudioAnalysis(audioAnalysisIncludesSpectrum).finally(() => {
      analysisRefreshInFlight = false
      if (
        ui.extremePlayback ||
        state.value !== 'playing' ||
        !documentVisible ||
        audioAnalysisPollingRate <= 0
      )
        return
      analysisTimer = setTimeout(
        () => {
          analysisTimer = undefined
          startAudioAnalysisPolling()
        },
        Math.round(1000 / audioAnalysisPollingRate)
      )
    })
  }

  function stopAudioAnalysisPolling(): void {
    if (!analysisTimer) return
    clearTimeout(analysisTimer)
    analysisTimer = undefined
  }

  function setAudioAnalysisPollingRate(rate: number, includeSpectrum = false): void {
    playerPanelAnalysisPollingRate = Math.max(0, Math.min(60, Math.round(rate)))
    playerPanelAnalysisIncludesSpectrum = playerPanelAnalysisPollingRate > 0 && includeSpectrum
    updateAudioAnalysisPolling()
  }

  function setAudioControlAnalysisActive(active: boolean): void {
    if (audioControlAnalysisActive === active) return
    audioControlAnalysisActive = active
    updateAudioAnalysisPolling()
  }

  function updateAudioAnalysisPolling(): void {
    const normalized =
      ui.extremePlayback || !documentVisible
        ? 0
        : Math.max(
            playerPanelAnalysisPollingRate,
            audioControlAnalysisActive ? audioControlAnalysisPollingRate : 0
          )
    const includeSpectrum = normalized > 0 && playerPanelAnalysisIncludesSpectrum
    void window.api.audio.setAnalysisEnabled(normalized > 0)
    if (
      audioAnalysisPollingRate === normalized &&
      audioAnalysisIncludesSpectrum === includeSpectrum
    )
      return
    audioAnalysisPollingRate = normalized
    audioAnalysisIncludesSpectrum = includeSpectrum
    void audioBridge.setSpectrumAnalysisEnabled(audioAnalysisIncludesSpectrum)
    stopAudioAnalysisPolling()
    startAudioAnalysisPolling()
  }
  function handleDocumentVisibility(): void {
    documentVisible = !document.hidden
    updateAudioAnalysisPolling()
  }

  async function handleTrackEnded(
    reason: string,
    filePath?: string,
    nextFilePath?: string
  ): Promise<void> {
    // `trackEnded` crosses the native, main and renderer event queues. If a
    // user selects the next track just as the old one ends, its late event
    // must not advance the newly selected track a second time.
    if (filePath && filePath !== currentFile.value) return
    if (queuePlaybackInProgress) return
    if (reason === 'transition') {
      const epoch = ++playbackEpoch
      const incomingPath = nextFilePath || preparedNextPath
      const index = nextFilePath
        ? queue.value.findIndex(
            (song) =>
              song.audio === nextFilePath || resolvedQueuePaths.get(song.id) === nextFilePath
          )
        : queue.value.findIndex((song) => song.id === preparedNextSongId)
      const song = queue.value[index]
      // The transition already happened natively; never reopen its target as
      // an ordinary EOF fallback, even if a preloading response arrived late.
      nextTrackRevision++
      nextTrackRequest = null
      preparedNextIndex = -1
      preparedNextPath = ''
      preparedNextSongId = undefined
      if (!song && incomingPath) {
        // The user may remove an already-decoded target before its event arrives.
        // Follow the native source before choosing a replacement, or its later EOF
        // would be mistaken for an event from an unrelated track and ignored.
        flushHistory(true, 'ended')
        currentFile.value = incomingPath
        currentQueueIndex.value = -1
        if (!queue.value.length || stopAfterCurrent.value) {
          stopAfterCurrent.value = false
          await stop()
        } else {
          const next = playMode.value === PlayMode.Random ? nextIndex() : 0
          if (next >= 0) await playQueueItem(next, -1, 'next', 'automatic')
        }
        return
      }
      if (song && incomingPath) {
        flushHistory(true, 'ended')
        if (
          playMode.value === PlayMode.Random &&
          shuffleHistory[shuffleHistoryIndex + 1] !== song.id
        )
          recordShufflePlayed(index)
        currentQueueIndex.value = index
        currentFile.value = incomingPath
        if (playMode.value === PlayMode.Random) {
          if (shuffleHistory[shuffleHistoryIndex + 1] === song.id) {
            shuffleHistoryIndex++
          } else {
            shuffleHistory.splice(shuffleHistoryIndex + 1)
            shuffleHistory.push(song.id)
            shuffleHistoryIndex = shuffleHistory.length - 1
          }
          shuffleNavigationRevision.value++
        }
        const status = await audioBridge.getStatus()
        if (epoch !== playbackEpoch) return
        if (status) {
          trackInfo.value = status.trackInfo
          durationMs.value = status.durationMs
        }
        beginHistory(song)
        savePlaybackSessionSync()
        void syncNextTrack()
      }
      return
    }
    const now = Date.now()
    // Native backends may emit an EOF notification more than once while the
    // previous output callback drains. Only one event may advance the queue.
    if (autoAdvanceInProgress || (!filePath && now - lastTrackEndedAt < 500)) return
    lastTrackEndedAt = now
    autoAdvanceInProgress = true
    state.value = 'stopped'
    stopAudioAnalysisPolling()
    useLogStore().addEntry({
      level: 'debug',
      message: `Playback reached end of track (${reason})`,
      timestamp: now
    })
    try {
      flushHistory(true, 'ended')
      if (stopAfterCurrent.value) {
        stopAfterCurrent.value = false
      } else {
        await playNext(undefined, true)
      }
    } finally {
      autoAdvanceInProgress = false
    }
  }

  async function setExtremePlayback(enabled: boolean, switchView = true): Promise<void> {
    if (playbackModeChanging.value) return
    const previousMode = ui.extremePlayback
    playbackModeChanging.value = true
    try {
      const result = await window.api.audio.setExtremePlayback(enabled)
      if (!result.success) throw new Error(result.error || 'Playback mode unavailable')
      if (enabled) {
        pauseHistory()
        historySession = undefined
        recommendationScores.clear()
        shuffleReservation = null
        // A window switch must not collapse the outgoing immersive player.
        // The new renderer starts with this transient state cleared already.
        if (!switchView) ui.showPlayer = false
      }
      ui.extremePlayback = enabled
      normalShuffleOrder = null
      normalShuffleStartsRound = false
      document.documentElement.classList.toggle('extreme-playback', enabled)
      updateAudioAnalysisPolling()
      if (!enabled) {
        void loadRecommendationScores()
        if (isPlaying.value && currentQueueSong.value) beginHistory(currentQueueSong.value)
      }
      void syncNextTrack()
      if (switchView && enabled !== (document.documentElement.dataset.playbackView === 'extreme')) {
        savePlaybackSessionSync()
        await nextTick()
        flushPlayerDataStorage()
        const switched = await window.api.audio.switchPlaybackView(enabled)
        if (!switched.success) throw new Error(switched.error || 'Unable to switch playback window')
      }
    } catch (error) {
      ui.extremePlayback = previousMode
      document.documentElement.classList.toggle('extreme-playback', previousMode)
      await window.api.audio.setExtremePlayback(previousMode)
      updateAudioAnalysisPolling()
      await attachRenderer().catch(() => undefined)
      warning(String(error))
    } finally {
      playbackModeChanging.value = false
    }
  }

  function subscribeToEvents(): void {
    if (unsubs.length) return
    if (!statistics.ready) void statistics.refresh().catch(() => undefined)
    void loadRecommendationScores()
    document.addEventListener('visibilitychange', handleDocumentVisibility)
    startAudioAnalysisPolling()
    unsubs.push(
      audioBridge.onStateChanged((data) => {
        state.value = data.state as PlaybackState
        if (data.state === 'playing') {
          resumeHistory()
          startAudioAnalysisPolling()
        } else {
          if (data.state === 'paused') pauseHistory()
          stopAudioAnalysisPolling()
        }
        if (data.trackInfo) {
          trackInfo.value = data.trackInfo as TrackInfo
        }
      })
    )
    unsubs.push(window.api.miniPlayer.onAction(handleMiniPlayerAction))
    unsubs.push(window.api.system.onTrayAction(handleMiniPlayerAction))
    unsubs.push(window.api.miniPlayer.onRequestState(publishMiniPlayerState))

    unsubs.push(
      audioBridge.onAudioChainChanged((data) => {
        audioChain.value = data
      })
    )
    unsubs.push(
      audioBridge.onPositionChanged((data) => {
        positionMs.value = data.positionMs
        durationMs.value = data.durationMs
      })
    )

    unsubs.push(
      audioBridge.onTrackEnded(
        (data) => void handleTrackEnded(data.reason, data.filePath, data.nextFilePath)
      )
    )
  }

  async function attachRenderer(): Promise<void> {
    const result = await window.api.audio.attachRenderer()
    if (result.success)
      for (const ended of result.data ?? [])
        await handleTrackEnded(ended.reason, ended.filePath, ended.nextFilePath)
  }

  function unsubscribe(): void {
    document.removeEventListener('visibilitychange', handleDocumentVisibility)
    flushHistory(true, 'closed')
    unsubs.forEach((fn) => fn())
    unsubs = []
    stopAudioAnalysisPolling()
    if (playbackSessionTimer) clearTimeout(playbackSessionTimer)
    playbackSessionTimer = undefined
    savePlaybackSessionSync()
  }

  function publishMiniPlayerState(): void {
    const song = currentQueueSong.value
    const metadata = trackInfo.value?.metadata
    window.api.miniPlayer.update({
      cover: song?.cover || null,
      title: metadata?.title || song?.title || '',
      artist: metadata?.artist || song?.artist || '',
      isPlaying: isPlaying.value,
      theme: {
        dark: ui.resolvedAppearance.dark,
        background: ui.resolvedAppearance.systemTheme,
        accent: ui.resolvedAppearance.accentColor,
        fill: ui.resolvedAppearance.primaryFill ?? ui.resolvedAppearance.accentColor,
        border: ui.resolvedAppearance.chrome.border
      }
    })
    window.api.system.updateTray({
      title: metadata?.title || song?.title || '',
      artist: metadata?.artist || song?.artist || '',
      isPlaying: isPlaying.value
    })
  }

  function handleMiniPlayerAction(action: 'previous' | 'toggle' | 'next'): void {
    if (action === 'previous') {
      void playPrevious()
      return
    }
    if (action === 'next') {
      void playNext()
      return
    }
    if (isPlaying.value) void pause()
    else if (currentFile.value) void play()
  }

  watch([currentQueueSong, trackInfo, isPlaying], publishMiniPlayerState, { deep: true })
  watch([queueTransitionEntries, currentQueueIndex, playMode], () => {
    if (isPlaying.value) void syncNextTrack()
  })
  watch(() => ui.resolvedAppearance, publishMiniPlayerState)

  return {
    // State
    playbackModeChanging,
    setExtremePlayback,
    state,
    positionMs,
    durationMs,
    volume,
    glitchCount,
    trackInfo,
    currentFile,
    currentBackend,
    devices,
    currentDeviceId,
    audioChain,
    audioAnalysis,
    rhythmVisualConfig,
    preampEnabled,
    preampDb,
    replayGainConfig,
    playbackSpeedConfig,
    eqBands,
    resamplerConfig,
    dopEnabled,
    transitionConfig,
    dspNodes,
    compressorConfig,
    delayConfig,
    reverbConfig,
    limiterConfig,
    chorusConfig,
    noiseGateConfig,
    phaserConfig,
    channelMatrixConfig,
    stereoFieldConfig,
    crossfeedConfig,
    impulseResponseConfig,
    queue,
    queuePlaylistId,
    currentQueueIndex,
    currentQueueSong,
    playMode,
    smartShuffleEnabled,
    stopAfterCurrent,
    // Computed
    isPlaying,
    isPaused,
    progress,
    positionFormatted,
    durationFormatted,
    // Actions
    openFile,
    play,
    setPlayMode,
    loadSmartShuffleConfig,
    setSmartShuffleEnabled,
    setPreference,
    resetSongRecommendation,
    getSongPreference,
    finishHistoryOnUnload,
    addToQueue,
    setQueue,
    playQueueItem,
    playCollection,
    moveQueueItem,
    removeQueueItem,
    clearQueue,
    playNext,
    playPrevious,
    shuffleNavigationRevision,
    getNextQueueIndex: previewNextIndex,
    getPreviousQueueIndex: previousIndex,
    pause,
    stop,
    setStopAfterCurrent,
    seek,
    setVolume,
    setPreamp,
    resetAudioProcessingSettings,
    loadReplayGain,
    setReplayGain,
    loadPlaybackSpeed,
    setPlaybackSpeed,
    loadEqBands,
    commitEqBands,
    loadResamplerConfig,
    setResamplerConfig,
    loadDopEnabled,
    setDopEnabled,
    loadTransitionConfig,
    setTransitionConfig,
    loadDspNodes,
    commitDspNodes,
    moveDspNode,
    loadCompressorConfig,
    setCompressorConfig,
    loadDelayConfig,
    setDelayConfig,
    loadReverbConfig,
    setReverbConfig,
    loadChorusConfig,
    setChorusConfig,
    loadNoiseGateConfig,
    setNoiseGateConfig,
    loadPhaserConfig,
    setPhaserConfig,
    loadChannelMatrixConfig,
    setChannelMatrixConfig,
    loadStereoFieldConfig,
    setStereoFieldConfig,
    loadCrossfeedConfig,
    setCrossfeedConfig,
    loadImpulseResponseConfig,
    setImpulseResponseConfig,
    loadLimiter,
    setLimiter,
    setBackend,
    setDevice,
    selectOutputDevice,
    loadOutputDeviceSettings,
    logEngineInfo,
    refreshDevices,
    refreshAudioChain,
    refreshAudioAnalysis,
    setLoudnessAnalysisEnabled,
    setAudioAnalysisPollingRate,
    setAudioControlAnalysisActive,
    initializePersistentState,
    loadRhythmVisualConfig,
    saveRhythmVisualConfig,
    savePlaybackSession,
    savePlaybackSessionSync,
    restorePlaybackSession,
    // Events
    subscribeToEvents,
    attachRenderer,
    unsubscribe
  }
})

function toPlainData<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function createDefaultEqBands(): EqBand[] {
  const frequencies = [
    20, 31.5, 50, 80, 125, 200, 315, 500, 800, 1250, 2000, 3150, 5000, 8000, 10000, 12000, 14000,
    16000, 18000, 20000
  ]
  return frequencies.map((frequencyHz) => ({ enabled: false, frequencyHz, gainDb: 0, q: 1 }))
}

function formatTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return `${min}:${sec.toString().padStart(2, '0')}`
}
