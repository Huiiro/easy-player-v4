import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// ── Audio API exposed to renderer ──
const audioAPI = {
  // Get the full filesystem path from a File object (drag-and-drop)
  getFilePath: (file: File): string => {
    try {
      // Electron 29+: use webUtils for reliable path resolution
      return webUtils.getPathForFile(file)
    } catch {
      // Fallback for older Electron or non-file drops
      return (file as { path?: string }).path ?? file.name
    }
  },
  // Commands
  open: (filePath: string) =>
    ipcRenderer.invoke('audio:command', { action: 'open', params: { filePath } }),
  play: (startPosition?: number) =>
    ipcRenderer.invoke('audio:command', { action: 'play', params: { startPosition } }),
  pause: () =>
    ipcRenderer.invoke('audio:command', { action: 'pause', params: {} }),
  stop: () =>
    ipcRenderer.invoke('audio:command', { action: 'stop', params: {} }),
  seek: (positionMs: number) =>
    ipcRenderer.invoke('audio:command', { action: 'seek', params: { positionMs } }),
  setVolume: (volume: number) =>
    ipcRenderer.invoke('audio:command', { action: 'setVolume', params: { volume } }),
  enumerateDevices: () =>
    ipcRenderer.invoke('audio:command', { action: 'enumerateDevices', params: {} }),
  setDevice: (deviceId: string) =>
    ipcRenderer.invoke('audio:command', { action: 'setDevice', params: { deviceId } }),
  setBackend: (backend: string) =>
    ipcRenderer.invoke('audio:command', { action: 'setBackend', params: { backend } }),
  getStatus: () =>
    ipcRenderer.invoke('audio:command', { action: 'getStatus', params: {} }),

  // Events (returns unsubscribe function)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEvent: (type: string, callback: (data: any) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: { type: string; data: unknown }) => {
      if (payload.type === type) {
        callback(payload.data)
      }
    }
    ipcRenderer.on('audio:event', handler)
    return () => ipcRenderer.removeListener('audio:event', handler)
  },

  onStateChanged: function (callback: (data: { state: string; trackInfo: unknown }) => void): () => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).onEvent('stateChanged', callback)
  },
  onPositionChanged: function (callback: (data: { positionMs: number; durationMs: number }) => void): () => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).onEvent('positionChanged', callback)
  },
  onTrackEnded: function (callback: (data: { reason: string }) => void): () => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).onEvent('trackEnded', callback)
  },
  onError: function (callback: (data: { code: number; message: string; recoverable: boolean }) => void): () => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).onEvent('error', callback)
  },
  onLogEntry: function (callback: (data: { level: string; message: string; timestamp: number }) => void): () => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).onEvent('logEntry', callback)
  }
}

// Custom APIs for renderer
const api = {
  audio: audioAPI
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
