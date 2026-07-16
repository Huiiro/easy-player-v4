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
  pause: () => ipcRenderer.invoke('audio:command', { action: 'pause', params: {} }),
  stop: () => ipcRenderer.invoke('audio:command', { action: 'stop', params: {} }),
  seek: (positionMs: number) =>
    ipcRenderer.invoke('audio:command', { action: 'seek', params: { positionMs } }),
  setVolume: (volume: number) =>
    ipcRenderer.invoke('audio:command', { action: 'setVolume', params: { volume } }),
  setPreamp: (db: number, enabled: boolean) =>
    ipcRenderer.invoke('audio:command', { action: 'setPreamp', params: { db, enabled } }),
  setReplayGain: (config: unknown) =>
    ipcRenderer.invoke('audio:command', { action: 'setReplayGain', params: { config } }),
  getReplayGain: () => ipcRenderer.invoke('audio:command', { action: 'getReplayGain', params: {} }),
  setPlaybackSpeed: (config: unknown) =>
    ipcRenderer.invoke('audio:command', { action: 'setPlaybackSpeed', params: { config } }),
  getPlaybackSpeed: () =>
    ipcRenderer.invoke('audio:command', { action: 'getPlaybackSpeed', params: {} }),
  setEqBands: (bands: unknown[]) =>
    ipcRenderer.invoke('audio:command', { action: 'setEqBands', params: { bands } }),
  getEqBands: () => ipcRenderer.invoke('audio:command', { action: 'getEqBands', params: {} }),
  setResamplerConfig: (config: unknown) =>
    ipcRenderer.invoke('audio:command', { action: 'setResamplerConfig', params: { config } }),
  getResamplerConfig: () =>
    ipcRenderer.invoke('audio:command', { action: 'getResamplerConfig', params: {} }),
  setDopEnabled: (enabled: boolean) =>
    ipcRenderer.invoke('audio:command', { action: 'setDopEnabled', params: { enabled } }),
  getDopEnabled: () => ipcRenderer.invoke('audio:command', { action: 'getDopEnabled', params: {} }),
  setTransitionConfig: (config: unknown) =>
    ipcRenderer.invoke('audio:command', { action: 'setTransitionConfig', params: { config } }),
  getTransitionConfig: () =>
    ipcRenderer.invoke('audio:command', { action: 'getTransitionConfig', params: {} }),
  setDspNodes: (nodes: unknown[]) =>
    ipcRenderer.invoke('audio:command', { action: 'setDspNodes', params: { nodes } }),
  getDspNodes: () => ipcRenderer.invoke('audio:command', { action: 'getDspNodes', params: {} }),
  setCompressorConfig: (config: unknown) =>
    ipcRenderer.invoke('audio:command', { action: 'setCompressorConfig', params: { config } }),
  getCompressorConfig: () =>
    ipcRenderer.invoke('audio:command', { action: 'getCompressorConfig', params: {} }),
  setDelayConfig: (config: unknown) =>
    ipcRenderer.invoke('audio:command', { action: 'setDelayConfig', params: { config } }),
  getDelayConfig: () =>
    ipcRenderer.invoke('audio:command', { action: 'getDelayConfig', params: {} }),
  setReverbConfig: (config: unknown) =>
    ipcRenderer.invoke('audio:command', { action: 'setReverbConfig', params: { config } }),
  getReverbConfig: () =>
    ipcRenderer.invoke('audio:command', { action: 'getReverbConfig', params: {} }),
  setChorusConfig: (config: unknown) =>
    ipcRenderer.invoke('audio:command', { action: 'setChorusConfig', params: { config } }),
  getChorusConfig: () =>
    ipcRenderer.invoke('audio:command', { action: 'getChorusConfig', params: {} }),
  setNoiseGateConfig: (config: unknown) =>
    ipcRenderer.invoke('audio:command', { action: 'setNoiseGateConfig', params: { config } }),
  getNoiseGateConfig: () =>
    ipcRenderer.invoke('audio:command', { action: 'getNoiseGateConfig', params: {} }),
  setPhaserConfig: (config: unknown) =>
    ipcRenderer.invoke('audio:command', { action: 'setPhaserConfig', params: { config } }),
  getPhaserConfig: () =>
    ipcRenderer.invoke('audio:command', { action: 'getPhaserConfig', params: {} }),
  setChannelMatrixConfig: (config: unknown) =>
    ipcRenderer.invoke('audio:command', { action: 'setChannelMatrixConfig', params: { config } }),
  getChannelMatrixConfig: () =>
    ipcRenderer.invoke('audio:command', { action: 'getChannelMatrixConfig', params: {} }),
  setLimiter: (config: unknown) =>
    ipcRenderer.invoke('audio:command', { action: 'setLimiter', params: { config } }),
  getLimiter: () => ipcRenderer.invoke('audio:command', { action: 'getLimiter', params: {} }),
  enumerateDevices: () =>
    ipcRenderer.invoke('audio:command', { action: 'enumerateDevices', params: {} }),
  setDevice: (deviceId: string) =>
    ipcRenderer.invoke('audio:command', { action: 'setDevice', params: { deviceId } }),
  setBackend: (backend: string) =>
    ipcRenderer.invoke('audio:command', { action: 'setBackend', params: { backend } }),
  selectOutputDevice: (backend: string, deviceId: string) =>
    ipcRenderer.invoke('audio:command', {
      action: 'selectOutputDevice',
      params: { backend, deviceId }
    }),
  getOutputDeviceSettings: () =>
    ipcRenderer.invoke('audio:command', { action: 'getOutputDeviceSettings', params: {} }),
  getEngineInfo: () => ipcRenderer.invoke('audio:command', { action: 'getEngineInfo', params: {} }),
  getStatus: () => ipcRenderer.invoke('audio:command', { action: 'getStatus', params: {} }),
  getAudioChain: () => ipcRenderer.invoke('audio:command', { action: 'getAudioChain', params: {} }),
  getAudioAnalysis: () =>
    ipcRenderer.invoke('audio:command', { action: 'getAudioAnalysis', params: {} }),

  // Events (returns unsubscribe function)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onEvent: (type: string, callback: (data: any) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      payload: { type: string; data: unknown }
    ): void => {
      if (payload.type === type) {
        callback(payload.data)
      }
    }
    ipcRenderer.on('audio:event', handler)
    return () => ipcRenderer.removeListener('audio:event', handler)
  },

  onStateChanged: function (
    callback: (data: { state: string; trackInfo: unknown }) => void
  ): () => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).onEvent('stateChanged', callback)
  },
  onPositionChanged: function (
    callback: (data: { positionMs: number; durationMs: number }) => void
  ): () => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).onEvent('positionChanged', callback)
  },
  onTrackEnded: function (callback: (data: { reason: string }) => void): () => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).onEvent('trackEnded', callback)
  },
  onAudioChainChanged: function (callback: (data: unknown) => void): () => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).onEvent('audioChainChanged', callback)
  },
  onError: function (
    callback: (data: { code: number; message: string; recoverable: boolean }) => void
  ): () => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).onEvent('error', callback)
  },
  onLogEntry: function (
    callback: (data: { level: string; message: string; timestamp: number }) => void
  ): () => void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (this as any).onEvent('logEntry', callback)
  }
}

const databaseAPI = {
  command: (action: string, params?: unknown) =>
    ipcRenderer.invoke('database:command', { action, params })
}

const libraryAPI = {
  importLocalFolder: () => ipcRenderer.invoke('library:import-local-folder'),
  onScanProgress: (
    callback: (progress: {
      current: number
      total: number
      added: number
      duplicates: number
    }) => void
  ): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      progress: Parameters<typeof callback>[0]
    ): void => {
      callback(progress)
    }
    ipcRenderer.on('library:scan-progress', handler)
    return () => ipcRenderer.removeListener('library:scan-progress', handler)
  }
}

// Custom APIs for renderer
const api = {
  audio: audioAPI,
  database: databaseAPI,
  library: libraryAPI
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
