import { t } from '../i18n'
import { isPlaybackOnly } from '../service/playbackMode'
import { ipcMain, BrowserWindow } from 'electron'
import { AudioEngineManager } from '../audioEngine'
import { EngineState, IPC } from '../audioEngine/types'
import { getAppSetting, setAppSetting } from '../database/repository'
import { Logger } from '../service/loggerService'
import { logError, logOperation, logParams } from '../service/operationLogger'

interface PlaybackCheckpoint {
  currentFile?: string
  positionMs?: number
  wasPlaying?: boolean
}

const playbackStateNames: Record<EngineState, string> = {
  [EngineState.Idle]: 'idle',
  [EngineState.Loading]: 'loading',
  [EngineState.Ready]: 'ready',
  [EngineState.Playing]: 'playing',
  [EngineState.Paused]: 'paused',
  [EngineState.Stopped]: 'stopped'
}

export function registerIpcHandlers(
  engine: AudioEngineManager,
  mainWindow: () => BrowserWindow | null
): void {
  let readyRendererId = 0
  const pendingEnds: Array<{ reason: string; filePath: string; nextFilePath?: string }> = []
  let reclaimTimer: ReturnType<typeof setTimeout> | undefined
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
      try {
        setAppSetting('player.playback-checkpoint', checkpoint)
      } catch (error) {
        Logger.error(
          '[Audio IPC] save playback checkpoint failed',
          {
            filePath: checkpoint.currentFile,
            positionMs: checkpoint.positionMs,
            wasPlaying: checkpoint.wasPlaying
          },
          logError(error)
        )
        throw error
      }
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

  ipcMain.handle(IPC.COMMAND, async (event, request) => {
    if (!request || typeof request.action !== 'string') {
      Logger.warn('[Audio IPC] invalid command request')
      return { success: false, error: t('invalidAudioCommand') }
    }
    const { action, params } = request
    return logOperation(
      `[Audio IPC] ${action}`,
      logParams(params),
      async () => {
        switch (action) {
          case 'attachRenderer': {
            if (event.sender !== mainWindow()?.webContents) return { success: false }
            readyRendererId = event.sender.id
            const data = pendingEnds.splice(0)
            if (reclaimTimer) clearTimeout(reclaimTimer)
            if (isPlaybackOnly()) reclaimTimer = setTimeout(() => engine.reclaimIdleMemory(), 2500)
            return { success: true, data }
          }
          case 'open': {
            const ok = await engine.openAsync(params.filePath)
            if (ok)
              saveCheckpoint({ currentFile: params.filePath, positionMs: 0, wasPlaying: false })
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
          case 'resetAudioProcessingSettings': {
            const result = engine.resetAudioProcessingSettings()
            sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
            return result
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
            Logger.debug(
              `IPC setEqBands request: ${Array.isArray(params.bands) ? params.bands.length : 'invalid'} band(s)`
            )
            let ok = false
            try {
              ok = engine.setEqBands(params.bands)
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              Logger.error(`IPC setEqBands native exception: ${message}`)
              return { success: false, error: message }
            }
            Logger.write(
              ok ? 'debug' : 'error',
              'main',
              `IPC setEqBands result: ${ok ? 'accepted' : 'rejected'}`
            )
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
          case 'setNextTrack':
            return { success: engine.setNextTrack(params.filePath, params.sourceFile) }
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
          case 'setStereoFieldConfig': {
            const ok = engine.setStereoFieldConfig(params.config)
            if (ok) sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
            return { success: ok }
          }
          case 'getStereoFieldConfig':
            return { success: true, data: engine.getStereoFieldConfig() }
          case 'setCrossfeedConfig': {
            const ok = engine.setCrossfeedConfig(params.config)
            if (ok) sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
            return { success: ok }
          }
          case 'getCrossfeedConfig':
            return { success: true, data: engine.getCrossfeedConfig() }
          case 'setImpulseResponseConfig': {
            const ok = engine.setImpulseResponseConfig(params.config)
            if (ok) sendEvent(mainWindow, 'audioChainChanged', engine.getAudioChain())
            return { success: ok, error: ok ? undefined : engine.getImpulseResponseError() }
          }
          case 'getImpulseResponseConfig':
            return { success: true, data: engine.getImpulseResponseConfig() }
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
              if (!ok) Logger.error(`Failed to select audio device: ${params.deviceId}`)
              return { success: ok, error: ok ? undefined : t('selectDeviceFailed') }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              Logger.error(`Device selection exception: ${message}`)
              return { success: false, error: message }
            }
          }

          case 'setBackend': {
            try {
              const ok = engine.setBackend(params.backend)
              if (!ok) Logger.error(`Failed to switch audio backend: ${params.backend}`)
              return { success: ok, error: ok ? undefined : t('switchBackendFailed') }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              Logger.error(`Backend switch exception: ${message}`)
              return { success: false, error: message }
            }
          }

          case 'selectOutputDevice': {
            try {
              const ok = engine.selectOutputDevice(params.backend, params.deviceId)
              if (!ok) Logger.error(`Failed to select ${params.backend} device: ${params.deviceId}`)
              return { success: ok, error: ok ? undefined : t('selectOutputFailed') }
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error)
              Logger.error(`Output device selection exception: ${message}`)
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
            return {
              success: true,
              data: status
                ? { ...status, state: playbackStateNames[status.state as EngineState] ?? 'idle' }
                : null
            }
          }

          case 'getAudioChain': {
            return { success: true, data: engine.getAudioChain() }
          }
          case 'setAnalysisEnabled':
            return { success: engine.setAnalysisEnabled(params?.enabled === true) }
          case 'setExtremePlayback': {
            readyRendererId = 0
            const success = engine.setExtremePlayback(params?.enabled === true)
            return success
              ? { success }
              : {
                  success,
                  error: 'Please rebuild the native audio engine if mode switching fails.'
                }
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
            return { success: false, error: t('useOpen') }
          }

          default:
            return { success: false, error: t('unknownAction', { action }) }
        }
      },
      { quiet: ['getStatus', 'getAudioAnalysis', 'getAudioChain'].includes(action) }
    )
  })

  // ── State change events ──
  engine.onStateChanged((state: number) => {
    // `open` and `stop` now run on a N-API worker. Do not synchronously read
    // engine-owned data from this state callback: a Loading/Ready event can
    // otherwise race the worker that is updating the decoder and output path.
    Logger.debug('[Audio IPC] state changed', {
      state: playbackStateNames[state as EngineState] ?? 'idle'
    })
    sendEvent(mainWindow, 'stateChanged', {
      state: playbackStateNames[state as EngineState] ?? 'idle',
      trackInfo: null
    })
  })

  // ── Position events ──
  let lastPositionSentAt = 0
  let lastPositionMs = -1
  engine.onPositionChanged((posMs: number, durMs: number) => {
    const now = Date.now()
    const discontinuity = Math.abs(posMs - lastPositionMs) > 1500 || posMs < lastPositionMs
    if (isPlaybackOnly() && !discontinuity && now - lastPositionSentAt < 1000) return
    lastPositionSentAt = now
    lastPositionMs = posMs
    saveCheckpoint({ positionMs: posMs }, true)
    sendEvent(mainWindow, 'positionChanged', {
      positionMs: posMs,
      durationMs: durMs
    })
  })
  engine.onTrackEnded((reason: string, filePath: string) => {
    let nextFilePath: string | undefined
    if (reason === 'transition') {
      const status = engine.getStatus()
      const nextFile = status?.trackInfo?.filePath
      nextFilePath = nextFile
      if (nextFile) saveCheckpoint({ currentFile: nextFile, positionMs: status.positionMs })
    }
    if (readyRendererId !== mainWindow()?.webContents.id) {
      pendingEnds.push({ reason, filePath, nextFilePath })
    } else sendEvent(mainWindow, 'trackEnded', { reason, filePath, nextFilePath })
    Logger.write('debug', 'native', `Track ended: reason=${reason}, path=${filePath}`)
  })

  // ── Error events ──
  engine.onError((code: number, msg: string) => {
    sendEvent(mainWindow, 'error', { code, message: msg, recoverable: true })
    Logger.write('error', 'native', `[${code}] ${msg}`)
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function sendEvent(getWindow: () => BrowserWindow | null, type: string, data: any): void {
  const win = getWindow()
  if (win && !win.isDestroyed()) win.webContents.send(IPC.EVENT, { type, data })
}
