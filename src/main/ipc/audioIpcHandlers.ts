import { ipcMain, BrowserWindow } from 'electron'
import { AudioEngineManager } from '../audioEngine'
import { EngineState, IPC } from '../audioEngine/types'
import { getAppSetting, setAppSetting } from '../database/repository'

interface PlaybackCheckpoint {
  currentFile?: string
  positionMs?: number
  wasPlaying?: boolean
}

export function registerIpcHandlers(engine: AudioEngineManager, mainWindow: BrowserWindow): void {
  // Keep the frequently updated resume point separate from the queue snapshot.
  // The latter can be large, while this value is written from position events.
  const storedCheckpoint = getAppSetting('player.playback-checkpoint')
  const stored =
    storedCheckpoint && typeof storedCheckpoint === 'object'
      ? (storedCheckpoint as PlaybackCheckpoint)
      : {}
  let checkpoint: PlaybackCheckpoint = {
    currentFile: stored.currentFile,
    positionMs: stored.positionMs,
    wasPlaying: stored.wasPlaying
  }
  let checkpointTimer: ReturnType<typeof setTimeout> | undefined
  const saveCheckpoint = (changes: Partial<PlaybackCheckpoint>, delayed = false): void => {
    checkpoint = { ...checkpoint, ...changes }
    const write = (): void => {
      setAppSetting('player.playback-checkpoint', checkpoint)
    }
    if (!delayed) {
      if (checkpointTimer) clearTimeout(checkpointTimer)
      checkpointTimer = undefined
      write()
      return
    }
    if (!checkpointTimer) {
      checkpointTimer = setTimeout(() => {
        checkpointTimer = undefined
        write()
      }, 5000)
    }
  }

  // ── Commands ──

  ipcMain.handle(IPC.COMMAND, async (_event, { action, params }) => {
    switch (action) {
      case 'open': {
        const ok = await engine.openAsync(params.filePath)
        if (ok) saveCheckpoint({ currentFile: params.filePath, positionMs: 0, wasPlaying: false })
        return { success: ok }
      }

      case 'play': {
        const ok = engine.play()
        if (ok) saveCheckpoint({ wasPlaying: true })
        return { success: ok }
      }

      case 'pause': {
        const ok = engine.pause()
        if (ok) saveCheckpoint({ wasPlaying: false })
        return { success: ok }
      }

      case 'stop': {
        const ok = await engine.stopAsync()
        if (ok) saveCheckpoint({ wasPlaying: false })
        return { success: ok }
      }

      case 'seek': {
        const ok = engine.seek(params.positionMs)
        if (ok) saveCheckpoint({ positionMs: params.positionMs })
        return { success: ok }
      }

      case 'setVolume': {
        engine.setVolume(params.volume)
        sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
        return { success: true }
      }

      case 'setPreamp': {
        engine.setPreamp(params.db, params.enabled)
        sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
        return { success: true }
      }
      case 'setReplayGain':
        return { success: engine.setReplayGain(params.config) }
      case 'getReplayGain':
        return { success: true, data: engine.getReplayGain() }
      case 'setPlaybackSpeed':
        return { success: engine.setPlaybackSpeed(params.config) }
      case 'getPlaybackSpeed':
        return { success: true, data: engine.getPlaybackSpeed() }

      case 'setEqBands': {
        sendEvent(mainWindow, 'logEntry', {
          level: 'info',
          message: `IPC setEqBands request: ${Array.isArray(params.bands) ? params.bands.length : 'invalid'} band(s)`,
          timestamp: Date.now()
        })
        let ok = false
        try {
          ok = engine.setEqBands(params.bands)
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendEvent(mainWindow, 'logEntry', {
            level: 'error',
            message: `IPC setEqBands native exception: ${message}`,
            timestamp: Date.now()
          })
          return { success: false, error: message }
        }
        sendEvent(mainWindow, 'logEntry', {
          level: ok ? 'info' : 'error',
          message: `IPC setEqBands result: ${ok ? 'accepted' : 'rejected'}`,
          timestamp: Date.now()
        })
        if (ok) sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
        return { success: ok }
      }

      case 'getEqBands': {
        return { success: true, data: engine.getEqBands() }
      }

      case 'setResamplerConfig': {
        const ok = engine.setResamplerConfig(params.config)
        if (ok) sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
        return { success: ok }
      }

      case 'getResamplerConfig': {
        return { success: true, data: engine.getResamplerConfig() }
      }
      case 'setDopEnabled':
        return { success: engine.setDopEnabled(params.enabled === true) }
      case 'getDopEnabled':
        return { success: true, data: engine.getDopEnabled() }
      case 'setTransitionConfig': {
        const ok = engine.setTransitionConfig(params.config)
        if (ok) sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
        return { success: ok }
      }
      case 'getTransitionConfig':
        return { success: true, data: engine.getTransitionConfig() }

      case 'setDspNodes': {
        const ok = engine.setDspNodes(params.nodes)
        if (ok) sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
        return { success: ok }
      }

      case 'getDspNodes': {
        return { success: true, data: engine.getDspNodes() }
      }

      case 'setCompressorConfig': {
        const ok = engine.setCompressorConfig(params.config)
        if (ok) sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
        return { success: ok }
      }

      case 'getCompressorConfig': {
        return { success: true, data: engine.getCompressorConfig() }
      }
      case 'setDelayConfig': {
        const ok = engine.setDelayConfig(params.config)
        if (ok) sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
        return { success: ok }
      }
      case 'getDelayConfig':
        return { success: true, data: engine.getDelayConfig() }
      case 'setReverbConfig': {
        const ok = engine.setReverbConfig(params.config)
        if (ok) sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
        return { success: ok }
      }
      case 'getReverbConfig':
        return { success: true, data: engine.getReverbConfig() }
      case 'setChorusConfig': {
        const ok = engine.setChorusConfig(params.config)
        if (ok) sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
        return { success: ok }
      }
      case 'getChorusConfig':
        return { success: true, data: engine.getChorusConfig() }
      case 'setNoiseGateConfig': {
        const ok = engine.setNoiseGateConfig(params.config)
        if (ok) sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
        return { success: ok }
      }
      case 'getNoiseGateConfig':
        return { success: true, data: engine.getNoiseGateConfig() }
      case 'setPhaserConfig': {
        const ok = engine.setPhaserConfig(params.config)
        if (ok) sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
        return { success: ok }
      }
      case 'getPhaserConfig':
        return { success: true, data: engine.getPhaserConfig() }
      case 'setChannelMatrixConfig': {
        const ok = engine.setChannelMatrixConfig(params.config)
        if (ok) sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
        return { success: ok }
      }
      case 'getChannelMatrixConfig':
        return { success: true, data: engine.getChannelMatrixConfig() }
      case 'setLimiter': {
        const ok = engine.setLimiter(params.config)
        if (ok) sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
        return { success: ok }
      }
      case 'getLimiter':
        return { success: true, data: engine.getLimiter() }

      case 'enumerateDevices': {
        const devices = engine.enumerateDevices()
        return { success: true, data: devices }
      }

      case 'setDevice': {
        try {
          const ok = engine.setDevice(params.deviceId)
          if (!ok)
            sendEvent(mainWindow, 'logEntry', {
              level: 'error',
              message: `Failed to select audio device: ${params.deviceId}`,
              timestamp: Date.now()
            })
          return { success: ok, error: ok ? undefined : 'Device selection failed' }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendEvent(mainWindow, 'logEntry', {
            level: 'error',
            message: `Device selection exception: ${message}`,
            timestamp: Date.now()
          })
          return { success: false, error: message }
        }
      }

      case 'setBackend': {
        try {
          const ok = engine.setBackend(params.backend)
          if (!ok)
            sendEvent(mainWindow, 'logEntry', {
              level: 'error',
              message: `Failed to switch audio backend: ${params.backend}`,
              timestamp: Date.now()
            })
          return { success: ok, error: ok ? undefined : 'Backend switch failed' }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendEvent(mainWindow, 'logEntry', {
            level: 'error',
            message: `Backend switch exception: ${message}`,
            timestamp: Date.now()
          })
          return { success: false, error: message }
        }
      }

      case 'selectOutputDevice': {
        try {
          const ok = engine.selectOutputDevice(params.backend, params.deviceId)
          if (!ok)
            sendEvent(mainWindow, 'logEntry', {
              level: 'error',
              message: `Failed to select ${params.backend} device: ${params.deviceId}`,
              timestamp: Date.now()
            })
          return { success: ok, error: ok ? undefined : 'Output device selection failed' }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendEvent(mainWindow, 'logEntry', {
            level: 'error',
            message: `Output device selection exception: ${message}`,
            timestamp: Date.now()
          })
          return { success: false, error: message }
        }
      }

      case 'getOutputDeviceSettings': {
        return { success: true, data: engine.getOutputDeviceSettings() }
      }

      case 'getEngineInfo': {
        return { success: engine.loaded, data: engine.getEngineInfo() }
      }

      case 'getStatus': {
        const status = engine.getStatus()
        return { success: true, data: status }
      }

      case 'getAudioChain': {
        return { success: true, data: engine.getAudioChain() }
      }
      case 'getAudioAnalysis':
        return {
          success: true,
          data: engine.getAudioAnalysis(params?.includeSpectrum === true)
        }
      case 'setLoudnessAnalysisEnabled':
        return { success: engine.setLoudnessAnalysisEnabled(params.enabled === true) }
      case 'setSpectrumAnalysisEnabled':
        return { success: engine.setSpectrumAnalysisEnabled(params.enabled === true) }

      case 'getTrackInfo': {
        return { success: false, error: 'Not implemented — use open() instead' }
      }

      default:
        return { success: false, error: `Unknown action: ${action}` }
    }
  })

  // ── State change events ──
  engine.onStateChanged((state: number) => {
    const stateMap: Record<number, string> = {
      [EngineState.Idle]: 'idle',
      [EngineState.Loading]: 'loading',
      [EngineState.Ready]: 'ready',
      [EngineState.Playing]: 'playing',
      [EngineState.Paused]: 'paused',
      [EngineState.Stopped]: 'stopped'
    }

    // `open` and `stop` now run on a N-API worker. Do not synchronously read
    // engine-owned data from this state callback: a Loading/Ready event can
    // otherwise race the worker that is updating the decoder and output path.
    sendEvent(mainWindow, 'stateChanged', { state: stateMap[state] ?? 'idle', trackInfo: null })
  })

  // ── Position events ──
  engine.onPositionChanged((posMs: number, durMs: number) => {
    saveCheckpoint({ positionMs: posMs }, true)
    sendEvent(mainWindow, 'positionChanged', {
      positionMs: posMs,
      durationMs: durMs
    })
  })
  engine.onTrackEnded((reason: string, filePath: string) => {
    sendEvent(mainWindow, 'trackEnded', { reason, filePath })
    sendEvent(mainWindow, 'logEntry', {
      level: 'info',
      message: `Playback reached end of track (${reason})`,
      timestamp: Date.now()
    })
  })

  // ── Error events ──
  engine.onError((code: number, msg: string) => {
    sendEvent(mainWindow, 'error', { code, message: msg, recoverable: true })
  })

  // ── Log events ──
  engine.onLog((level: number, msg: string) => {
    const levelMap: Record<number, string> = {
      0: 'debug',
      1: 'info',
      2: 'warn',
      3: 'error'
    }
    sendEvent(mainWindow, 'logEntry', {
      level: levelMap[level] ?? 'info',
      message: msg,
      timestamp: Date.now()
    })
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sendEvent(win: BrowserWindow, type: string, data: any): void {
  if (!win.isDestroyed()) {
    win.webContents.send(IPC.EVENT, { type, data })
  }
}
