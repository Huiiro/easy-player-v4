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
  onTrackEnded: function (
    callback: (data: { reason: string; filePath: string }) => void
  ): () => void {
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
    ipcRenderer.invoke('database:command', { action, params }),
  saveSync: (key: string, value: unknown) =>
    ipcRenderer.sendSync('database:save-setting-sync', { key, value }) as {
      success: boolean
      error?: string
    },
  getSync: (key: string) =>
    ipcRenderer.sendSync('database:get-setting-sync', key) as {
      success: boolean
      data?: unknown
      error?: string
    }
}

const libraryAPI = {
  importLocalFolder: () => ipcRenderer.invoke('library:import-local-folder'),
  showSongInFolder: (songId: number) =>
    ipcRenderer.invoke('library:show-song-in-folder', songId) as Promise<{
      success: boolean
      error?: string
    }>,
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

const windowAPI = {
  command: (command: 'minimize' | 'toggle-maximize' | 'close') =>
    ipcRenderer.invoke('window:command', command) as Promise<{ maximized: boolean }>,
  onState: (callback: (state: { maximized: boolean }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: { maximized: boolean }): void =>
      callback(state)
    ipcRenderer.on('window:state', handler)
    return () => ipcRenderer.removeListener('window:state', handler)
  }
}

const miniPlayerAPI = {
  enter: () => ipcRenderer.invoke('mini-player:enter') as Promise<{ success: boolean }>,
  restore: () => ipcRenderer.invoke('mini-player:restore') as Promise<{ success: boolean }>,
  ready: () => ipcRenderer.send('mini-player:ready'),
  update: (data: unknown) => ipcRenderer.send('mini-player:update', data),
  action: (action: 'previous' | 'toggle' | 'next') =>
    ipcRenderer.send('mini-player:action', action),
  onUpdate: (callback: (data: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('mini-player:update', handler)
    return () => ipcRenderer.removeListener('mini-player:update', handler)
  },
  onAction: (callback: (action: 'previous' | 'toggle' | 'next') => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      action: 'previous' | 'toggle' | 'next'
    ): void => callback(action)
    ipcRenderer.on('mini-player:action', handler)
    return () => ipcRenderer.removeListener('mini-player:action', handler)
  },
  onRequestState: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('mini-player:request-state', handler)
    return () => ipcRenderer.removeListener('mini-player:request-state', handler)
  }
}

const desktopLyricsAPI = {
  open: () => ipcRenderer.invoke('desktop-lyrics:open') as Promise<{ success: boolean }>,
  close: () => ipcRenderer.invoke('desktop-lyrics:close') as Promise<{ success: boolean }>,
  ready: () => ipcRenderer.send('desktop-lyrics:ready'),
  update: (data: unknown) => ipcRenderer.send('desktop-lyrics:update', data),
  action: (action: 'previous' | 'toggle' | 'next') =>
    ipcRenderer.send('desktop-lyrics:action', action),
  setLocked: (locked: boolean) => ipcRenderer.send('desktop-lyrics:set-locked', locked),
  resizeForFont: (fontSize: number) => ipcRenderer.send('desktop-lyrics:resize-for-font', fontSize),
  onUpdate: (callback: (data: unknown) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('desktop-lyrics:update', handler)
    return () => ipcRenderer.removeListener('desktop-lyrics:update', handler)
  },
  onAction: (callback: (action: 'previous' | 'toggle' | 'next') => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      action: 'previous' | 'toggle' | 'next'
    ): void => callback(action)
    ipcRenderer.on('desktop-lyrics:action', handler)
    return () => ipcRenderer.removeListener('desktop-lyrics:action', handler)
  },
  onRequestState: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('desktop-lyrics:request-state', handler)
    return () => ipcRenderer.removeListener('desktop-lyrics:request-state', handler)
  },
  onClosed: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('desktop-lyrics:closed', handler)
    return () => ipcRenderer.removeListener('desktop-lyrics:closed', handler)
  },
  onBounds: (callback: (bounds: { width: number; height: number }) => void): (() => void) => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      bounds: { width: number; height: number }
    ): void => callback(bounds)
    ipcRenderer.on('desktop-lyrics:bounds', handler)
    return () => ipcRenderer.removeListener('desktop-lyrics:bounds', handler)
  }
}

const remoteSourceAPI = {
  testNavidrome: (config: { baseUrl: string; user: string; secret: string }) =>
    ipcRenderer.invoke('remote-source:test-navidrome', config) as Promise<{
      success: boolean
      data?: { version: string }
      error?: string
    }>,
  chooseCacheDirectory: () =>
    ipcRenderer.invoke('remote-source:choose-cache-directory') as Promise<{
      success: boolean
      data?: string
    }>,
  defaultCacheDirectory: () =>
    ipcRenderer.invoke('remote-source:default-cache-directory') as Promise<{
      success: boolean
      data?: string
    }>,
  cacheSize: (directory: string) =>
    ipcRenderer.invoke('remote-source:cache-size', directory) as Promise<{
      success: boolean
      data?: number
    }>,
  sync: (sourceId: number) =>
    ipcRenderer.invoke('remote-source:sync', sourceId) as Promise<{
      success: boolean
      data?: { imported: number; total: number }
      error?: string
    }>,
  cacheSong: (songId: number) =>
    ipcRenderer.invoke('remote-source:cache-song', songId) as Promise<{
      success: boolean
      data?: string
      error?: string
    }>
}

const lyricsAPI = {
  loadSource: (audioPath: string, source: 'embedded' | 'local' | 'network') =>
    ipcRenderer.invoke('lyrics:load-source', { audioPath, source }),
  searchNetwork: ({
    title,
    artist,
    album
  }: {
    title: string
    artist?: string | null
    album?: string | null
  }) => ipcRenderer.invoke('lyrics:search-network', { title, artist, album })
}
const fontsAPI = {
  list: () => ipcRenderer.invoke('fonts:list'),
  openDirectory: () => ipcRenderer.invoke('fonts:open-directory')
}

const metadataAPI = {
  read: (songId: number) =>
    ipcRenderer.invoke('metadata:read', songId) as Promise<{
      success: boolean
      data?: unknown
      error?: string
    }>,
  write: (songId: number, metadata: unknown) =>
    ipcRenderer.invoke('metadata:write', { songId, metadata }) as Promise<{
      success: boolean
      error?: string
    }>,
  chooseCover: () =>
    ipcRenderer.invoke('metadata:choose-cover') as Promise<{
      success: boolean
      data?: { filePath: string; dataUrl: string }
      error?: string
    }>
}

// Custom APIs for renderer
const api = {
  audio: audioAPI,
  database: databaseAPI,
  library: libraryAPI,
  lyrics: lyricsAPI,
  fonts: fontsAPI,
  metadata: metadataAPI,
  miniPlayer: miniPlayerAPI,
  desktopLyrics: desktopLyricsAPI,
  remoteSource: remoteSourceAPI,
  window: windowAPI
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
