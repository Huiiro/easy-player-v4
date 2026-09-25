import { ElectronAPI } from '@electron-toolkit/preload'
import type { LogEntry } from '../main/service/loggerService'
import type {
  AudioChainStatus,
  CompressorConfig,
  DelayConfig,
  DeviceInfo,
  DspNodeConfig,
  EqBand,
  PlaybackStatus,
  ResamplerConfig,
  TransitionConfig
} from '../renderer/src/types/audio'
import type { DatabaseAction, DatabaseResponse } from '../main/database/ipc-handlers'
import type { ScanLocalMusicResult, ScanProgress } from '../main/ipc/scanIpcHandlers'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      log: {
        write(level: LogEntry['level'], message: string): void
        recent(): Promise<LogEntry[]>
        onEntry(callback: (entry: LogEntry) => void): () => void
      }
      audio: {
        getFilePath(file: File): string
        open(filePath: string): Promise<{ success: boolean; data?: unknown; error?: string }>
        play(startPosition?: number): Promise<{ success: boolean }>
        pause(): Promise<{ success: boolean }>
        stop(): Promise<{ success: boolean }>
        seek(positionMs: number): Promise<{ success: boolean }>
        setVolume(volume: number): Promise<{ success: boolean }>
        setPreamp(db: number, enabled: boolean): Promise<{ success: boolean }>
        setReplayGain(config: {
          mode: 'off' | 'track' | 'album'
          preventClipping: boolean
        }): Promise<{ success: boolean }>
        getReplayGain(): Promise<{
          success: boolean
          data?: {
            mode: 'off' | 'track' | 'album'
            preventClipping: boolean
            active: boolean
            appliedGainDb: number
          }
          error?: string
        }>
        setPlaybackSpeed(config: { enabled: boolean; speed: number }): Promise<{ success: boolean }>
        getPlaybackSpeed(): Promise<{
          success: boolean
          data?: { enabled: boolean; speed: number }
          error?: string
        }>
        setEqBands(bands: EqBand[]): Promise<{ success: boolean }>
        getEqBands(): Promise<{ success: boolean; data?: EqBand[]; error?: string }>
        setResamplerConfig(config: ResamplerConfig): Promise<{ success: boolean }>
        getResamplerConfig(): Promise<{ success: boolean; data?: ResamplerConfig; error?: string }>
        setDopEnabled(enabled: boolean): Promise<{ success: boolean }>
        getDopEnabled(): Promise<{ success: boolean; data?: boolean; error?: string }>
        setTransitionConfig(config: TransitionConfig): Promise<{ success: boolean }>
        getTransitionConfig(): Promise<{
          success: boolean
          data?: TransitionConfig
          error?: string
        }>
        setDspNodes(nodes: DspNodeConfig[]): Promise<{ success: boolean }>
        getDspNodes(): Promise<{ success: boolean; data?: DspNodeConfig[]; error?: string }>
        setCompressorConfig(config: CompressorConfig): Promise<{ success: boolean }>
        getCompressorConfig(): Promise<{
          success: boolean
          data?: CompressorConfig
          error?: string
        }>
        setDelayConfig(config: DelayConfig): Promise<{ success: boolean }>
        getDelayConfig(): Promise<{ success: boolean; data?: DelayConfig; error?: string }>
        setReverbConfig(config: {
          roomSize: number
          decay: number
          mix: number
        }): Promise<{ success: boolean }>
        getReverbConfig(): Promise<{
          success: boolean
          data?: { roomSize: number; decay: number; mix: number }
          error?: string
        }>
        setChorusConfig(config: {
          rateHz: number
          depthMs: number
          mix: number
        }): Promise<{ success: boolean }>
        getChorusConfig(): Promise<{
          success: boolean
          data?: { rateHz: number; depthMs: number; mix: number }
          error?: string
        }>
        setNoiseGateConfig(config: {
          thresholdDb: number
          attackMs: number
          holdMs: number
          releaseMs: number
          rangeDb: number
        }): Promise<{ success: boolean }>
        getNoiseGateConfig(): Promise<{
          success: boolean
          data?: {
            thresholdDb: number
            attackMs: number
            holdMs: number
            releaseMs: number
            rangeDb: number
          }
          error?: string
        }>
        setPhaserConfig(config: {
          rateHz: number
          depth: number
          centerHz: number
          feedback: number
          mix: number
        }): Promise<{ success: boolean }>
        getPhaserConfig(): Promise<{
          success: boolean
          data?: { rateHz: number; depth: number; centerHz: number; feedback: number; mix: number }
          error?: string
        }>
        setChannelMatrixConfig(config: {
          enabled: boolean
          balance: number
          swapStereo: boolean
          monoDownmix: boolean
          outputGains: number[]
        }): Promise<{ success: boolean }>
        getChannelMatrixConfig(): Promise<{
          success: boolean
          data?: {
            enabled: boolean
            balance: number
            swapStereo: boolean
            monoDownmix: boolean
            outputGains: number[]
          }
          error?: string
        }>
        setLimiter(config: {
          enabled: boolean
          ceilingDb: number
          releaseMs: number
        }): Promise<{ success: boolean }>
        getLimiter(): Promise<{
          success: boolean
          data?: { enabled: boolean; ceilingDb: number; releaseMs: number }
          error?: string
        }>
        enumerateDevices(): Promise<{ success: boolean; data?: DeviceInfo[]; error?: string }>
        setDevice(deviceId: string): Promise<{ success: boolean }>
        setBackend(backend: string): Promise<{ success: boolean }>
        selectOutputDevice(backend: string, deviceId: string): Promise<{ success: boolean }>
        getOutputDeviceSettings(): Promise<{
          success: boolean
          data?: { backend: string; deviceId: string }
          error?: string
        }>
        getEngineInfo(): Promise<{
          success: boolean
          data?: { version: string; outputDevice: { backend: string; deviceId: string } }
          error?: string
        }>
        getStatus(): Promise<{ success: boolean; data?: PlaybackStatus; error?: string }>
        getAudioChain(): Promise<{ success: boolean; data?: AudioChainStatus; error?: string }>
        getAudioAnalysis(includeSpectrum?: boolean): Promise<{
          success: boolean
          data?: {
            outputTimeMs: number
            analysisTimeMs: number
            analysisLatencyMs: number
            rms: number
            lowEnergy: number
            onsetStrength: number
            droppedFrames: number
            beatSequence: number
            bpm: number
            momentaryLufs: number
            shortTermLufs: number
            integratedLufs: number
            spectrum?: number[]
          }
          error?: string
        }>
        setLoudnessAnalysisEnabled(enabled: boolean): Promise<{ success: boolean; error?: string }>
        setSpectrumAnalysisEnabled(enabled: boolean): Promise<{ success: boolean; error?: string }>

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onEvent(type: string, callback: (data: any) => void): () => void
        onStateChanged(callback: (data: { state: string; trackInfo: unknown }) => void): () => void
        onPositionChanged(
          callback: (data: { positionMs: number; durationMs: number }) => void
        ): () => void
        onTrackEnded(callback: (data: { reason: string; filePath: string }) => void): () => void
        onAudioChainChanged(callback: (data: AudioChainStatus) => void): () => void
        onError(
          callback: (data: { code: number; message: string; recoverable: boolean }) => void
        ): () => void
      }
      database: {
        command(action: DatabaseAction, params?: unknown): Promise<DatabaseResponse>
        saveSync(key: string, value: unknown): { success: boolean; error?: string }
        getSync(key: string): { success: boolean; data?: unknown; error?: string }
      }
      downloads: {
        chooseDirectory(): Promise<string | null>
        history(): Promise<
          Array<{
            id: number
            platform: 'youtube' | 'bili'
            resourceId: string
            title: string | null
            filePath: string | null
            quality: string | null
            status: 'downloading' | 'done' | 'error'
            progress: number
            createdAt: string
          }>
        >
        thumbnail(url: string): Promise<string>
        showInFolder(filePath: string): Promise<{ success: boolean; error?: string }>
        search(
          platform: 'youtube' | 'bili',
          query: string
        ): Promise<
          Array<{
            platform: 'youtube' | 'bili'
            selected?: boolean
            id: string
            title: string
            url: string
            thumbnail: string | null
            thumbnailUrl?: string | null
            duration: number | null
            uploader: string | null
          }>
        >
        parse(url: string): Promise<
          Array<{
            platform: 'youtube' | 'bili'
            selected?: boolean
            id: string
            title: string
            url: string
            thumbnail: string | null
            thumbnailUrl?: string | null
            duration: number | null
            uploader: string | null
          }>
        >
        start(request: {
          platform: 'youtube' | 'bili'
          url: string
          title: string
          resourceId: string
          directory: string
          downloadType: 'audio' | 'video'
          quality: 'best' | 'high' | 'standard' | 'compact'
          locale?: string
        }): Promise<{ taskId: string }>
        onProgress(
          callback: (progress: {
            taskId: string
            status: 'downloading' | 'done' | 'error'
            progress: number
            filePath?: string
            title?: string
            error?: string
          }) => void
        ): () => void
      }
      library: {
        selectLocalMusicFolder(): Promise<string | null>
        scanLocalMusicFolder(directory: string): Promise<ScanLocalMusicResult>
        showSongInFolder(songId: number): Promise<{ success: boolean; error?: string }>
        onScanProgress(callback: (progress: ScanProgress) => void): () => void
      }
      files: {
        exportLibrary(parts: Array<'songs' | 'playlists' | 'tags' | 'settings'>): Promise<{
          success: boolean
          cancelled?: boolean
          data?: { filePath: string }
          error?: string
        }>
        importLibrary(): Promise<{
          success: boolean
          cancelled?: boolean
          data?: { added: number; skipped: number }
          error?: string
        }>
        recoverMovedSongs(): Promise<{
          success: boolean
          cancelled?: boolean
          data?: { total: number; recovered: number }
          error?: string
        }>
        onImportProgress(
          callback: (progress: { current: number; total: number }) => void
        ): () => void
      }
      lyrics: {
        openInEditor(request: {
          songId: number
          lyrics: string
          lyricFormat?: string
        }): Promise<{ success: boolean; error?: string }>
        loadSource(
          audioPath: string,
          source: 'embedded' | 'local' | 'network'
        ): Promise<{
          success: boolean
          data?: {
            content: string
            format: 'lrc' | 'elrc' | 'yrc' | 'ttml' | 'plain'
            path?: string
          } | null
          error?: string
        }>
        searchNetwork(request: {
          title: string
          artist?: string | null
          album?: string | null
        }): Promise<{
          success: boolean
          data?: Array<{
            id: string
            provider: 'netease' | 'kugou'
            title: string
            artist: string
            album?: string
            lrc: string
            format?: 'lrc' | 'elrc' | 'yrc' | 'ttml' | 'plain'
            translation?: string
            romanization?: string
          }>
          error?: string
        }>
      }
      fonts: {
        list(): Promise<{
          success: boolean
          data?: Array<{ family: string; file: string; url: string }>
        }>
        openDirectory(): Promise<{ success: boolean; error?: string }>
      }
      metadata: {
        read(songId: number): Promise<{ success: boolean; data?: unknown; error?: string }>
        write(songId: number, metadata: unknown): Promise<{ success: boolean; error?: string }>
        reload(songIds: number[]): Promise<{
          success: boolean
          data?: { reloaded: number; failed: number }
          error?: string
        }>
        chooseCover(): Promise<{
          success: boolean
          data?: { filePath: string; dataUrl: string }
          error?: string
        }>
        searchCovers(request: {
          title: string
          artist?: string | null
          album?: string | null
        }): Promise<{
          success: boolean
          data?: Array<{
            id: string
            title: string
            artist: string
            album: string
            imageUrl: string
            previewUrl: string
          }>
          error?: string
        }>
        downloadCover(imageUrl: string): Promise<{
          success: boolean
          data?: { dataUrl: string }
          error?: string
        }>
      }
      shortcuts: {
        registerGlobal(shortcuts: Record<string, string>): Promise<{
          success: boolean
          data?: { failed: string[] }
          error?: string
        }>
        unregisterGlobal(): Promise<{ success: boolean }>
        onAction(callback: (action: string) => void): () => void
      }
      system: {
        setCloseToTray(enabled: boolean): Promise<{ success: boolean }>
        setAutoStart(enabled: boolean): Promise<{ success: boolean }>
        getMicaState(): Promise<{
          success: boolean
          data?: { available: boolean; enabled: boolean }
        }>
        setMicaEnabled(enabled: boolean): Promise<{
          success: boolean
          data?: { available: boolean; enabled: boolean }
        }>
        updateTray(data: { title: string; artist: string; isPlaying: boolean }): void
        onTrayAction(callback: (action: 'previous' | 'toggle' | 'next') => void): () => void
      }
      miniPlayer: {
        enter(): Promise<{ success: boolean }>
        restore(): Promise<{ success: boolean }>
        ready(): void
        update(data: unknown): void
        action(action: 'previous' | 'toggle' | 'next'): void
        onUpdate(callback: (data: unknown) => void): () => void
        onAction(callback: (action: 'previous' | 'toggle' | 'next') => void): () => void
        onRequestState(callback: () => void): () => void
      }
      desktopLyrics: {
        open(): Promise<{ success: boolean }>
        close(): Promise<{ success: boolean }>
        ready(): void
        update(data: unknown): void
        action(action: 'previous' | 'toggle' | 'next'): void
        setLocked(locked: boolean): void
        syncFontSize(fontSize: number): void
        resizeForFont(fontSize: number, preserveSavedBounds?: boolean): void
        onUpdate(callback: (data: unknown) => void): () => void
        onAction(callback: (action: 'previous' | 'toggle' | 'next') => void): () => void
        onRequestState(callback: () => void): () => void
        onClosed(callback: () => void): () => void
        onFontSizeChanged(callback: (fontSize: number) => void): () => void
        onBounds(
          callback: (bounds: { width: number; height: number; syncFontSize?: boolean }) => void
        ): () => void
      }
      remoteSource: {
        test(config: {
          type: 'navidrome' | 'jellyfin'
          baseUrl: string
          user: string
          secret: string
        }): Promise<{ success: boolean; data?: { version: string }; error?: string }>
        chooseCacheDirectory(): Promise<{ success: boolean; data?: string }>
        defaultCacheDirectory(): Promise<{ success: boolean; data?: string }>
        cacheSize(directory: string): Promise<{ success: boolean; data?: number }>
        sync(
          sourceId: number
        ): Promise<{ success: boolean; data?: { imported: number; total: number }; error?: string }>
        cacheSong(songId: number): Promise<{ success: boolean; data?: string; error?: string }>
      }
      appUpdate: {
        status(): Promise<{ success: boolean; data?: unknown }>
        check(): Promise<{ success: boolean; data?: unknown; error?: string }>
        download(): Promise<{ success: boolean; data?: unknown; error?: string }>
        install(): Promise<{ success: boolean; error?: string }>
        onStatus(callback: (status: unknown) => void): () => void
      }
      window: {
        command(command: 'minimize' | 'toggle-maximize' | 'close'): Promise<{ maximized: boolean }>
        setTrafficLightVisible(visible: boolean): void
        onState(callback: (state: { maximized: boolean }) => void): () => void
      }
    }
  }
}
