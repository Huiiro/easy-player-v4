import type { DeviceInfo, PlaybackStatus } from '../types/audio'

// ── Typed wrapper around window.api.audio ──

function cmd<T = unknown>(result: { success: boolean; data?: T; error?: string }): T | null {
  if (!result.success) {
    console.warn('[audioBridge] Command failed:', result.error)
    return null
  }
  return (result.data as T) ?? null
}

export const audioBridge = {
  async open(filePath: string): Promise<boolean> {
    const r = await window.api.audio.open(filePath)
    return r.success
  },

  async play(startPosition?: number): Promise<boolean> {
    const r = await window.api.audio.play(startPosition)
    return r.success
  },

  async pause(): Promise<boolean> {
    const r = await window.api.audio.pause()
    return r.success
  },

  async stop(): Promise<boolean> {
    const r = await window.api.audio.stop()
    return r.success
  },

  async seek(positionMs: number): Promise<boolean> {
    const r = await window.api.audio.seek(positionMs)
    return r.success
  },

  async setVolume(volume: number): Promise<void> {
    await window.api.audio.setVolume(volume)
  },

  async enumerateDevices(): Promise<DeviceInfo[]> {
    const r = await window.api.audio.enumerateDevices()
    return cmd<DeviceInfo[]>(r) ?? []
  },

  async setDevice(deviceId: string): Promise<void> {
    await window.api.audio.setDevice(deviceId)
  },

  async setBackend(backend: string): Promise<boolean> {
    const r = await window.api.audio.setBackend(backend)
    return r.success
  },

  async getStatus(): Promise<PlaybackStatus | null> {
    const r = await window.api.audio.getStatus()
    return cmd<PlaybackStatus>(r)
  },

  // Events
  onStateChanged(callback: (data: { state: string; trackInfo: unknown }) => void): () => void {
    return window.api.audio.onStateChanged(callback)
  },

  onPositionChanged(callback: (data: { positionMs: number; durationMs: number }) => void): () => void {
    return window.api.audio.onPositionChanged(callback)
  },

  onError(callback: (data: { code: number; message: string; recoverable: boolean }) => void): () => void {
    return window.api.audio.onError(callback)
  },

  onLogEntry(callback: (data: { level: string; message: string; timestamp: number }) => void): () => void {
    return window.api.audio.onLogEntry(callback)
  }
}
