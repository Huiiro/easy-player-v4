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
        return { success: true }
      }

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

      case 'getStatus': {
        const status = engine.getStatus()
        return { success: true, data: status }
      }

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
