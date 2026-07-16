import { ipcMain, BrowserWindow } from 'electron'
import { AudioEngineManager } from './index'
import { EngineState, IPC } from './types'

export function registerIpcHandlers(engine: AudioEngineManager, mainWindow: BrowserWindow): void {
  // ── Commands ──

  ipcMain.handle(IPC.COMMAND, async (_event, { action, params }) => {
    switch (action) {
      case 'open': {
        const ok = engine.open(params.filePath)
        return { success: ok }
      }

      case 'play': {
        const ok = engine.play()
        return { success: ok }
      }

      case 'pause': {
        const ok = engine.pause()
        return { success: ok }
      }

      case 'stop': {
        const ok = engine.stop()
        return { success: ok }
      }

      case 'seek': {
        const ok = engine.seek(params.positionMs)
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
      case 'setReplayGain': return { success: engine.setReplayGain(params.config) }
      case 'getReplayGain': return { success: true, data: engine.getReplayGain() }
      case 'setPlaybackSpeed': return { success: engine.setPlaybackSpeed(params.config) }
      case 'getPlaybackSpeed': return { success: true, data: engine.getPlaybackSpeed() }

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
      case 'setDopEnabled': return { success: engine.setDopEnabled(params.enabled === true) }
      case 'getDopEnabled': return { success: true, data: engine.getDopEnabled() }
      case 'setTransitionConfig': {
        const ok = engine.setTransitionConfig(params.config)
        if (ok) sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
        return { success: ok }
      }
      case 'getTransitionConfig': return { success: true, data: engine.getTransitionConfig() }

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
      case 'setDelayConfig': return { success: engine.setDelayConfig(params.config) }
      case 'getDelayConfig': return { success: true, data: engine.getDelayConfig() }
      case 'setReverbConfig': return { success: engine.setReverbConfig(params.config) }
      case 'getReverbConfig': return { success: true, data: engine.getReverbConfig() }
      case 'setChorusConfig': return { success: engine.setChorusConfig(params.config) }
      case 'getChorusConfig': return { success: true, data: engine.getChorusConfig() }
      case 'setNoiseGateConfig': return { success: engine.setNoiseGateConfig(params.config) }
      case 'getNoiseGateConfig': return { success: true, data: engine.getNoiseGateConfig() }
      case 'setPhaserConfig': return { success: engine.setPhaserConfig(params.config) }
      case 'getPhaserConfig': return { success: true, data: engine.getPhaserConfig() }
      case 'setChannelMatrixConfig': return { success: engine.setChannelMatrixConfig(params.config) }
      case 'getChannelMatrixConfig': return { success: true, data: engine.getChannelMatrixConfig() }
      case 'setLimiter': return { success: engine.setLimiter(params.config) }
      case 'getLimiter': return { success: true, data: engine.getLimiter() }

      case 'enumerateDevices': {
        const devices = engine.enumerateDevices()
        return { success: true, data: devices }
      }

      case 'setDevice': {
        engine.setDevice(params.deviceId)
        return { success: true }
      }

      case 'setBackend': {
        const ok = engine.setBackend(params.backend)
        return { success: ok }
      }

      case 'selectOutputDevice': {
        const ok = engine.selectOutputDevice(params.backend, params.deviceId)
        return { success: ok }
      }

      case 'getStatus': {
        const status = engine.getStatus()
        return { success: true, data: status }
      }

      case 'getAudioChain': {
        return { success: true, data: engine.getAudioChain() }
      }
      case 'getAudioAnalysis': return { success: true, data: engine.getAudioAnalysis() }

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

    sendEvent(mainWindow, 'stateChanged', {
      state: stateMap[state] ?? 'idle',
      trackInfo: engine.getStatus()?.trackInfo ?? null
    })
    sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
  })

  // ── Position events ──
  engine.onPositionChanged((posMs: number, durMs: number) => {
    sendEvent(mainWindow, 'positionChanged', {
      positionMs: posMs,
      durationMs: durMs
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
